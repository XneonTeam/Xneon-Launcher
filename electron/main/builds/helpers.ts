import { opFailure } from "../errors"
import path from "path"
import fs from "fs/promises"
import { sendToRenderer } from "../runtime"
import { dbHelpers } from "../../db"
import { ensureSharedGameLinksSync } from "../shared-game-cache"
import { fetchWithRetry } from "@xnlc/core/retry"
import { getLauncherDataRoot } from "../paths"

export function getBaseDataRoot(): string {
  return getLauncherDataRoot()
}

let cachedInstancesRoot: string | null = null

/** Loads the configured instances directory (setting `instancesPath`) into the cache. */
export async function loadInstancesRoot(): Promise<string> {
  try {
    const stored = await dbHelpers.getSetting("instancesPath")
    if (stored && stored.trim()) {
      cachedInstancesRoot = stored.trim()
      return cachedInstancesRoot
    }
  } catch {}
  cachedInstancesRoot = getBaseDataRoot()
  return cachedInstancesRoot
}

/** Returns the current instances root (the parent directory that contains `intents/`). */
export function getInstancesRoot(): string {
  return cachedInstancesRoot ?? getBaseDataRoot()
}

export function getBuildIntentDirName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ ._-]/g, "_") || "unnamed-build"
}

export function getBuildIntentPath(dirName: string): string {
  const baseDataRoot = getInstancesRoot()
  const safeName = getBuildIntentDirName(dirName)
  return path.join(baseDataRoot, "intents", safeName)
}

export async function ensureBuildIntentDir(dirName: string): Promise<string> {
  const baseDataRoot = getInstancesRoot()
  const safeName = getBuildIntentDirName(dirName)
  const intentPath = path.join(baseDataRoot, "intents", safeName)
  await fs.mkdir(intentPath, { recursive: true }).catch(() => {})
  const modsPath = path.join(intentPath, "mods")
  await fs.mkdir(modsPath, { recursive: true }).catch(() => {})
  const resourcepacksPath = path.join(intentPath, "resourcepacks")
  await fs.mkdir(resourcepacksPath, { recursive: true }).catch(() => {})
  const shaderpacksPath = path.join(intentPath, "shaderpacks")
  await fs.mkdir(shaderpacksPath, { recursive: true }).catch(() => {})
  ensureSharedGameLinksSync(intentPath)
  return intentPath
}

export async function downloadBuffer(url: string, signal?: AbortSignal, progressFileName?: string): Promise<Buffer> {
  const res = await fetchWithRetry(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)

  if (progressFileName && res.body) {
    const totalHeader = Number(res.headers.get("content-length") || 0)
    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.length
        chunks.push(Buffer.from(value))
        if (totalHeader > 0) {
          sendToRenderer("content:download-progress", { fileName: progressFileName, current: received, total: totalHeader })
        }
      }
    }
    return Buffer.concat(chunks)
  }

  return Buffer.from(await res.arrayBuffer())
}

export function sanitizeFileName(fileName: string): string {
  const normalized = path.basename(fileName).trim()
  return normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_") || "download.bin"
}

export function sanitizeRelativeContentPath(fileName: string): string {
  const segments = fileName
    .replace(/\\/g, "/")
    .split("/")
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => segment.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_"))

  if (segments.length === 0) return "download.bin"

  return path.join(...segments)
}

export function getContentDirectoryName(contentType: "mod" | "resourcepack" | "shader"): "mods" | "resourcepacks" | "shaderpacks" {
  if (contentType === "resourcepack") return "resourcepacks"
  if (contentType === "shader") return "shaderpacks"
  return "mods"
}

