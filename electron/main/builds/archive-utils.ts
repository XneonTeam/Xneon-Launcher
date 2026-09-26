// ============================================================
// XNLC — работа с ZIP-архивами и TOML (без electron и БД)
// ============================================================
//
// Утилиты вынесены из `builds/helpers.ts`, потому что тот импортирует
// `dbHelpers` (а `db` тянет electron). Из-за этого модули разбора JAR
// (`jar-inspector`, `metadata`, `loader-requirements`, `jar-dependencies`)
// нельзя было загрузить в worker-потоке холодного сканирования.
//
// Здесь только чистые функции над архивом: ни electron, ни SQLite.

import path from "path"

export type AdmZipToBuffer = {
  (): Buffer
  (
    onSuccess: (data: Buffer) => void,
    onFail: (error: Error) => void,
    onItemStart?: (name: string) => void,
    onItemEnd?: (name: string) => void,
  ): void
}

export type AdmZipType = {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
  getEntry(name: string): { getData(): Buffer } | null
  addLocalFolder(localPath: string, readstream?: unknown, filter?: (entryPath: string) => boolean): void
  addLocalFolderAsync(
    localPath: string,
    callback: (result?: boolean, errorMessage?: string) => void,
    zipPath?: string,
    filter?: (entryPath: string) => boolean,
  ): void
  addFile(entryName: string, content: Buffer): void
  writeZip(outputPath: string, keepOrder?: boolean): void
  toBuffer: AdmZipToBuffer
}

export type AdmZipConstructor = new (data?: Buffer) => AdmZipType

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

export function readArchiveText(zip: AdmZipType, entryName: string): string | null {
  const entry = zip.getEntry(entryName)
  if (!entry) return null
  try {
    return entry.getData().toString("utf-8")
  } catch {
    return null
  }
}

export function getArchiveMimeType(entryName: string): string {
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