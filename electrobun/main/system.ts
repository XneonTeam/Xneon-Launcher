import { registerSettingsHandlers } from "./settings-handlers"
import { publicContentIcons, storedContentIcons } from "./builds/content-icon-assets"
import { registerAccountHandlers } from "./account-service"
import { assertBuildMetadataIdle } from "./builds/modpack-persistence"
import { openExternalLink } from "./external-links"
import { opFailure } from "./errors"
import { app, dialog, rpcRegistry, shell } from "../platform/desktop"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"
import { dbHelpers, isUsingFallbackStorage } from "../db"
import { getMainWindow, sendToRenderer } from "./runtime"
import { discoverAllInstances, discoverGdLauncherInstances, discoverInstancesFromPath, getDiscoveredInstancesByIds, importLauncherInstance } from "./import"
import { detectJavaInstallations, type JavaDetectEntry } from "./java-discovery"
export { detectJavaInstallations, findJavaBinarySync } from "./java-discovery"
import {
  cleanupReplacedLoaderArtifacts,
  cleanupReplacedLoaderArtifactsForBuilds,
  isLoaderSelectionFieldChange,
  sendImportProgress,
} from "./builds/helpers"
import { fetchWithRetry } from "@xnlc/core/retry"
import type { LauncherNewsEntry } from "@xnlc/types"
import { SERVICE_URLS } from "@xnlc/urls"

const MOJANG_BASE = SERVICE_URLS.minecraftNews

/** Адрес ленты новостей лаунчера по умолчанию, переопределяется XNLC_NEWS_URL. */
const DEFAULT_LAUNCHER_NEWS_URL = SERVICE_URLS.launcherNews

function resolveImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `${MOJANG_BASE}${url.startsWith("/") ? "" : "/"}${url}`
}

function parseLauncherNewsItems(raw: unknown, sourceUrl: string): LauncherNewsEntry[] {
  let list: unknown[] = []
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.entries)) list = obj.entries
    else if (Array.isArray(obj.news)) list = obj.news
    else if (Array.isArray(obj.items)) list = obj.items
    else if (Array.isArray(obj.articles)) list = obj.articles
    else if (Array.isArray(obj.data)) list = obj.data
    else if (Array.isArray(obj.posts)) list = obj.posts
    else if (obj.title || obj.header || obj.text || obj.description) list = [obj]
  }

  const urlBase = (() => {
    try {
      const u = new URL(sourceUrl)
      return `${u.protocol}//${u.host}`
    } catch {
      return ""
    }
  })()

  const resolveUrl = (link?: unknown): string | undefined => {
    if (typeof link !== "string" || !link.trim()) return undefined
    const s = link.trim()
    if (s.startsWith("http://") || s.startsWith("https://")) return s
    if (s.startsWith("/") && urlBase) return `${urlBase}${s}`
    return s
  }

  return list.map((item, index) => {
    const obj = (item && typeof item === "object") ? (item as Record<string, unknown>) : {}
    const id = String(obj.id ?? obj.guid ?? obj.slug ?? obj.url ?? obj.link ?? `news-${index}`)
    const title = String(obj.title ?? obj.header ?? obj.name ?? obj.subject ?? "Без названия")
    const text = typeof obj.text === "string" ? obj.text : typeof obj.description === "string" ? obj.description : typeof obj.summary === "string" ? obj.summary : undefined
    const content = typeof obj.content === "string" ? obj.content : typeof obj.body === "string" ? obj.body : typeof obj.fullText === "string" ? obj.fullText : text
    const date = String(obj.date ?? obj.publishedAt ?? obj.published_at ?? obj.createdAt ?? obj.created_at ?? obj.time ?? new Date().toISOString())
    const tag = typeof obj.tag === "string" ? obj.tag : typeof obj.category === "string" ? obj.category : typeof obj.type === "string" ? obj.type : undefined
    const category = typeof obj.category === "string" ? obj.category : tag
    const readMoreLink = resolveUrl(obj.readMoreLink ?? obj.url ?? obj.link ?? obj.moreUrl ?? obj.detailsUrl ?? sourceUrl)
    const rawImg = obj.imageUrl ?? obj.image ?? obj.cover ?? obj.banner ?? (obj.playPageImage as { url?: string } | undefined)?.url ?? (obj.newsPageImage as { url?: string } | undefined)?.url
    const imageUrl = resolveUrl(rawImg)
    const author = typeof obj.author === "string" ? obj.author : typeof (obj.author as { name?: string } | undefined)?.name === "string" ? (obj.author as { name: string }).name : undefined

    return {
      id,
      title,
      text,
      content,
      date,
      tag,
      category,
      readMoreLink,
      imageUrl,
      playPageImage: imageUrl ? { url: imageUrl } : undefined,
      newsPageImage: imageUrl ? { url: imageUrl } : undefined,
      author,
    }
  })
}

