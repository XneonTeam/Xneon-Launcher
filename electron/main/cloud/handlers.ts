import { opFailure } from "../errors"
import { ipcMain, shell, app } from "electron"
import path from "path"
import fs from "fs/promises"
import { Worker } from "worker_threads"
import { getProvider, listProviders, type CloudProviderId } from "./registry"
import { ensureBuildIntentDir } from "../builds"
import { sanitizeFileName } from "../builds/helpers"
import { getMcServerDir } from "../paths"
import { dbHelpers } from "../../db"
import { sendToRenderer } from "../runtime"
import { META_ICON_ENTRY, META_NAME_ENTRY } from "./archive-meta"
import { BUILD_CATEGORY_DIRS, SERVER_CATEGORY_DIRS } from "./categories"

function sendUploadProgress(id: string, percent: number, stage: "zip" | "upload") {
  sendToRenderer("cloud:upload-progress", { id, percent, stage })
}

async function uploadWithProgress<T>(
  id: string,
  stage: "zip" | "upload",
  fn: () => Promise<T>,
): Promise<T> {
  sendUploadProgress(id, 0, stage)
  const result = await fn()
  sendUploadProgress(id, 100, stage)
  return result
}

/**
 * Определяет «корневой сегмент» архива.
 *
 * Архивы приходят в двух видах:
 *   1) с общей корневой папкой:  `MyBuild/mods/foo.jar`   (zip.addLocalFolder)
 *   2) без неё:                  `mods/foo.jar`           (upload-worker)
 *
 * Раньше код всегда брал `parts[1]`, из-за чего для архивов без корня категория
 * определялась по ИМЕНИ ФАЙЛА и при выборочном импорте не извлекалось ничего.
 * Здесь корень определяется по факту: если первый сегмент не является известным
 * каталогом-категорией — считаем его корнем.
 */
function detectArchiveRoot(entryNames: string[], knownDirs: Set<string>): string | null {
  const firstSegments = new Set<string>()
  let multiSegmentCount = 0

  for (const name of entryNames) {
    const parts = name.replace(/\\/g, "/").split("/").filter(Boolean)
    if (parts.length <= 1) continue // одиночные файлы в корне не задают корень
    multiSegmentCount++
    firstSegments.add(parts[0])
  }

  if (multiSegmentCount === 0) return null

  // Все вложенные записи начинаются с одного сегмента, который сам не является
  // известной папкой-категорией → это обёртка-корень архива. Наличие одиночных
  // файлов в корне (readme.txt и т.п.) этому не мешает.
  if (firstSegments.size === 1) {
    const only = [...firstSegments][0]
    if (!knownDirs.has(only.toLowerCase())) return only
  }

  return null
}

/**
 * Читает ключевые поля из server.properties распакованного сервера.
 * Если файла нет (например, его не выбрали при выборочном импорте) —
 * возвращает безопасные значения по умолчанию.
 */
async function readServerProperties(serverDir: string): Promise<{ port: number; onlineMode: boolean; maxPlayers: number }> {
  const defaults = { port: 25565, onlineMode: true, maxPlayers: 20 }
  try {
    const raw = await fs.readFile(path.join(serverDir, "server.properties"), "utf-8")
    let port = defaults.port
    let onlineMode = defaults.onlineMode
    let maxPlayers = defaults.maxPlayers
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key === "server-port") {
        const parsed = Number(value)
        if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) port = parsed
      } else if (key === "online-mode") {
        onlineMode = value.toLowerCase() === "true"
      } else if (key === "max-players") {
        const parsed = Number(value)
        if (Number.isInteger(parsed) && parsed > 0) maxPlayers = parsed
      }
    }
    return { port, onlineMode, maxPlayers }
  } catch {
    return defaults
  }
}

/** Минимальная форма записи архива, нужная для фильтрации по категориям. */
type ArchiveEntry = { entryName: string; isDirectory: boolean }

