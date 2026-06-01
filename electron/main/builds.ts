import { app, dialog, ipcMain } from "electron"
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { cfFetch } from "./curseforge"
import { getMainWindow, sendToRenderer } from "./runtime"
import { getGameDir } from "./minecraft-core"

type ModrinthVersion = {
  id: string
  version_type?: string
  game_versions?: string[]
  files?: ModrinthVersionFile[]
}

type ModrinthVersionFile = {
  filename?: string
  url?: string
  primary?: boolean
}

type ModrinthIndexFile = {
  env?: { client?: string }
  path?: string
  downloads?: string[]
  hashes?: { sha512?: string; sha1?: string }
}

type ModrinthManifest = {
  name?: string
  summary?: string
  slug?: string
  version?: string
  dependencies?: Record<string, string>
  files?: ModrinthIndexFile[]
}

type CurseForgeFile = {
  env?: { client?: string }
  displayName?: string
  downloadUrl?: string
  fileLength?: number
  projectID?: number
  fileID?: number
  primary?: boolean
  id?: number
}

export type ImportModEntry = {
  id: string
  slug: string
  name: string
  description: string
  version: string
  icon_url?: string
  source?: "local" | "modrinth" | "curseforge"
  projectId?: string
  modId?: number
  author?: string
}

export type ScannedBuildContent = {
  mods: ImportModEntry[]
  resourcepacks: ImportModEntry[]
  shaders: ImportModEntry[]
  installedMods: Record<string, string>
}

type ImportResult = {
  success: boolean
  error?: string
  cancelled?: boolean
  version?: string
  modLoader?: string
  loaderVersion?: string
  mods?: ImportModEntry[]
  resourcepacks?: ImportModEntry[]
  shaders?: ImportModEntry[]
  installedMods?: Record<string, string>
}

type OpenImportResult = ImportResult & {
  name?: string
  description?: string
  icon?: string
  source?: "modrinth" | "curseforge"
  intentPath?: string
}

let activeImportController: AbortController | null = null

class ImportCancelledError extends Error {
  constructor() {
    super("Импорт отменен")
    this.name = "ImportCancelledError"
  }
}

function isImportCancelledError(error: unknown): boolean {
  return error instanceof ImportCancelledError
    || (error instanceof Error && (error.name === "AbortError" || error.message === "Импорт отменен"))
}

function throwIfImportCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ImportCancelledError()
  }
}

function startImportSession(): AbortSignal {
  if (activeImportController && !activeImportController.signal.aborted) {
    throw new Error("Импорт уже выполняется")
  }

  activeImportController = new AbortController()
  return activeImportController.signal
}

function finishImportSession(signal: AbortSignal) {
  if (activeImportController?.signal === signal) {
    activeImportController = null
  }
}

function getLoaderSelectionFromModrinthDeps(deps: Record<string, string>): { modLoader: string; loaderVersion?: string } {
  if (deps["fabric-loader"]) return { modLoader: "fabric", loaderVersion: deps["fabric-loader"] }
  if (deps["quilt-loader"]) return { modLoader: "quilt", loaderVersion: deps["quilt-loader"] }
  if (deps["neoforge"]) return { modLoader: "neoforge", loaderVersion: deps["neoforge"] }
  return { modLoader: "vanilla" }
}

function getLoaderSelectionFromCurseManifest(loaderRaw: string): { modLoader: string; loaderVersion?: string } {
  if (!loaderRaw) return { modLoader: "vanilla" }

  const [loaderType, ...versionParts] = loaderRaw.split("-")
  const loaderVersion = versionParts.join("-") || undefined

  if (loaderType === "fabric") return { modLoader: "fabric", loaderVersion }
  if (loaderType === "quilt") return { modLoader: "quilt", loaderVersion }
  if (loaderType === "neoforge") return { modLoader: "neoforge", loaderVersion }
  return { modLoader: "vanilla" }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require("adm-zip") as new (data?: Buffer) => {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
  getEntry(name: string): { getData(): Buffer } | null
  addLocalFolder(localPath: string, readstream?: unknown): void
  writeZip(outputPath: string, keepOrder?: boolean): void
  toBuffer(): Buffer
}

export function getBaseDataRoot(): string {
  if (process.platform === "win32") return path.join(app.getPath("appData"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(app.getPath("home"), "Library", "Application Support", "xneonlauncher")
  return path.join(app.getPath("home"), ".xneonlauncher")
}

export function getBuildIntentDirName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ _-]/g, "_") || "unnamed-build"
}