export async function saveRemoteContentToIntent(dirName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<string | null> {
  try {
    const intentPath = await ensureBuildIntentDir(dirName)
    const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
    await fs.mkdir(targetDir, { recursive: true }).catch(() => {})
    const safeFileName = sanitizeFileName(fileName)
    const filePath = path.join(targetDir, safeFileName)
    await fs.writeFile(filePath, await downloadBuffer(url, undefined, safeFileName))
    return filePath
  } catch {
    return null
  }
}

export async function saveLocalContentToIntent(dirName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string): Promise<string | null> {
  try {
    const intentPath = await ensureBuildIntentDir(dirName)
    const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
    await fs.mkdir(targetDir, { recursive: true }).catch(() => {})
    const destPath = path.join(targetDir, sanitizeFileName(path.basename(localFilePath)))
    try { await fs.access(destPath) } catch {
      await fs.copyFile(localFilePath, destPath)
    }
    return destPath
  } catch {
    return null
  }
}

export async function deleteContentFromIntent(dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string): Promise<{ success: boolean; error?: string }> {
  const normalizePath = (p: string) => path.resolve(p).toLowerCase()

  try {
    const intentPath = await ensureBuildIntentDir(dirName)
    const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
    const relPath = sanitizeRelativeContentPath(fileName)
    const relBase = path.basename(relPath)
    const normalizedTargetDir = normalizePath(targetDir)

    const isInside = (p: string) => {
      const n = normalizePath(p)
      return n === normalizedTargetDir || n.startsWith(`${normalizedTargetDir}${path.sep}`)
    }

    const candidates = new Set<string>()

    const addTarget = (p: string) => {
      if (isInside(p)) candidates.add(path.resolve(p))
    }
    addTarget(path.join(targetDir, relPath))
    addTarget(path.join(targetDir, relBase))

    // Иногда slug в БД не совпадает с реальным путём файла (например, мод лежит
    // в подпапке или имя файла отличается). Поэтому дополнительно ищем файл по
    // относительному пути и по имени в поддереве папки контента.
    const wantedRel = relPath.toLowerCase().replace(/\\/g, "/")
    const wantedBase = relBase.toLowerCase()
    const walk = async (dir: string): Promise<void> => {
      if (!isInside(dir)) return
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (!isInside(full)) continue
        if (entry.isDirectory()) {
          await walk(full)
          continue
        }
        if (!entry.isFile()) continue
        if (!entry.name.endsWith(".jar") && !entry.name.endsWith(".zip") && !entry.name.endsWith(".disabled")) continue
        const entryRel = path.relative(targetDir, full).toLowerCase().replace(/\\/g, "/")
        if (entryRel === wantedRel || path.basename(entryRel).toLowerCase() === wantedBase) {
          candidates.add(full)
          return
        }
      }
    }
    await walk(targetDir)

    let removed = 0
    for (const candidate of candidates) {
      let existsHere = false
      try { await fs.access(candidate); existsHere = true } catch {}
      if (!existsHere) continue

      let attempts = 0
      for (;;) {
        attempts++
        try {
          await fs.rm(candidate, { force: true, recursive: true })
        } catch {}
        let stillExists = false
        try { await fs.access(candidate); stillExists = true } catch {}
        if (!stillExists) {
          removed++
          break
        }
        if (attempts >= 3) {
          return { success: false, error: `Не удалось удалить файл (возможно, он заблокирован): ${candidate}` }
        }
        await new Promise(r => setTimeout(r, 150 * attempts))
      }
    }

    // Файла на диске уже нет (запись осталась в БД) — тоже считаем удаление
    // успешным, иначе такой мод нельзя будет убрать из списка.
    return { success: true }
  } catch (error) {
    return opFailure(error)
  }
}

/** Renames a content file on disk so Minecraft actually enables or disables it. */
export async function setContentEnabledInIntent(
  dirName: string,
  contentType: "mod" | "resourcepack" | "shader",
  fileName: string,
  enabled: boolean,
): Promise<{ success: boolean; fileName?: string; error?: string }> {
  try {
    const intentPath = await ensureBuildIntentDir(dirName)
    const targetDir = path.resolve(intentPath, getContentDirectoryName(contentType))
    const relPath = sanitizeRelativeContentPath(fileName)
    const requested = path.resolve(targetDir, relPath)
    const isInside = requested.startsWith(`${targetDir}${path.sep}`)
    if (!isInside) return { success: false, error: "Недопустимый путь файла" }

    const disabledSuffix = ".disabled"
    // The DB stores the slug without the .disabled suffix, so the requested
    // path may not exist while the "xxx.jar.disabled" variant does (or vice
    // versa). Resolve whichever variant is actually on disk first — otherwise
    // re-enabling a disabled mod fails with "file not found".
    const barePath = requested.toLowerCase().endsWith(disabledSuffix)
      ? requested.slice(0, -disabledSuffix.length)
      : requested
    const disabledPath = `${barePath}${disabledSuffix}`

    let source = barePath
    let sourceExists = false
    try { await fs.access(source); sourceExists = true } catch {}
    if (!sourceExists) {
      source = disabledPath
      try { await fs.access(source); sourceExists = true } catch {}
    }
    if (!sourceExists) {
      return { success: false, error: "Файл контента не найден" }
    }

    const sourceIsDisabled = source.toLowerCase().endsWith(disabledSuffix)
    const destination = enabled
      ? (sourceIsDisabled ? barePath : source)
      : (sourceIsDisabled ? source : disabledPath)

    if (source !== destination) await fs.rename(source, destination)
    return { success: true, fileName: path.relative(targetDir, destination).replace(/\\/g, "/") }
  } catch (error) {
    return opFailure(error)
  }
}

