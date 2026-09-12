import { opFailure } from "../errors"
import { ipcMain, shell, app } from "electron"
import path from "path"
import fs from "fs/promises"
import { Worker } from "worker_threads"
import { getProvider, listProviders, type CloudProviderId } from "./registry"
import { ensureBuildIntentDir, getBuildIntentDirName } from "../builds"
import { getMcServerDir } from "../paths"
import { dbHelpers } from "../../db"
import { sendToRenderer } from "../runtime"

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

async function createBuildZipInWorker(intentPath: string, archivePath: string, id: string, categories?: string[]): Promise<void> {
  const workerPath = path.join(__dirname, "upload-worker.js")
  const worker = new Worker(workerPath, { workerData: { intentPath, archivePath, categories } })
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
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      try { await fs.access(intentPath) } catch { return { success: false, error: "Сборка не найдена" } }

      const safeName = getBuildIntentDirName(buildName)
      const archivePath = path.join(app.getPath("temp"), `${safeName}.zip`)
      const id = uploadId ?? `build-${safeName}`

      await uploadWithProgress(id, "zip", () => createBuildZipInWorker(intentPath, archivePath, id, categories))

      const provider = getProvider(providerId)
      const result = await uploadWithProgress(id, "upload", () =>
        provider.uploadFile(archivePath, `builds/${safeName}.zip`, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )

      try { await fs.unlink(archivePath) } catch { /* noop */ }
      return result
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:upload-server", async (_event, providerId: CloudProviderId, serverId: string, serverName: string, uploadId?: string, categories?: string[]) => {
    try {
      const serverDir = getMcServerDir(serverId)
      try { await fs.access(serverDir) } catch { return { success: false, error: "Папка сервера пуста или не найдена" } }

      const safeName = serverName.replace(/[/\\?%*:|"<>]/g, "_").trim() || serverId
      const archivePath = path.join(app.getPath("temp"), `server-${safeName}.zip`)
      const id = uploadId ?? `server-${serverId}`

      await uploadWithProgress(id, "zip", () => createBuildZipInWorker(serverDir, archivePath, id, categories))

      const provider = getProvider(providerId)
      const result = await uploadWithProgress(id, "upload", () =>
        provider.uploadFile(archivePath, `servers/${safeName}.zip`, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )

      try { await fs.unlink(archivePath) } catch { /* noop */ }
      return result
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:upload-account", async (_event, providerId: CloudProviderId, account: { id: string; type: string; username: string; uuid?: string }) => {
    try {
      const jsonPath = path.join(app.getPath("temp"), `${account.username}.json`)
      await fs.writeFile(jsonPath, JSON.stringify(account, null, 2))
      const provider = getProvider(providerId)
      const id = account.id
      const result = await uploadWithProgress(id, "upload", () =>
        provider.uploadFile(jsonPath, `accounts/${account.username}.json`, (percent) => {
          sendUploadProgress(id, percent, "upload")
        })
      )
      try { await fs.unlink(jsonPath) } catch { /* noop */ }
      return result
    } catch (e) {
      return opFailure(e)
    }
  })

  ipcMain.handle("cloud:download-and-import", async (_event, providerId: CloudProviderId, remotePath: string, fileType: string, selectedCategories?: string[]) => {
    try {
      const provider = getProvider(providerId)
      const fileName = path.basename(remotePath)
      const localPath = path.join(app.getPath("temp"), fileName)
      const dlResult = await provider.downloadFile(remotePath, localPath)
      if (!dlResult.success) return { success: false, error: dlResult.error }

      if (fileType === "account") {
        const text = await fs.readFile(localPath, "utf-8")
        const account = JSON.parse(text) as { id: string; type: string; username: string; uuid?: string }
        try { await fs.unlink(localPath) } catch { /* noop */ }
        return { success: true, account }
      } else if (fileType === "instance") {
        const buildName = fileName.replace(/\.zip$/i, "")
        const AdmZip = (await import("adm-zip")).default
        const buffer = await fs.readFile(localPath)
        const intentPath = await ensureBuildIntentDir(buildName)
        const zip = new AdmZip(buffer)

        if (selectedCategories && selectedCategories.length > 0) {
          const CATEGORY_MAP: Record<string, string[]> = {
            mods: ["mods"],
            resourcepacks: ["resourcepacks"],
            shaderpacks: ["shaderpacks"],
            saves: ["saves"],
            data: ["config", "options.txt", "servers.dat"],
            logs: ["logs", "crash-reports"],
          }
          extractSelectedCategories(zip, intentPath, CATEGORY_MAP, selectedCategories)
        } else {
          zip.extractAllTo(intentPath, true)
        }

        const existingBuilds = await dbHelpers.loadBuilds()
        existingBuilds.push({
          id: `cloud-${Date.now()}`,
          name: buildName,
          description: "",
          version: "1.0",
          modLoader: "",
          icon: "",
          mods: [],
          resourcepacks: [],
          shaders: [],
          createdAt: new Date().toISOString(),
          source: "local",
          intentPath,
          loaderVersion: undefined,
          installedMods: {},
          projectSlug: undefined,
          playtime: 0,
        })
        await dbHelpers.saveAllBuilds(existingBuilds)
        try { await fs.unlink(localPath) } catch { /* noop */ }
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
          const CATEGORY_MAP: Record<string, string[]> = {
            world: ["world", "world_nether", "world_the_end"],
            mods: ["mods"],
            plugins: ["plugins"],
            configs: ["config", "eula.txt", "server.properties", "whitelist.json", "ops.json", "banned-players.json", "banned-ips.json", "usercache.json"],
            logs: ["logs", "crash-reports"],
          }
          extractSelectedCategories(zip, serverDir, CATEGORY_MAP, selectedCategories)
        } else {
          zip.extractAllTo(serverDir, true)
        }

        // В архиве уже есть server.properties — читаем из него реальные порт,
        // online-mode и max-players, чтобы метаданные сервера не были фиктивными.
        const props = await readServerProperties(serverDir)

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
          icon: null,
          relayEnabled: 0,
          onlineMode: props.onlineMode ? 1 : 0,
          maxPlayers: props.maxPlayers,
          createdAt: new Date().toISOString(),
          trashedAt: null,
          customJar: null,
          source: "local",
        })

        try { await fs.unlink(localPath) } catch { /* noop */ }
        return { success: true }
      }

      return { success: true }
    } catch (e) {
      return opFailure(e)
    }
  })
}