export function getBuildIntentPath(dirName: string): string {
  const baseDataRoot = getBaseDataRoot()
  const safeName = getBuildIntentDirName(dirName)
  return path.join(baseDataRoot, "intents", safeName)
}

export function ensureBuildIntentDir(dirName: string): string {
  const baseDataRoot = getBaseDataRoot()
  const safeName = getBuildIntentDirName(dirName)
  const intentPath = path.join(baseDataRoot, "intents", safeName)
  if (!fs.existsSync(intentPath)) fs.mkdirSync(intentPath, { recursive: true })
  const modsPath = path.join(intentPath, "mods")
  if (!fs.existsSync(modsPath)) fs.mkdirSync(modsPath, { recursive: true })
  const resourcepacksPath = path.join(intentPath, "resourcepacks")
  if (!fs.existsSync(resourcepacksPath)) fs.mkdirSync(resourcepacksPath, { recursive: true })
  const shaderpacksPath = path.join(intentPath, "shaderpacks")
  if (!fs.existsSync(shaderpacksPath)) fs.mkdirSync(shaderpacksPath, { recursive: true })
  return intentPath
}

export async function downloadBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  throwIfImportCancelled(signal)
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function sanitizeFileName(fileName: string): string {
  const normalized = path.basename(fileName).trim()
  return normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_") || "download.bin"
}

function sanitizeRelativeContentPath(fileName: string): string {
  const segments = fileName
    .replace(/\\/g, "/")
    .split("/")
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => segment.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_"))

  if (segments.length === 0) {
    return "download.bin"
  }

  return path.join(...segments)
}

function getContentDirectoryName(contentType: "mod" | "resourcepack" | "shader"): "mods" | "resourcepacks" | "shaderpacks" {
  if (contentType === "resourcepack") return "resourcepacks"
  if (contentType === "shader") return "shaderpacks"
  return "mods"
}

function saveRemoteContentToIntent(dirName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<string | null> {
  return (async () => {
    try {
      const intentPath = ensureBuildIntentDir(dirName)
      const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
      const safeFileName = sanitizeFileName(fileName)
      const filePath = path.join(targetDir, safeFileName)
      fs.writeFileSync(filePath, await downloadBuffer(url))
      return filePath
    } catch {
      return null
    }
  })()
}

function saveLocalContentToIntent(dirName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string): string | null {
  try {
    const intentPath = ensureBuildIntentDir(dirName)
    const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
    const destPath = path.join(targetDir, sanitizeFileName(path.basename(localFilePath)))
    if (!fs.existsSync(destPath)) fs.copyFileSync(localFilePath, destPath)
    return destPath
  } catch {
    return null
  }
}

function deleteContentFromIntent(dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string): { success: boolean; error?: string } {
  try {
    const intentPath = ensureBuildIntentDir(dirName)
    const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
    const targetPath = path.resolve(targetDir, sanitizeRelativeContentPath(fileName))
    const normalizedTargetDir = `${path.resolve(targetDir)}${path.sep}`

    if (!targetPath.startsWith(normalizedTargetDir) && targetPath !== path.resolve(targetDir)) {
      return { success: false, error: "Invalid target path" }
    }

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true, recursive: true })
    } else {
      const fallbackPath = path.join(targetDir, sanitizeFileName(fileName))
      if (fs.existsSync(fallbackPath)) {
        fs.rmSync(fallbackPath, { force: true, recursive: true })
      }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

type ImportProgressPayload = {
  current: number
  total: number
  message: string
  itemName?: string
}

export function sendImportProgress(current: number, total: number, message: string, itemName?: string) {
  const payload: ImportProgressPayload = { current, total, message }
  if (itemName) payload.itemName = itemName
  sendToRenderer("import:progress", payload)
}

export async function runConcurrent<T>(tasks: (() => Promise<T>)[], concurrency: number, signal?: AbortSignal): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < tasks.length; i += concurrency) {
    throwIfImportCancelled(signal)
    const batch = tasks.slice(i, i + concurrency).map(fn => fn())
    results.push(...await Promise.all(batch))
  }
  return results
}

function copyOverrideEntries(zip: InstanceType<typeof AdmZip>, intentPath: string) {
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("overrides/") && !entry.isDirectory) {
      const relPath = entry.entryName.replace(/^overrides\//, "")
      const destPath = path.join(intentPath, relPath)
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(destPath, entry.getData())
    }
  }
}