/** Извлекает из архива только файлы, чья верхняя папка входит в selectedCategories. */
function extractSelectedCategories(
  zip: {
    getEntries: () => ArchiveEntry[]
    extractEntryTo: (entry: ArchiveEntry, target: string, maintainEntryPath: boolean, overwrite: boolean) => void
  },
  rootDir: string,
  categoryMap: Record<string, string[]>,
  selectedCategories: string[],
): void {
  const catSet = new Set(selectedCategories)
  const knownDirs = new Set<string>()
  for (const dirs of Object.values(categoryMap)) {
    for (const dir of dirs) knownDirs.add(dir.toLowerCase())
  }

  const entries = zip.getEntries()
  const root = detectArchiveRoot(entries.map((e) => e.entryName), knownDirs)

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const parts = entry.entryName.replace(/\\/g, "/").split("/").filter(Boolean)
    // Отбрасываем корневой сегмент, если он есть в архиве.
    const rel = root && parts[0] === root ? parts.slice(1) : parts
    const topDir = (rel[0] ?? "").toLowerCase()
    if (!topDir) continue

    const matched = Object.entries(categoryMap).some(([cat, dirs]) =>
      catSet.has(cat) && dirs.some((dir) => dir.toLowerCase() === topDir),
    )
    if (matched) {
      zip.extractEntryTo(entry, rootDir, false, true)
    }
  }
}