export type ImportProgressPayload = {
  current: number
  total: number
  message: string
  itemName?: string
}

/**
 * Сообщения прогресса собираются вызывающим кодом вместе со счётчиками,
 * поэтому здесь подстраховываемся: счётчик в тексте не может превышать свой
 * максимум (иначе в UI утекает «51/50» и прочие перескоки).
 */
function clampCountersInMessage(message: string): string {
  return message
    .replace(/(\d+)\s*\/\s*(\d+)/g, (match, rawCurrent: string, rawTotal: string) => {
      const current = Number(rawCurrent)
      const total = Number(rawTotal)
      if (!Number.isFinite(current) || !Number.isFinite(total) || current <= total) return match
      return `${total}/${rawTotal}`
    })
    .replace(/(\d+)\s+из\s+(\d+)/g, (match, rawCurrent: string, rawTotal: string) => {
      const current = Number(rawCurrent)
      const total = Number(rawTotal)
      if (!Number.isFinite(current) || !Number.isFinite(total) || current <= total) return match
      return `${total} из ${rawTotal}`
    })
}

export function sendImportProgress(current: number, total: number, message: string, itemName?: string) {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 1
  const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(Math.floor(current), safeTotal)) : 0
  const payload: ImportProgressPayload = {
    current: safeCurrent,
    total: safeTotal,
    message: clampCountersInMessage(message),
  }
  if (itemName) payload.itemName = itemName
  sendToRenderer("import:progress", payload)
}

export async function runConcurrent<T>(tasks: (() => Promise<T>)[], concurrency: number, signal?: AbortSignal): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency).map(fn => fn())
    results.push(...await Promise.all(batch))
  }
  return results
}

export async function copyOverrideEntries(zip: AdmZipType, intentPath: string) {
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("overrides/") && !entry.isDirectory) {
      const relPath = entry.entryName.replace(/^overrides\//, "")
      const destPath = path.join(intentPath, relPath)
      const destDir = path.dirname(destPath)
      await fs.mkdir(destDir, { recursive: true }).catch(() => {})
      await fs.writeFile(destPath, entry.getData())
    }
  }
}

/**
 * Каталоги, содержимым которых управляет модпак.
 * При смене версии модпака / переустановке они полностью очищаются,
 * иначе файлы старой версии остаются и дублируются с новыми.
 *
 * Пользовательские данные (saves, screenshots, logs, backups, config,
 * defaultconfigs, schematics и т.п.) при этом не трогаются.
 */
const PACK_MANAGED_DIRS = [
  "mods",
  "resourcepacks",
  "shaderpacks",
  "shaders",
  "datapacks",
  "scripts",
  "kubejs",
]

/**
 * Полностью очищает содержимое, которым управляет модпак (моды, ресурспаки, шейдеры и т.п.),
 * сохраняя миры, настройки и прочие пользовательские данные.
 * Используется при смене версии модпака и переустановке.
 */
export async function cleanPackManagedContent(intentPath: string): Promise<void> {
  for (const dir of PACK_MANAGED_DIRS) {
    const target = path.join(intentPath, dir)
    try {
      await fs.rm(target, { recursive: true, force: true, maxRetries: 3 })
    } catch (err) {
      console.warn(`[modpack] Не удалось очистить ${dir}:`, err)
    }
  }
}