function formatDisplayNameFromFileName(fileName: string): string {
  return fileName.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function extractTomlValue(block: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${escapedKey}\\s*=\\s*[\"']([^\"']+)[\"']`, "i"))
  return match?.[1]?.trim()
}

function readArchiveText(zip: InstanceType<typeof AdmZip>, entryName: string): string | null {
  const entry = zip.getEntry(entryName)
  if (!entry) return null
  try {
    return entry.getData().toString("utf-8")
  } catch {
    return null
  }
}

function getArchiveMimeType(entryName: string): string {
  const ext = path.extname(entryName).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".ico") return "image/x-icon"
  return "application/octet-stream"
}

function readArchiveEntryAsDataUrl(zip: InstanceType<typeof AdmZip>, entryName?: string | null): string | undefined {
  if (!entryName) return undefined
  const normalizedEntryName = entryName.replace(/^\/+/, "")
  const entry = zip.getEntry(normalizedEntryName)
  if (!entry) return undefined

  try {
    const data = entry.getData()
    return `data:${getArchiveMimeType(normalizedEntryName)};base64,${data.toString("base64")}`
  } catch {
    return undefined
  }
}

function resolveFabricIconPath(icon: unknown): string | undefined {
  if (typeof icon === "string") {
    return icon
  }

  if (icon && typeof icon === "object") {
    const sizedIcons = Object.entries(icon as Record<string, unknown>)
      .map(([size, iconPath]) => ({ size: Number(size), iconPath }))
      .filter((entry) => Number.isFinite(entry.size) && typeof entry.iconPath === "string")
      .sort((a, b) => b.size - a.size)

    const bestMatch = sizedIcons[0]
    if (bestMatch && typeof bestMatch.iconPath === "string") {
      return bestMatch.iconPath
    }
  }

  return undefined
}

function resolveTomlIconPath(tomlContent: string): string | undefined {
  const firstModBlock = tomlContent.split(/\[\[mods\]\]/i)[1] ?? tomlContent
  return extractTomlValue(firstModBlock, "logoFile") ?? extractTomlValue(tomlContent, "logoFile")
}

function extractAuthors(data: unknown): string | undefined {
  if (!data) return undefined
  if (typeof data === "string") return data.trim() || undefined
  if (Array.isArray(data)) {
    const names = data.map((a: unknown) => {
      if (typeof a === "string") return a.trim()
      if (a && typeof a === "object" && "name" in (a as Record<string, unknown>)) return String((a as Record<string, unknown>).name).trim()
      return null
    }).filter(Boolean) as string[]
    return names.length > 0 ? names.join(", ") : undefined
  }
  return undefined
}

function readModMetadataFromArchive(filePath: string): { name?: string; version?: string; description?: string; icon_url?: string; author?: string } {
  try {
    const zip = new AdmZip(fs.readFileSync(filePath))

    const fabricModJson = readArchiveText(zip, "fabric.mod.json")
    if (fabricModJson) {
      try {
        const parsed = JSON.parse(fabricModJson) as { name?: string; version?: string; description?: string; icon?: unknown; authors?: unknown }
        return {
          name: parsed.name?.trim(),
          version: parsed.version?.trim(),
          description: parsed.description?.trim(),
          icon_url: readArchiveEntryAsDataUrl(zip, resolveFabricIconPath(parsed.icon)),
          author: extractAuthors(parsed.authors),
        }
      } catch {
        // ignore invalid fabric.mod.json
      }
    }

  } catch {
    // ignore unreadable archive
  }

  return {}
}

type IntentContentFile = {
  slug: string
  filePath: string
}

function listIntentContentFiles(dir: string, parentPath = ""): IntentContentFile[] {
  if (!fs.existsSync(dir)) return []

  const files: IntentContentFile[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRelativePath = parentPath ? path.posix.join(parentPath, entry.name) : entry.name
    const filePath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...listIntentContentFiles(filePath, nextRelativePath))
      continue
    }

    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".jar") && !entry.name.endsWith(".zip")) continue
    files.push({ slug: nextRelativePath, filePath })
  }

  return files
}

