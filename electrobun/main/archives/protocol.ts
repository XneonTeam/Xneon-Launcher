export type ArchiveWorkerInput = { path: string } | { data: Uint8Array }

export interface ArchiveExtractRequest {
  type: "extract"
  id: number
  input: ArchiveWorkerInput
  destination: string
  /** `null` — распаковать всё, иначе только записи с этими именами. */
  entries: string[] | null
  stripPrefix?: string
  sanitizeNames?: boolean
  overwrite?: boolean
  skipUnsafe?: boolean
  maxEntries?: number
  maxTotalSize?: number
  maxEntrySize?: number
  maxCompressionRatio?: number
  symlinks?: "skip" | "error"
  progressIntervalMs?: number
}

export type ArchiveWorkerPackSource =
  | { kind: "file"; filePath: string; entryName: string; mtimeMs?: number }
  | { kind: "data"; data: Uint8Array; entryName: string; mtimeMs?: number }

export interface ArchivePackRequest {
  type: "pack"
  id: number
  sources: ArchiveWorkerPackSource[]
  outputPath: string
  level?: number
  progressIntervalMs?: number
}

export interface ArchiveAbortRequest {
  type: "abort"
  id: number
}

export type ArchiveWorkerRequest = ArchiveExtractRequest | ArchivePackRequest | ArchiveAbortRequest

export interface ArchiveWorkerProgress {
  type: "progress"
  id: number
  done: number
  total: number
  bytes: number
  name: string
}

export interface ArchiveWorkerResult {
  type: "result"
  id: number
  files: number
  bytes: number
  skipped: number
}

export interface ArchiveWorkerError {
  type: "error"
  id: number
  code: string
  message: string
}

export type ArchiveWorkerResponse = ArchiveWorkerProgress | ArchiveWorkerResult | ArchiveWorkerError