export function formatDisplayNameFromFileName(fileName: string): string {
  return fileName.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

export function readArchiveText(zip: AdmZipType, entryName: string): string | null {
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

export function readArchiveEntryAsDataUrl(zip: AdmZipType, entryName?: string | null): string | undefined {
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

export type AdmZipType = {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
  getEntry(name: string): { getData(): Buffer } | null
  addLocalFolder(localPath: string, readstream?: unknown, filter?: (entryPath: string) => boolean): void
  writeZip(outputPath: string, keepOrder?: boolean): void
  toBuffer(): Buffer
}
type AdmZipConstructor = new (data?: Buffer) => AdmZipType

let admZipPromise: Promise<AdmZipConstructor> | null = null
export function loadAdmZip(): Promise<AdmZipConstructor> {
  if (!admZipPromise) {
    admZipPromise = import("adm-zip").then(m => m.default as unknown as AdmZipConstructor)
  }
  return admZipPromise
}

let tomlModulePromise: Promise<{ parse(input: string): Record<string, unknown> }> | null = null
export function loadToml(): Promise<{ parse(input: string): Record<string, unknown> }> {
  if (!tomlModulePromise) {
    tomlModulePromise = import("toml").then(m => m.default || m) as Promise<{ parse(input: string): Record<string, unknown> }>
  }
  return tomlModulePromise
}

let modsModulePromise: Promise<ModsModule> | null = null
export function loadModsModule(): Promise<ModsModule> {
  if (!modsModulePromise) {
    modsModulePromise = import("@xnlc/mods")
  }
  return modsModulePromise
}

import type * as ModsApi from "@xnlc/mods" with { "resolution-mode": "import" }
type ModsModule = typeof ModsApi
export type { ModsModule }

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
  versionId?: string
  fileId?: number
  author?: string
  enabled?: boolean
}

export type ScannedBuildContent = {
  mods: ImportModEntry[]
  resourcepacks: ImportModEntry[]
  shaders: ImportModEntry[]
  installedMods: Record<string, string>
}

export class ImportCancelledError extends Error {
  constructor() {
    super("Импорт отменен")
    this.name = "ImportCancelledError"
  }
}

export function isImportCancelledError(error: unknown): boolean {
  return error instanceof ImportCancelledError
    || (error instanceof Error && (error.name === "AbortError" || error.message === "Импорт отменен"))
}

let activeImportController: AbortController | null = null

export function throwIfImportCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ImportCancelledError()
  }
}

export function startImportSession(): AbortSignal {
  if (activeImportController && !activeImportController.signal.aborted) {
    throw new Error("Импорт уже выполняется")
  }

  activeImportController = new AbortController()
  return activeImportController.signal
}

export function finishImportSession(signal: AbortSignal) {
  if (activeImportController?.signal === signal) {
    activeImportController = null
  }
}

export function cancelImport(): boolean {
  if (!activeImportController || activeImportController.signal.aborted) {
    return false
  }
  activeImportController.abort()
  sendImportProgress(0, 1, "Отмена импорта...")
  return true
}

export function getLoaderSelectionFromModrinthDeps(deps: Record<string, string>): { modLoader: string; loaderVersion?: string } {
  if (deps["fabric-loader"]) return { modLoader: "fabric", loaderVersion: deps["fabric-loader"] }
  if (deps["quilt-loader"]) return { modLoader: "quilt", loaderVersion: deps["quilt-loader"] }
  if (deps["neoforge"]) return { modLoader: "neoforge", loaderVersion: deps["neoforge"] }
  return { modLoader: "vanilla" }
}

export function getLoaderSelectionFromCurseManifest(loaderRaw: string): { modLoader: string; loaderVersion?: string } {
  if (!loaderRaw) return { modLoader: "vanilla" }

  const [loaderType, ...versionParts] = loaderRaw.split("-")
  const loaderVersion = versionParts.join("-") || undefined

  if (loaderType === "fabric") return { modLoader: "fabric", loaderVersion }
  if (loaderType === "quilt") return { modLoader: "quilt", loaderVersion }
  if (loaderType === "neoforge") return { modLoader: "neoforge", loaderVersion }
  return { modLoader: "vanilla" }
}