export function scanIntentDir(intentPath: string): ScannedBuildContent {
  const mods: ImportModEntry[] = []
  const resourcepacks: ImportModEntry[] = []
  const shaders: ImportModEntry[] = []
  const installedMods: Record<string, string> = {}

  const scanDir = (dir: string, targetArray: ImportModEntry[], targetMap: Record<string, string> | null) => {
    for (const { slug, filePath } of listIntentContentFiles(dir)) {
      try {
        const metadata = readModMetadataFromArchive(filePath)
        const fileName = path.basename(slug)
        const entry: ImportModEntry = {
          id: crypto.randomUUID(),
          slug,
          name: metadata.name || formatDisplayNameFromFileName(fileName),
          description: metadata.description || "",
          icon_url: metadata.icon_url,
          version: metadata.version || "local",
          source: "local",
          author: metadata.author,
        }
        targetArray.push(entry)
        if (targetMap !== null) {
          targetMap[slug] = filePath
        }
      } catch { /* skip */ }
    }
  }

  scanDir(path.join(intentPath, "mods"), mods, installedMods)
  scanDir(path.join(intentPath, "resourcepacks"), resourcepacks, null)
  scanDir(path.join(intentPath, "shaderpacks"), shaders, null)

  return { mods, resourcepacks, shaders, installedMods }
}

