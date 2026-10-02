import { opFailure } from "./errors"
import { app, dialog, ipcMain, shell } from "electron"
import os from "os"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { dbHelpers, isUsingFallbackStorage } from "../db"
import { getMainWindow } from "./runtime"
import { discoverAllInstances, discoverGdLauncherInstances, discoverInstancesFromPath, importLauncherInstance } from "./import"
import { execAsync, fileExists } from "./import/helpers"
import {
  cleanupReplacedLoaderArtifacts,
  cleanupReplacedLoaderArtifactsForBuilds,
  isLoaderSelectionFieldChange,
  sendImportProgress,
} from "./builds/helpers"
import { fetchWithRetry } from "@xnlc/core/retry"

const MOJANG_BASE = "https://launchercontent.mojang.com"

function resolveImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `${MOJANG_BASE}${url.startsWith("/") ? "" : "/"}${url}`
}

async function getJavaVersion(javaExe: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`"${javaExe}" -version 2>&1`, { timeout: 4000, encoding: process.platform === "win32" ? "cp866" : undefined })
    const m = stdout.match(/version "([^"]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

type JavaInfo = {
  version: string
  fullVersion?: string
  vendor?: string
  arch?: string
}

async function getJavaInstallationInfo(javaExe: string): Promise<JavaInfo | null> {
  const enc = process.platform === "win32" ? "cp866" : undefined
  try {
    const { stdout } = await execAsync(`"${javaExe}" -XshowSettings:properties -version 2>&1`, { timeout: 6000, encoding: enc })
    const props: Record<string, string> = {}
    for (const line of stdout.split("\n")) {
      const idx = line.indexOf("=")
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (key && value) props[key] = value
    }
    const version = props["java.version"]
    if (!version) {
      const fallback = await getJavaVersion(javaExe)
      return fallback ? { version: fallback } : null
    }
    return {
      version,
      fullVersion: props["java.runtime.version"] || props["java.fullversion"] || version,
      vendor: props["java.vendor"] || props["java.vm.vendor"],
      arch: props["sun.arch.data.model"] || undefined,
    }
  } catch {
    const fallback = await getJavaVersion(javaExe)
    return fallback ? { version: fallback } : null
  }
}

function makeJavaLabel(version: string): string {
  const parts = version.split(".")
  const major = parts[0] === "1" ? parseInt(parts[1]) : parseInt(parts[0])
  return `Java ${major} (${version})`
}

/** Scans Windows registry (both 64-bit and 32-bit views) for Java installations. */
async function findJavaInWindowsRegistry(): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()
  const keys = [
    "HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment",
    "HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit",
    "HKLM\\SOFTWARE\\JavaSoft\\JRE",
    "HKLM\\SOFTWARE\\JavaSoft\\JDK",
    "HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment",
    "HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit",
    "HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JRE",
    "HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK",
  ]
  for (const key of keys) {
    try {
      const { stdout } = await execAsync(`reg query "${key}" /s`, { timeout: 5000, encoding: "cp866" })
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim()
        const idx = trimmed.indexOf("\\JavaHome")
        if (idx === -1) continue
        const eq = trimmed.indexOf("REG_SZ", idx)
        if (eq === -1) continue
        const value = trimmed.slice(eq + "REG_SZ".length).trim()
        if (!value || seen.has(value)) continue
        seen.add(value)
        found.push(value)
      }
    } catch {}
  }
  return found
}

type JavaDetectEntry = { path: string; version: string; label: string; fullVersion?: string; vendor?: string; arch?: string }

/**
 * Кэш результата поиска установленных Java.
 *
 * Скан стоит дорого: 8 запросов в реестр, перебор каталогов и последовательный
 * запуск `java -XshowSettings:properties` (до 6 с таймаута) на каждый найденный
 * `java.exe` — на машине с несколькими JDK это 10–20 процессов и до 30 секунд.
 * Раньше он выполнялся заново на каждый вызов, а зовут его шесть компонентов
 * (настройки лаунчера, настройки инстанса, диалоги создания сервера и установки
 * пака, вкладка сервера — местами дважды подряд).
 */
const JAVA_DETECT_TTL_MS = 5 * 60_000
let javaDetectCache: { at: number; value: JavaDetectEntry[] } | null = null
let javaDetectInFlight: Promise<JavaDetectEntry[]> | null = null