async function createBuildZipInWorker(intentPath: string, archivePath: string, id: string, categories?: string[], icon?: string, name?: string): Promise<void> {
  const workerPath = path.join(__dirname, "upload-worker.js")
  const worker = new Worker(workerPath, { workerData: { intentPath, archivePath, categories, icon, name } })
  return new Promise((resolve, reject) => {
    worker.on("message", (msg) => {
      if (msg?.type === "zip-progress") {
        sendUploadProgress(id, msg.percent, "zip")
      } else if (msg?.type === "zip-done") {
        if (msg.result?.ok) resolve()
        else reject(new Error(msg.result?.error ?? "Zip failed"))
      }
    })
    worker.on("error", reject)
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Zip worker exited with code ${code}`))
      else resolve()
    })
  })
}

export function registerCloudHandlers() {
  ipcMain.handle("cloud:list-providers", () => {
    return listProviders()
  })

  ipcMain.handle("cloud:connect", async (_event, providerId: CloudProviderId, authData?: Record<string, string>) => {
    try {
      const provider = getProvider(providerId)
      const result = await provider.authenticate(authData)
      if (result.success) {
        try { await provider.ensureBaseFolder() } catch (e) { console.error("[Cloud] ensureBaseFolder failed:", e) }
      }
      return result
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:is-connected", async (_event, providerId: CloudProviderId) => {
    try {
      const provider = getProvider(providerId)
      return await provider.isAuthenticated()
    } catch { return false }
  })

  ipcMain.handle("cloud:disconnect", async (_event, providerId: CloudProviderId) => {
    try {
      const provider = getProvider(providerId)
      await provider.logout()
      return { success: true }
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:list-files", async (_event, providerId: CloudProviderId, folderPath?: string) => {
    try {
      const provider = getProvider(providerId)
      const result = await provider.listFiles(folderPath)
      return result
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:upload-file", async (_event, providerId: CloudProviderId, localPath: string, remotePath: string) => {
    try {
      const provider = getProvider(providerId)
      const id = `file-${path.basename(localPath)}`
      return uploadWithProgress(id, "upload", () =>
        provider.uploadFile(localPath, remotePath, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:download-file", async (_event, providerId: CloudProviderId, remotePath: string, localPath: string) => {
    try {
      const provider = getProvider(providerId)
      return await provider.downloadFile(remotePath, localPath)
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:delete-file", async (_event, providerId: CloudProviderId, remotePath: string) => {
    try {
      const provider = getProvider(providerId)
      return await provider.deleteFile(remotePath)
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:get-quota", async (_event, providerId: CloudProviderId) => {
    try {
      const provider = getProvider(providerId)
      return await provider.getStorageQuota()
    } catch { return null }
  })

  ipcMain.handle("cloud:upload-build", async (_event, providerId: CloudProviderId, buildName: string, uploadId?: string, categories?: string[]) => {
    // Имя файла архива обязано быть безопасным для файловой системы (оно же
    // используется как временный путь на диске), поэтому `:` и прочее
    // запрещённое в именах файлов заменяется — настоящее имя сборки едет
    // внутри архива метазаписью META_NAME_ENTRY.
    const safeName = sanitizeFileName(buildName)
    const archivePath = path.join(app.getPath("temp"), `${safeName}.zip`)
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      try { await fs.access(intentPath) } catch { return { success: false, error: "Сборка не найдена" } }

      const id = uploadId ?? `build-${safeName}`

      // Иконка сборки хранится в БД (data-URL), в папке интента её нет.
      // Кладём её в архив отдельной метазаписью, чтобы при восстановлении из
      // облака сборка получила ту же иконку. Имя в облаке могло быть нормализовано,
      // поэтому ищем запись тем же нестрогим сравнением, что и в UI облачного браузера.
      const builds = await dbHelpers.loadBuildsLight()
      const norm = (s: string) => s.trim().toLowerCase()
      const target = norm(buildName)
      const buildIcon = builds.find((b) => {
        const candidate = norm(b.name)
        return candidate === target || candidate.includes(target) || target.includes(candidate)
      })?.icon ?? ""

      await uploadWithProgress(id, "zip", () => createBuildZipInWorker(intentPath, archivePath, id, categories, buildIcon, buildName))

      const provider = getProvider(providerId)
      const result = await uploadWithProgress(id, "upload", () =>
        provider.uploadFile(archivePath, `builds/${safeName}.zip`, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )

      return result
    } catch (e) {
      return opFailure(e)
    } finally {
      // Временный архив убираем всегда: раньше unlink стоял только на успешном
      // пути, и при ошибке zip оставался висеть в temp.
      try { await fs.unlink(archivePath) } catch { /* noop */ }
    }
  })

  ipcMain.handle("cloud:upload-server", async (_event, providerId: CloudProviderId, serverId: string, serverName: string, uploadId?: string, categories?: string[]) => {
    const safeName = serverName.replace(/[/\\?%*:|"<>]/g, "_").trim() || serverId
    const archivePath = path.join(app.getPath("temp"), `server-${safeName}.zip`)
    try {
      const serverDir = getMcServerDir(serverId)
      try { await fs.access(serverDir) } catch { return { success: false, error: "Папка сервера пуста или не найдена" } }

      const id = uploadId ?? `server-${serverId}`

      // Иконка сервера хранится в БД (data-URL), в папке сервера её нет —
      // кладём в архив метазаписью, чтобы при восстановлении она не терялась.
      const serverRow = await dbHelpers.getMcServer(serverId).catch(() => null)

      await uploadWithProgress(id, "zip", () => createBuildZipInWorker(serverDir, archivePath, id, categories, serverRow?.icon ?? "", serverName))

      const provider = getProvider(providerId)
      const result = await uploadWithProgress(id, "upload", () =>
        provider.uploadFile(archivePath, `servers/${safeName}.zip`, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )

      return result
    } catch (e) {
      return opFailure(e)
    } finally {
      try { await fs.unlink(archivePath) } catch { /* noop */ }
    }
  })

  ipcMain.handle("cloud:upload-account", async (_event, providerId: CloudProviderId, account: { id: string; type: string; username: string; uuid?: string }) => {
    const jsonPath = path.join(app.getPath("temp"), `${account.username}.json`)
    try {
      await fs.writeFile(jsonPath, JSON.stringify(account, null, 2))
      const provider = getProvider(providerId)
      const id = account.id
      const result = await uploadWithProgress(id, "upload", () =>
        provider.uploadFile(jsonPath, `accounts/${account.username}.json`, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )
      return result
    } catch (e) {
      return opFailure(e)
    } finally {
      try { await fs.unlink(jsonPath) } catch { /* noop */ }
    }
  })

  ipcMain.handle("cloud:download-and-import", async (_event, providerId: CloudProviderId, remotePath: string, fileType: string, selectedCategories?: string[]) => {
    const fileName = path.basename(remotePath)
    const localPath = path.join(app.getPath("temp"), fileName)
    try {
      const provider = getProvider(providerId)
      const dlResult = await provider.downloadFile(remotePath, localPath)
      if (!dlResult.success) return { success: false, error: dlResult.error }

      if (fileType === "account") {
        const text = await fs.readFile(localPath, "utf-8")
        const account = JSON.parse(text) as { id: string; type: string; username: string; uuid?: string }
        return { success: true, account }
      } else if (fileType === "instance") {
        const AdmZip = (await import("adm-zip")).default
        const buffer = await fs.readFile(localPath)
        const zip = new AdmZip(buffer)

        // Настоящее имя сборки лежит в архиве метазаписью: имя файла в облаке
        // санитизировано (`:` -> `_`), и по нему сборка называлась бы неправильно.
        let buildName = fileName.replace(/\.zip$/i, "")
        try {
          const nameEntry = zip.getEntry(META_NAME_ENTRY)
          const storedName = nameEntry?.getData().toString("utf-8").trim()
          if (storedName) buildName = storedName
        } catch { /* старые архивы без метазаписи — берём имя файла */ }

        const intentPath = await ensureBuildIntentDir(buildName)

        if (selectedCategories && selectedCategories.length > 0) {
          extractSelectedCategories(zip, intentPath, BUILD_CATEGORY_DIRS, selectedCategories)
        } else {
          zip.extractAllTo(intentPath, true)
        }

        // Лёгкий список: тяжёлый контент существующих сборок сохранит сам
        // saveAllBuilds (пустые значения для новой сборки — это её реальный старт).
        const existingBuilds = await dbHelpers.loadBuildsLight()

        // Иконка восстанавливается из метазаписи архива (её писала загрузка сборки).
        // Читаем напрямую из zip: выборочный импорт категорий эту запись не извлекает.
        let restoredIcon = ""
        try {
          const iconEntry = zip.getEntry(META_ICON_ENTRY)
          if (iconEntry) restoredIcon = iconEntry.getData().toString("utf-8").trim()
        } catch { /* noop */ }

        existingBuilds.push({
          id: `cloud-${Date.now()}`,
          name: buildName,
          description: "",
          version: "1.0",
          modLoader: "",
          icon: restoredIcon,
          createdAt: new Date().toISOString(),
          source: "local",
          intentPath,
          loaderVersion: undefined,
          projectSlug: undefined,
          playtime: 0,
          modsCount: 0,
          resourcepacksCount: 0,
          shadersCount: 0,
        })
        await dbHelpers.saveAllBuilds(existingBuilds)
        return { success: true }
      } else if (fileType === "server") {
        const serverName = fileName.replace(/\.zip$/i, "").replace(/^server-/i, "")
        const AdmZip = (await import("adm-zip")).default
        const buffer = await fs.readFile(localPath)
        const serverId = `server-${Date.now()}`
        const serverDir = getMcServerDir(serverId)
        await fs.mkdir(serverDir, { recursive: true })
        const zip = new AdmZip(buffer)

        if (selectedCategories && selectedCategories.length > 0) {
          extractSelectedCategories(zip, serverDir, SERVER_CATEGORY_DIRS, selectedCategories)
        } else {
          zip.extractAllTo(serverDir, true)
        }

        // В архиве уже есть server.properties — читаем из него реальные порт,
        // online-mode и max-players, чтобы метаданные сервера не были фиктивными.
        const props = await readServerProperties(serverDir)

        // Иконка восстанавливается из метазаписи архива (её писала загрузка сервера).
        // Читаем напрямую из zip: выборочный импорт категорий эту запись не извлекает.
        let restoredIcon: string | null = null
        try {
          const iconEntry = zip.getEntry(META_ICON_ENTRY)
          if (iconEntry) {
            const text = iconEntry.getData().toString("utf-8").trim()
            if (text) restoredIcon = text
          }
        } catch { /* noop */ }

        await dbHelpers.createMcServer({
          id: serverId,
          name: serverName,
          // Версию игры в server.properties не пишут — оставляем текущий дефолт БД,
          // а не «1.20.1»: он всё равно уточнится при первом запуске/анализе JAR.
          gameVersion: "1.21.4",
          modloader: "vanilla",
          modloaderVersion: null,
          port: props.port,
          xmx: 2048,
          xms: 1024,
          extraJavaArgs: "",
          javaPath: null,
          autoRestart: 0,
          icon: restoredIcon,
          relayEnabled: 0,
          onlineMode: props.onlineMode ? 1 : 0,
          maxPlayers: props.maxPlayers,
          createdAt: new Date().toISOString(),
          trashedAt: null,
          customJar: null,
          source: "local",
        })

        return { success: true }
      }

      return { success: true }
    } catch (e) {
      return opFailure(e)
    } finally {
      // Скачанный во временную папку архив убираем на любом пути выхода.
      try { await fs.unlink(localPath) } catch { /* noop */ }
    }
  })
}