export function registerBuildHandlers() {
  ipcMain.handle("build:cancel-import", async (): Promise<{ success: boolean }> => {
    if (!activeImportController || activeImportController.signal.aborted) {
      return { success: false }
    }

    activeImportController.abort()
    sendImportProgress(0, 1, "Отмена импорта...")
    return { success: true }
  })

  ipcMain.handle("build:get-intent-path", (_event, dirName: string): string => ensureBuildIntentDir(dirName))

  ipcMain.handle("build:save-mod-to-intent", async (_event, dirName: string, url: string, fileName: string): Promise<string | null> => {
    return await saveRemoteContentToIntent(dirName, "mod", url, fileName)
  })

  ipcMain.handle("build:save-local-mod-to-intent", async (_event, dirName: string, localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, "mod", localFilePath)
  })

  ipcMain.handle("build:save-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<string | null> => {
    return await saveRemoteContentToIntent(dirName, contentType, url, fileName)
  })

  ipcMain.handle("build:save-local-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, contentType, localFilePath)
  })

  ipcMain.handle("build:delete-content-from-intent", (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string): { success: boolean; error?: string } => {
    return deleteContentFromIntent(dirName, contentType, fileName)
  })

  ipcMain.handle("build:set-intent-path", (_event, dirName: string): void => {
    ensureBuildIntentDir(dirName)
  })

  ipcMain.handle("build:delete-intent", (_event, dirName: string): { success: boolean; error?: string } => {
    try {
      const baseDataRoot = getBaseDataRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      if (fs.existsSync(intentPath)) {
        fs.rmSync(intentPath, { recursive: true, force: true })
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:scan-intent-content", (_event, dirName: string): ScannedBuildContent => {
    try {
      const intentPath = ensureBuildIntentDir(dirName)
      return scanIntentDir(intentPath)
    } catch {
      return { mods: [], resourcepacks: [], shaders: [], installedMods: {} }
    }
  })

  ipcMain.handle(
    "content:install-remote",
    async (_event, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        const gameDir = await getGameDir()
        const targetDir = path.join(gameDir, getContentDirectoryName(contentType))
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
        const safeFileName = sanitizeFileName(fileName)
        const filePath = path.join(targetDir, safeFileName)
        fs.writeFileSync(filePath, await downloadBuffer(url))
        return { success: true, filePath }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle("build:import-modrinth", async (_event, buildName: string, projectSlug: string, versionId?: string): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const intentPath = ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение версий...")
      const versionsRes = await fetch(`https://api.modrinth.com/v2/project/${projectSlug}/version`, { signal })
      if (!versionsRes.ok) throw new Error(`Modrinth API: ${versionsRes.status}`)
      const versions = await versionsRes.json() as ModrinthVersion[]
      throwIfImportCancelled(signal)

      let version: ModrinthVersion | undefined = versionId ? versions.find((v) => v.id === versionId) : undefined
      if (!version) version = versions.find((v) => v.version_type === "release") ?? versions[0]
      if (!version) throw new Error("Версии не найдены")

      const mrpackFile = version.files?.find((f) => f.filename?.endsWith(".mrpack"))
      if (!mrpackFile) throw new Error(".mrpack файл не найден")

      if (!mrpackFile?.url) throw new Error("URL для .mrpack файла не найден")
      sendImportProgress(0, 100, "Скачивание пакета...")
      const zip = new AdmZip(await downloadBuffer(mrpackFile.url, signal))
      const indexEntry = zip.getEntry("modrinth.index.json")
      if (!indexEntry) throw new Error("modrinth.index.json не найден")
      const index = JSON.parse(indexEntry.getData().toString("utf-8"))
      throwIfImportCancelled(signal)

      const files: ModrinthIndexFile[] = (index.files as ModrinthIndexFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
      const gameVersion: string = version.game_versions?.[0] ?? index.dependencies?.minecraft ?? ""
      const deps: Record<string, string> = index.dependencies ?? {}
      const loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (deps["fabric-loader"]) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      let downloaded = 0
      const totalFiles = files.length
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: ModrinthIndexFile) => async () => {
        const currentFileName = path.basename(f.path ?? "")
        try {
          throwIfImportCancelled(signal)
          const fileDir = path.join(intentPath, path.dirname(f.path ?? ""))
          const filePath = path.join(fileDir, currentFileName)
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
          if (!fs.existsSync(filePath)) {
            const url = f.downloads?.[0]
            if (!url) throw new Error(`Не найдена ссылка для ${currentFileName}`)
            sendImportProgress(downloaded, totalFiles, "Скачивание файла...", currentFileName)
            fs.writeFileSync(filePath, await downloadBuffer(url, signal))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${currentFileName}`, currentFileName)
          throw new Error(`Не удалось скачать ${currentFileName}: ${message}`)
        } finally {
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} файлов`, currentFileName)
        }
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      copyOverrideEntries(zip, intentPath)
      const scanned = scanIntentDir(intentPath)
      sendImportProgress(totalFiles, totalFiles, "Готово!")
      return { success: true, version: gameVersion, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:import-curseforge", async (_event, buildName: string, modId: number, fileId: number): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const intentPath = ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение ссылки...")
      const urlData = await cfFetch(`/mods/${modId}/files/${fileId}/download-url`) as { data?: string }
      const zipUrl = urlData.data
      throwIfImportCancelled(signal)
      if (!zipUrl) throw new Error("Ссылка на скачивание недоступна")

      sendImportProgress(0, 100, "Скачивание пакета...")
      const zip = new AdmZip(await downloadBuffer(zipUrl, signal))
      const manifestEntry = zip.getEntry("manifest.json")
      if (!manifestEntry) throw new Error("manifest.json не найден")
      const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
      throwIfImportCancelled(signal)

      const mcVersion: string = manifest.minecraft?.version ?? ""
      const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeFile) => m.primary)?.id ?? ""
      const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (loaderRaw.startsWith("fabric")) modLoader = "fabric"
      else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      const modsDir = path.join(intentPath, "mods")
      if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} модов...`)
      const tasks = files.map((f: CurseForgeFile) => async () => {
        let fileName = `mod-${f.fileID}.jar`
        try {
          throwIfImportCancelled(signal)
          const urlRes = await cfFetch(`/mods/${f.projectID}/files/${f.fileID}/download-url`) as { data?: string }
          const fileUrl = urlRes.data
          if (!fileUrl) throw new Error(`Не получена ссылка для ${fileName}`)
          fileName = fileUrl.split("/").pop()?.split("?")[0] ?? fileName
          sendImportProgress(downloaded, totalFiles, "Скачивание мода...", fileName)
          const filePath = path.join(modsDir, fileName)
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, await downloadBuffer(fileUrl, signal))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${fileName}`, fileName)
          throw new Error(`Не удалось скачать ${fileName}: ${message}`)
        }
        downloaded++
        sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} модов`, fileName)
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      copyOverrideEntries(zip, intentPath)
      const scanned = scanIntentDir(intentPath)
      sendImportProgress(totalFiles, totalFiles, "Готово!")
      return { success: true, version: mcVersion, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:open-and-import", async (): Promise<OpenImportResult> => {
    const signal = startImportSession()
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }

      const picked = await dialog.showOpenDialog(win, {
        title: "Импорт модпака",
        properties: ["openFile"],
        filters: [{ name: "Modpacks", extensions: ["mrpack", "zip"] }],
      })
      if (picked.canceled || picked.filePaths.length === 0) return { success: false, error: "Импорт отменён" }

      const selectedFile = picked.filePaths[0]
      throwIfImportCancelled(signal)
      const zip = new AdmZip(fs.readFileSync(selectedFile))
      const mrpackIndex = zip.getEntry("modrinth.index.json")
      const manifestEntry = zip.getEntry("manifest.json")

      if (mrpackIndex) {
        const index = JSON.parse(mrpackIndex.getData().toString("utf-8"))
        const buildName = index.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const intentPath = ensureBuildIntentDir(buildName)
        const files: ModrinthIndexFile[] = (index.files as ModrinthIndexFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
        const deps: Record<string, string> = index.dependencies ?? {}
        const version = deps.minecraft ?? ""
        const loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
if (deps["fabric-loader"]) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      let downloaded = 0
      const totalFiles = files.length
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: ModrinthIndexFile) => async () => {
        const currentFileName = path.basename(f.path ?? "")
        try {
          const fileDir = path.join(intentPath, path.dirname(f.path ?? ""))
          const filePath = path.join(intentPath, f.path ?? "")
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
          if (!fs.existsSync(filePath)) {
            const url = f.downloads?.[0]
            if (!url) throw new Error(`Не найдена ссылка для ${currentFileName}`)
            sendImportProgress(downloaded, totalFiles, "Скачивание файла...", currentFileName)
            fs.writeFileSync(filePath, await downloadBuffer(url, signal))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${currentFileName}`, currentFileName)
          throw new Error(`Не удалось скачать ${currentFileName}: ${message}`)
        } finally {
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} файлов`, currentFileName)
        }
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      copyOverrideEntries(zip, intentPath)
      const scanned = scanIntentDir(intentPath)

      let mrIcon = ""
      try {
          const projectSlug = index.slug ?? buildName.toLowerCase().replace(/\s+/g, "-")
          const projectRes = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}`, { signal })
          if (projectRes.ok) {
            const projectData = await projectRes.json() as { icon_url?: string }
            mrIcon = projectData.icon_url ?? ""
          }
        } catch {}

        return {
          success: true,
          name: buildName,
          description: index.summary ?? "",
          icon: mrIcon,
          version,
          modLoader,
          loaderVersion,
          source: "modrinth",
          intentPath,
          ...scanned,
        }
      }

      if (manifestEntry) {
        const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
        const buildName = manifest.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const intentPath = ensureBuildIntentDir(buildName)
        const version: string = manifest.minecraft?.version ?? ""
        const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeFile) => m.primary)?.id ?? ""
        const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