/** Полный скан без кэша — сюда попадает только первый вызов или явное обновление. */
async function scanJavaInstallations(): Promise<JavaDetectEntry[]> {
  const found: JavaDetectEntry[] = []
  const visited = new Set<string>()
  const tryJava = async (javaExe: string) => {
    const normalized = path.normalize(javaExe)
    if (visited.has(normalized)) return
    visited.add(normalized)
    if (!(await fileExists(normalized))) return
    const info = await getJavaInstallationInfo(normalized)
    if (!info) return
    const labelParts = [makeJavaLabel(info.version)]
    if (info.arch) labelParts.push(`${info.arch}-бит`)
    if (info.vendor) labelParts.push(info.vendor)
    found.push({
      path: normalized,
      version: info.version,
      label: labelParts.join(" · "),
      fullVersion: info.fullVersion,
      vendor: info.vendor,
      arch: info.arch,
    })
  }

  if (process.platform === "win32") {
    for (const home of await findJavaInWindowsRegistry()) {
      await tryJava(path.join(home, "bin", "java.exe"))
      await tryJava(path.join(home, "bin", "javaw.exe"))
    }
    const bases = [
      "C:\\Program Files\\Java",
      "C:\\Program Files\\Eclipse Adoptium",
      "C:\\Program Files\\Microsoft",
      "C:\\Program Files\\Zulu",
      "C:\\Program Files\\BellSoft",
      "C:\\Program Files\\Amazon Corretto",
      "C:\\Program Files\\OpenJDK",
    ]
    for (const base of bases) {
      if (!(await fileExists(base))) continue
      let dirs: string[] = []
      try { dirs = await fs.readdir(base) } catch { continue }
      for (const dir of dirs) await tryJava(path.join(base, dir, "bin", "java.exe"))
    }
    try {
      const { stdout } = await execAsync("where java 2>nul", { timeout: 3000, encoding: "cp866" })
      for (const line of stdout.split("\n")) {
        const p = line.trim()
        if (p) await tryJava(p)
      }
    } catch {}
  } else if (process.platform === "darwin") {
    const jvmBase = "/Library/Java/JavaVirtualMachines"
    if (await fileExists(jvmBase)) {
      let dirs: string[] = []
      try { dirs = await fs.readdir(jvmBase) } catch { dirs = [] }
      for (const dir of dirs) await tryJava(path.join(jvmBase, dir, "Contents", "Home", "bin", "java"))
    }
    for (const p of ["/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java"]) await tryJava(p)
    try {
      const { stdout } = await execAsync("/usr/libexec/java_home -V 2>&1", { timeout: 3000 })
      for (const m of stdout.matchAll(/^\s+(\/\S+)/gm)) await tryJava(path.join(m[1], "bin", "java"))
    } catch {}
  } else {
    const jvmBase = "/usr/lib/jvm"
    if (await fileExists(jvmBase)) {
      let dirs: string[] = []
      try { dirs = await fs.readdir(jvmBase) } catch { dirs = [] }
      for (const dir of dirs) await tryJava(path.join(jvmBase, dir, "bin", "java"))
    }
    for (const p of ["/usr/bin/java", "/usr/local/bin/java"]) await tryJava(p)
    try {
      const { stdout } = await execAsync("which java 2>/dev/null", { timeout: 3000 })
      if (stdout.trim()) await tryJava(stdout.trim())
    } catch {}
  }

  return found
}

/**
 * Отдаёт закэшированный результат; параллельные вызовы разделяют один скан
 * (in-flight), а `force` заставляет перечитать список (кнопка «Обновить» —
 * например, после установки новой Java).
 */
async function detectJavaInstallations(force = false): Promise<JavaDetectEntry[]> {
  if (!force && javaDetectCache && Date.now() - javaDetectCache.at < JAVA_DETECT_TTL_MS) {
    return javaDetectCache.value
  }
  if (javaDetectInFlight) return javaDetectInFlight

  const run = scanJavaInstallations().then((value) => {
    javaDetectCache = { at: Date.now(), value }
    return value
  })
  const tracked = run.finally(() => {
    if (javaDetectInFlight === tracked) javaDetectInFlight = null
  })
  javaDetectInFlight = tracked
  return tracked
}

/**
 * Быстрый поиск любого java-бинаря без запуска процесса: JAVA_HOME, типовые
 * каталоги установки, на Windows — ещё и PATH через `where`.
 *
 * Единая реализация для всего main-процесса: раньше такая же функция жила ещё
 * и в `mc-server-handlers.ts`, и списки каталогов приходилось править дважды.
 * Для полного списка с версиями используйте {@link detectJavaInstallations}.
 */
