import { app } from "electron"
import path from "path"
import fs from "fs/promises"
import { sendToRenderer } from "../runtime"
import { dbHelpers } from "../../db"

export function getBaseDataRoot(): string {
  if (process.platform === "win32") return path.join(app.getPath("appData"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(app.getPath("home"), "Library", "Application Support", "xneonlauncher")
  return path.join(app.getPath("home"), ".xneonlauncher")
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
  return rawName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ _-]/g, "_") || "unnamed-build"
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
  return intentPath
}

export async function downloadBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
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
    await fs.writeFile(filePath, await downloadBuffer(url))
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
  try {
    const intentPath = await ensureBuildIntentDir(dirName)
    const targetDir = path.join(intentPath, getContentDirectoryName(contentType))
    const targetPath = path.resolve(targetDir, sanitizeRelativeContentPath(fileName))
    const normalizedTargetDir = `${path.resolve(targetDir)}${path.sep}`

    if (!targetPath.startsWith(normalizedTargetDir) && targetPath !== path.resolve(targetDir)) {
      return { success: false, error: "Invalid target path" }
    }

    const rmFile = async (fp: string) => {
      try { await fs.rm(fp, { force: true, recursive: true }) } catch {}
    }

    try { await fs.access(targetPath); await rmFile(targetPath) } catch {
      const fallbackPath = path.join(targetDir, sanitizeFileName(fileName))
      try { await fs.access(fallbackPath); await rmFile(fallbackPath) } catch {}
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export type ImportProgressPayload = {
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
  author?: string
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