if (loaderRaw.startsWith("fabric")) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      const modsDir = path.join(intentPath, "mods")
      if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} модов...`)
      const tasks = files.map((f: CurseForgeFile) => async () => {
          let fileName = `mod-${f.fileID}.jar`
          try {
            const urlRes = await cfFetch(`/mods/${f.projectID}/files/${f.fileID}/download-url`) as { data?: string }
            const fileUrl = urlRes.data
            if (!fileUrl) throw new Error(`Не получена ссылка для ${fileName}`)
            fileName = fileUrl.split("/").pop()?.split("?")[0] ?? fileName
            sendImportProgress(downloaded, totalFiles, "Скачивание мода...", fileName)
            const filePath = path.join(modsDir, fileName)
            if (!fs.existsSync(filePath)) {
              fs.writeFileSync(filePath, await downloadBuffer(fileUrl, signal))
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = error instanceof Error ? error.message : String(error)
            sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${fileName}`, fileName)
            throw new Error(`Не удалось скачать ${fileName}: ${message}`)
          }
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} модов`, fileName)
        })
        await runConcurrent(tasks, 5, signal)
        throwIfImportCancelled(signal)
        copyOverrideEntries(zip, intentPath)
        const scanned = scanIntentDir(intentPath)

        let cfIcon = ""
        try {
          const cfSearchRes = await cfFetch("/mods/search", { gameId: "432", searchFilter: buildName, pageSize: "1" }) as { data?: { logo?: { thumbnailUrl?: string } }[] }
          cfIcon = cfSearchRes.data?.[0]?.logo?.thumbnailUrl ?? ""
        } catch {}

        return {
          success: true,
          name: buildName,
          description: manifest.summary ?? manifest.author ?? "",
          icon: cfIcon,
          version,
          modLoader,
          loaderVersion,
          source: "curseforge",
          intentPath,
          ...scanned,
        }
      }

      return { success: false, error: "Неизвестный формат модпака" }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      finishImportSession(signal)
    }
  })
}