export function findJavaBinarySync(): string | null {
  const isWin = process.platform === "win32"
  const javaExe = isWin ? "java.exe" : "java"

  const javaHome = process.env.JAVA_HOME
  if (javaHome) {
    const candidate = path.join(javaHome, "bin", javaExe)
    if (fsSync.existsSync(candidate)) return candidate
  }

  if (isWin) {
    const bases = [
      "C:\\Program Files\\Java",
      "C:\\Program Files\\Eclipse Adoptium",
      "C:\\Program Files\\Microsoft",
      "C:\\Program Files\\Zulu",
      "C:\\Program Files\\BellSoft",
      "C:\\Program Files\\Amazon Corretto",
      "C:\\Program Files\\OpenJDK",
    ]
    for (const base of bases) {
      if (!fsSync.existsSync(base)) continue
      try {
        for (const dir of fsSync.readdirSync(base)) {
          const candidate = path.join(base, dir, "bin", javaExe)
          if (fsSync.existsSync(candidate)) return candidate
        }
      } catch {}
    }
    // PATH: `where java` дешевле, чем запуск java -version.
    try {
      const { execFileSync } = require("child_process") as typeof import("child_process")
      const output = execFileSync("where", ["java"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })
      const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (first && fsSync.existsSync(first)) return first
    } catch {}
  } else if (process.platform === "darwin") {
    const candidates = [
      "/Library/Java/JavaVirtualMachines",
      "/opt/homebrew/opt/openjdk/bin/java",
      "/usr/local/opt/openjdk/bin/java",
    ]
    for (const candidate of candidates) {
      if (candidate.endsWith("java")) {
        if (fsSync.existsSync(candidate)) return candidate
      } else if (fsSync.existsSync(candidate)) {
        try {
          for (const dir of fsSync.readdirSync(candidate)) {
            const binary = path.join(candidate, dir, "Contents", "Home", "bin", "java")
            if (fsSync.existsSync(binary)) return binary
          }
        } catch {}
      }
    }
  } else {
    const bases = ["/usr/lib/jvm", "/usr/local/sdkman/candidates/java/current"]
    for (const base of bases) {
      if (!fsSync.existsSync(base)) continue
      try {
        for (const dir of fsSync.readdirSync(base)) {
          const candidate = path.join(base, dir, "bin", "java")
          if (fsSync.existsSync(candidate)) return candidate
        }
      } catch {}
    }
  }

  return null
}