export function registerSystemHandlers() {
  rpcRegistry.handle("system:get-total-memory", () => os.totalmem())

  rpcRegistry.handle("fetch:minecraft-news", async () => {
    try {
      const res = await fetchWithRetry(`${MOJANG_BASE}/v2/news.json`, undefined, { retries: 2 })
      const data = await res.json() as { entries?: Record<string, unknown>[] }
      const entries = data.entries ?? []
      return entries.filter(e => typeof e.id === "string" && typeof e.title === "string" && typeof e.date === "string").map(e => ({
        ...e,
        id: String(e.id), title: String(e.title), date: String(e.date),
        playPageImage: e.playPageImage ? { url: resolveImageUrl((e.playPageImage as { url?: string }).url) } : undefined,
        newsPageImage: e.newsPageImage ? { url: resolveImageUrl((e.newsPageImage as { url?: string }).url) } : undefined,
      }))
    } catch {
      return []
    }
  })

  rpcRegistry.handle("fetch:launcher-news", async (_event, customUrl?: string) => {
    // Адрес ленты задаётся в одном месте: XNLC_NEWS_URL (переменная окружения),
    // по умолчанию — боевой сайт лаунчера. Схему проверяем, иначе renderer мог бы
    // подсунуть file:// или data: и заставить main читать произвольный локальный ресурс.
    const envUrl = (process.env.XNLC_NEWS_URL || "").trim()
    const url = (typeof customUrl === "string" && customUrl.trim()) ? customUrl.trim() : (envUrl || DEFAULT_LAUNCHER_NEWS_URL)
    if (!/^https?:\/\//i.test(url)) {
      console.warn(`[fetch:launcher-news] Недопустимый адрес ленты: ${url}`)
      return []
    }
    try {
      const res = await fetchWithRetry(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) }, { retries: 1 })
      const data = await res.json()
      return parseLauncherNewsItems(data, url)
    } catch (err) {
      console.warn(`[fetch:launcher-news] Failed to fetch launcher news from ${url}:`, err)
      return []
    }
  })

  registerAccountHandlers()
  // Лёгкий список для интерфейса: без тяжёлых mods/shaders (они грузятся по сборке).
  rpcRegistry.handle("db:load-builds-light", async () => dbHelpers.loadBuildsLight())
  rpcRegistry.handle("db:load-build-content", async (_event, buildId: string) => publicContentIcons(await dbHelpers.loadBuildContent(buildId)))
  rpcRegistry.handle("db:save-builds", async (_event, builds) => {
    const incoming = Array.isArray(builds) ? await Promise.all(builds.map(async build => (await storedContentIcons(build))!)) : []
    for (const build of incoming) assertBuildMetadataIdle(build.id, build)
    // Снапшот для сверки профилей загрузчика — только лёгкие поля: тяжёлый
    // контент при массовом сохранении не нужен (его сохраняет сам saveAllBuilds).
    const previousBuilds = await dbHelpers.loadBuildsLight()
    for (const build of incoming) assertBuildMetadataIdle(build.id, build)
    await dbHelpers.saveAllBuilds(incoming)
    // Массовое сохранение — вторая (подстраховывающая) точка, где может
    // проехать смена версии загрузчика: импорт/восстановление модпака и т.п.
    void cleanupReplacedLoaderArtifactsForBuilds(previousBuilds, incoming)
  })
  // Вставка новой сборки (создание с нуля, копия): до этого канала UI писал
  // новую сборку только debounce-патчами, а те делают UPDATE по id и по
  // несуществующей строке молча ничего не делают — сборка пропадала после
  // перезапуска, хотя папка интента уже была создана.
  rpcRegistry.handle("db:insert-build", async (_event, build) => {
    if (!build || typeof build !== "object") return
    assertBuildMetadataIdle(build.id, build)
    const stored = (await storedContentIcons(build))!
    assertBuildMetadataIdle(stored.id, stored)
    await dbHelpers.insertBuild(stored as Parameters<typeof dbHelpers.insertBuild>[0])
  })
  // Мгновенная точечная запись полей одной сборки (без debounce на стороне UI):
  // нужна для правок вроде отвязки/привязки модпака, которые не должны теряться
  // при быстром переключении вкладок инстанса.
  rpcRegistry.handle("db:update-build-fields", async (_event, buildId: string, fields: Record<string, unknown>) => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Invalid build fields")
    fields = (await storedContentIcons(fields))!
    assertBuildMetadataIdle(buildId, fields)
    // Смена версии загрузчика / типа загрузчика / версии Minecraft меняет имя
    // профиля в `versions/` — старый профиль остаётся на диске и его нужно
    // убрать, иначе в папке игры копятся «мёртвые» лоадеры. Снапшот до правки
    // читаем только для таких полей, чтобы не дёргать БД на каждое изменение
    // описания или иконки.
    const selectionChange = isLoaderSelectionFieldChange(fields)
    const previous = selectionChange
      ? await dbHelpers.findBuildById(buildId)
      : null
    assertBuildMetadataIdle(buildId, fields)
    await dbHelpers.updateBuildFields(buildId, fields as Parameters<typeof dbHelpers.updateBuildFields>[1])

    if (previous) {
      await cleanupReplacedLoaderArtifacts({
        buildName: previous.name,
        previous: {
          version: previous.version,
          modLoader: previous.modLoader,
          loaderVersion: previous.loaderVersion,
        },
        current: {
          version: typeof fields.version === "string" ? fields.version : previous.version,
          modLoader: typeof fields.modLoader === "string" ? fields.modLoader : previous.modLoader,
          // `loaderVersion: undefined` — это осознанный сброс поля, поэтому
          // проверяем наличие ключа, а не его значение.
          loaderVersion: "loaderVersion" in fields
            ? (fields.loaderVersion as string | undefined)
            : previous.loaderVersion,
        },
        intentPath: typeof fields.intentPath === "string" ? fields.intentPath : previous.intentPath,
      })
    }
  })
  rpcRegistry.handle("db:is-fallback-storage", async () => ({ isFallback: isUsingFallbackStorage() }))
  rpcRegistry.handle("launcher:discover-importable-instances", async () => discoverAllInstances())
  rpcRegistry.handle("launcher:discover-from-path", async (_event, source: string, customPath: string) => {
    return discoverInstancesFromPath(source as any, customPath)
  })
  rpcRegistry.handle("launcher:import-gdlauncher-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const sourceInstances = (await discoverGdLauncherInstances()).filter((entry) => selectedIds.has(entry.id))
    if (sourceInstances.length === 0) return { success: true, imported: 0 }

    // Снимок используется только для проверки имён, обратно записываются
    // исключительно новые сборки, без устаревших полей соседних строк.
    const existingBuilds = await dbHelpers.loadBuildsLight()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds: NonNullable<Awaited<ReturnType<typeof importLauncherInstance>>>[] = []
    for (const entry of sourceInstances) {
      if (existingNames.has(entry.name.trim().toLowerCase())) continue
      sendImportProgress(0, 100, "import.phase.preparing", entry.name)
      const result = await importLauncherInstance(entry)
      if (result) importedBuilds.push(result)
    }

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds(importedBuilds)
    return { success: true, imported: importedBuilds.length }
  })
  rpcRegistry.handle("launcher:import-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const allInstances = await getDiscoveredInstancesByIds(selectedIds)
    if (allInstances.length === 0) return { success: true, imported: 0 }

    const existingBuilds = await dbHelpers.loadBuildsLight()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds: NonNullable<Awaited<ReturnType<typeof importLauncherInstance>>>[] = []
    let current = 0
    for (const entry of allInstances) {
      current++
      if (existingNames.has(entry.name.trim().toLowerCase())) continue
      sendImportProgress(current, allInstances.length, "import.phase.preparing", entry.name)
      const result = await importLauncherInstance(entry)
      if (result) importedBuilds.push(result)
      sendImportProgress(current, allInstances.length, "import.phase.preparing", entry.name)
    }

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds(importedBuilds)
    return { success: true, imported: importedBuilds.length }
  })
  registerSettingsHandlers()

  rpcRegistry.handle("shell:open-external", (_event, url: string) => openExternalLink(url))
  rpcRegistry.handle("shell:open-launcher-folder", async (): Promise<void> => {
    const launcherDir = await dbHelpers.getLauncherDirectory()
    await shell.openPath(launcherDir)
  })

  rpcRegistry.handle("shell:open-path", async (_event, dirPath: string): Promise<void> => {
    await shell.openPath(dirPath)
  })

  rpcRegistry.handle("java:detect", async (_event, force?: boolean): Promise<JavaDetectEntry[]> => {
    // Кэш + in-flight: повторные вызовы из разных экранов больше не запускают
    // скан реестра и java.exe заново (см. detectJavaInstallations).
    return detectJavaInstallations(force === true)
  })

  rpcRegistry.handle("common:pick-folder", async (_event, title?: string): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: title || "Выбрать папку",
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  rpcRegistry.handle("java:pick-file", async (): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: "Выбрать исполняемый файл Java",
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Java", extensions: ["exe"] }] : [{ name: "Все файлы", extensions: ["*"] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  // Файл для фона темы: картинка или видео.
  rpcRegistry.handle("common:pick-file", async (_event, options?: { title?: string; kind?: "image" | "video" }): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const kind = options?.kind === "video" ? "video" : "image"
    const contentFilters =
      kind === "video"
        ? [{ name: "Видео", extensions: ["mp4", "webm", "ogv"] }]
        : [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"] }]
    const result = await dialog.showOpenDialog(win, {
      title: options?.title || (kind === "video" ? "Выбрать видео" : "Выбрать изображение"),
      properties: ["openFile"],
      filters: [...contentFilters, { name: "Все файлы", extensions: ["*"] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  /**
   * Чтение медиа для фона темы в data-URL.
   *
   * Renderer не может получить байты сам: у http-ссылки мешает CORS при чтении
   * canvas, а local file:// в окне лаунчера недоступен. Поэтому читает main —
   * и одинаково для ссылки и для файла, с ограничением размера.
   */
  rpcRegistry.handle("theme:read-media", async (_event, source: string, maxBytes?: number): Promise<string | null> => {
    if (typeof source !== "string" || !source.trim()) return null
    const limit = typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : 16 * 1024 * 1024
    const target = source.trim()

    const mimeByExtension = (file: string): string => {
      const ext = path.extname(file).toLowerCase()
      const known: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".avif": "image/avif",
        ".bmp": "image/bmp",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".ogv": "video/ogg",
      }
      return known[ext] ?? "application/octet-stream"
    }

    try {
      let buffer: Buffer
      let mime = "application/octet-stream"
      if (/^https?:\/\//i.test(target)) {
        const response = await fetch(target)
        if (!response.ok) return null
        const length = Number(response.headers.get("content-length") || 0)
        if (length > limit) return null
        const arrayBuffer = await response.arrayBuffer()
        if (arrayBuffer.byteLength > limit) return null
        buffer = Buffer.from(arrayBuffer)
        mime = response.headers.get("content-type")?.split(";")[0] || mime
      } else {
        const filePath = target.startsWith("file://") ? fileURLToPath(target) : target
        const stats = await fs.stat(filePath)
        if (!stats.isFile() || stats.size > limit) return null
        buffer = await fs.readFile(filePath)
        mime = mimeByExtension(filePath)
      }
      if (mime === "application/octet-stream" || !mime) return null
      return `data:${mime};base64,${buffer.toString("base64")}`
    } catch {
      return null
    }
  })

}