export function registerSystemHandlers() {
  ipcMain.handle("system:get-total-memory", () => os.totalmem())

  ipcMain.handle("fetch:minecraft-news", async () => {
    try {
      const res = await fetchWithRetry(`${MOJANG_BASE}/v2/news.json`, undefined, { retries: 2 })
      const data = await res.json() as { entries?: Record<string, unknown>[] }
      const entries = data.entries ?? []
      return entries.map(e => ({
        ...e,
        playPageImage: e.playPageImage ? { ...(e.playPageImage as Record<string, unknown>), url: resolveImageUrl((e.playPageImage as { url?: string }).url) } : e.playPageImage,
        newsPageImage: e.newsPageImage ? { ...(e.newsPageImage as Record<string, unknown>), url: resolveImageUrl((e.newsPageImage as { url?: string }).url) } : e.newsPageImage,
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle("db:load-accounts", async () => dbHelpers.loadAccounts())
  ipcMain.handle("db:save-account", async (_event, account) => dbHelpers.saveAccount(account))
  ipcMain.handle("db:remove-account", async (_event, id: string) => dbHelpers.removeAccount(id))
  ipcMain.handle("db:reorder-accounts", async (_event, ids: string[]) => dbHelpers.reorderAccounts(ids))
  // Лёгкий список для интерфейса: без тяжёлых mods/shaders (они грузятся по сборке).
  ipcMain.handle("db:load-builds-light", async () => dbHelpers.loadBuildsLight())
  ipcMain.handle("db:load-build-content", async (_event, buildId: string) => dbHelpers.loadBuildContent(buildId))
  ipcMain.handle("db:save-builds", async (_event, builds) => {
    const incoming = Array.isArray(builds) ? builds : []
    // Снапшот для сверки профилей загрузчика — только лёгкие поля: тяжёлый
    // контент при массовом сохранении не нужен (его сохраняет сам saveAllBuilds).
    const previousBuilds = await dbHelpers.loadBuildsLight()
    await dbHelpers.saveAllBuilds(incoming)
    // Массовое сохранение — вторая (подстраховывающая) точка, где может
    // проехать смена версии загрузчика: импорт/восстановление модпака и т.п.
    void cleanupReplacedLoaderArtifactsForBuilds(previousBuilds, incoming)
  })
  // Вставка новой сборки (создание с нуля, копия): до этого канала UI писал
  // новую сборку только debounce-патчами, а те делают UPDATE по id и по
  // несуществующей строке молча ничего не делают — сборка пропадала после
  // перезапуска, хотя папка интента уже была создана.
  ipcMain.handle("db:insert-build", async (_event, build) => {
    if (!build || typeof build !== "object") return
    await dbHelpers.insertBuild(build as Parameters<typeof dbHelpers.insertBuild>[0])
  })
  // Мгновенная точечная запись полей одной сборки (без debounce на стороне UI):
  // нужна для правок вроде отвязки/привязки модпака, которые не должны теряться
  // при быстром переключении вкладок инстанса.
  ipcMain.handle("db:update-build-fields", async (_event, buildId: string, fields: Record<string, unknown>) => {
    // Смена версии загрузчика / типа загрузчика / версии Minecraft меняет имя
    // профиля в `versions/` — старый профиль остаётся на диске и его нужно
    // убрать, иначе в папке игры копятся «мёртвые» лоадеры. Снапшот до правки
    // читаем только для таких полей, чтобы не дёргать БД на каждое изменение
    // описания или иконки.
    const selectionChange = isLoaderSelectionFieldChange(fields)
    const previous = selectionChange
      ? await dbHelpers.findBuildById(buildId)
      : null
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
  ipcMain.handle("db:is-fallback-storage", async () => ({ isFallback: isUsingFallbackStorage() }))
  ipcMain.handle("launcher:discover-importable-instances", async () => discoverAllInstances())
  ipcMain.handle("launcher:discover-from-path", async (_event, source: string, customPath: string) => {
    return discoverInstancesFromPath(source as any, customPath)
  })
  ipcMain.handle("launcher:import-gdlauncher-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const sourceInstances = (await discoverGdLauncherInstances()).filter((entry) => selectedIds.has(entry.id))
    if (sourceInstances.length === 0) return { success: true, imported: 0 }

    // Лёгкий список: нужны только имена, а saveAllBuilds сам сохранит тяжёлый
    // контент уже существующих сборок из БД.
    const existingBuilds = await dbHelpers.loadBuildsLight()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds = []
    for (const entry of sourceInstances) {
      if (existingNames.has(entry.name.trim().toLowerCase())) continue
      sendImportProgress(0, 100, `Импорт «${entry.name}»...`, entry.name)
      const result = await importLauncherInstance(entry)
      if (result) importedBuilds.push(result)
    }

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds([...importedBuilds, ...existingBuilds])
    return { success: true, imported: importedBuilds.length }
  })
  ipcMain.handle("launcher:import-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const allInstances = (await discoverAllInstances()).filter((entry) => selectedIds.has(entry.id))
    if (allInstances.length === 0) return { success: true, imported: 0 }

    const existingBuilds = await dbHelpers.loadBuildsLight()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds = []
    let current = 0
    for (const entry of allInstances) {
      current++
      if (existingNames.has(entry.name.trim().toLowerCase())) continue
      sendImportProgress(current, allInstances.length, `Импорт «${entry.name}»...`, entry.name)
      const result = await importLauncherInstance(entry)
      if (result) importedBuilds.push(result)
      sendImportProgress(current, allInstances.length, `Импортировано ${current} из ${allInstances.length}`, entry.name)
    }

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds([...importedBuilds, ...existingBuilds])
    return { success: true, imported: importedBuilds.length }
  })
  ipcMain.handle("settings:get", async (_event, key: string) => dbHelpers.getSetting(key))
  ipcMain.handle("settings:set", async (_event, key: string, value: string) => dbHelpers.setSetting(key, value))

  ipcMain.handle("shell:open-external", (_event, url: string) => shell.openExternal(url))
  ipcMain.handle("shell:open-launcher-folder", async (): Promise<void> => {
    const launcherDir = await dbHelpers.getLauncherDirectory()
    await shell.openPath(launcherDir)
  })

  ipcMain.handle("shell:open-path", async (_event, dirPath: string): Promise<void> => {
    await shell.openPath(dirPath)
  })

  ipcMain.handle("java:detect", async (_event, force?: boolean): Promise<JavaDetectEntry[]> => {
    // Кэш + in-flight: повторные вызовы из разных экранов больше не запускают
    // скан реестра и java.exe заново (см. detectJavaInstallations).
    return detectJavaInstallations(force === true)
  })

  ipcMain.handle("common:pick-folder", async (_event, title?: string): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: title || "Выбрать папку",
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle("java:pick-file", async (): Promise<string | null> => {
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

}
