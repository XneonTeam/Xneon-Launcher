import { access } from "node:fs/promises"
import {
  ArchiveError,
  extractArchive,
  listArchiveEntries,
  packArchive,
  readArchiveEntries,
  readArchiveEntriesText,
  readArchiveEntry,
  type ArchiveDataSource,
  type ArchiveEntryInfo,
  type ArchiveExtractOptions,
  type ArchiveExtractProgress,
  type ArchiveExtractResult,
  type ArchiveFileSource,
  type ArchiveInput,
  type ArchivePackOptions,
  type ArchiveReadOptions,
  type ArchiveTextOptions,
} from "@xnlc/archives"
import { bundledWorker } from "../../platform/resources"
import type {
  ArchiveExtractRequest,
  ArchivePackRequest,
  ArchiveWorkerPackSource,
  ArchiveWorkerRequest,
  ArchiveWorkerResponse,
  ArchiveWorkerResult,
} from "./protocol"

export type ArchiveServiceExtractOptions = Omit<ArchiveExtractOptions, "include"> & {
  /** Фильтр применяется к списку записей в main, в worker уходят только имена. */
  include?: (entry: ArchiveEntryInfo) => boolean
}

export type ArchiveServicePackSource = ArchiveFileSource | ArchiveDataSource

export type ArchiveServicePackOptions = Omit<ArchivePackOptions, "onProgress"> & {
  onProgress?: (progress: ArchiveExtractProgress) => void
}

let nextRequestId = 1

function workerInput(input: ArchiveInput): ArchiveExtractRequest["input"] {
  return typeof input === "string" ? { path: input } : { data: input }
}

async function hasArchiveWorker(): Promise<boolean> {
  try {
    await access(bundledWorker("archive-worker"))
    return true
  } catch {
    return false
  }
}

function toWorkerError(response: Extract<ArchiveWorkerResponse, { type: "error" }>): ArchiveError {
  const code = response.code === "ABORTED" || response.code === "LIMIT_EXCEEDED" || response.code === "UNSAFE_ENTRY" || response.code === "UNSUPPORTED_METHOD" || response.code === "INVALID_ARCHIVE" || response.code === "IO_ERROR"
    ? response.code
    : "IO_ERROR"
  return new ArchiveError(code, response.message)
}

async function runInWorker(
  request: Exclude<ArchiveWorkerRequest, { type: "abort" }>,
  signal: AbortSignal | undefined,
  onProgress?: (progress: ArchiveExtractProgress) => void,
): Promise<ArchiveWorkerResult> {
  const worker = new Worker(bundledWorker("archive-worker"), { smol: true })
  const abort = () => worker.postMessage({ type: "abort", id: request.id })
  signal?.addEventListener("abort", abort, { once: true })
  try {
    return await new Promise<ArchiveWorkerResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
        const response = event.data
        if (!response || response.id !== request.id) return
        if (response.type === "progress") {
          onProgress?.({ done: response.done, total: response.total, bytes: response.bytes, name: response.name })
          return
        }
        if (response.type === "error") {
          reject(toWorkerError(response))
          return
        }
        resolve(response)
      }
      worker.onerror = (event: ErrorEvent) => {
        reject(new ArchiveError("IO_ERROR", event.message || "Archive worker failed"))
      }
      if (signal?.aborted) {
        reject(new ArchiveError("ABORTED", "Archive operation cancelled"))
        return
      }
      worker.postMessage(request)
    })
  } finally {
    signal?.removeEventListener("abort", abort)
    await Promise.resolve(worker.terminate())
  }
}

/**
 * Фасад архивных операций main-процесса.
 *
 * Тяжёлые распаковка и упаковка уходят в Bun Worker (`smol`, один воркер на
 * операцию, завершается в `finally`), поэтому главный поток не блокируется.
 * Чтение метаданных и небольших записей выполняется на месте: запуск воркера
 * стоил бы дороже самого чтения.
 */
export class ArchiveService {
  async list(input: ArchiveInput, options: { signal?: AbortSignal } = {}): Promise<ArchiveEntryInfo[]> {
    return listArchiveEntries(input, options)
  }

  async extract(input: ArchiveInput, destination: string, options: ArchiveServiceExtractOptions = {}): Promise<ArchiveExtractResult> {
    const { include, ...rest } = options
    const entries = include ? await listArchiveEntries(input, { signal: rest.signal }) : null
    const allowed = include ? entries!.filter((entry) => include(entry)).map((entry) => entry.name) : null
    if (await hasArchiveWorker()) {
      const request: ArchiveExtractRequest = {
        type: "extract",
        id: nextRequestId++,
        input: workerInput(input),
        destination,
        entries: allowed,
        stripPrefix: rest.stripPrefix,
        sanitizeNames: rest.sanitizeNames,
        overwrite: rest.overwrite,
        skipUnsafe: rest.skipUnsafe,
        maxEntries: rest.maxEntries,
        maxTotalSize: rest.maxTotalSize,
        symlinks: rest.symlinks,
        progressIntervalMs: rest.progressIntervalMs,
      }
      const result = await runInWorker(request, rest.signal, rest.onProgress)
      return { files: result.files, bytes: result.bytes, skipped: result.skipped }
    }
    return extractArchive(input, destination, options)
  }

  async pack(sources: ArchiveServicePackSource[], outputPath: string, options: ArchiveServicePackOptions = {}): Promise<void> {
    if (await hasArchiveWorker()) {
      const workerSources: ArchiveWorkerPackSource[] = sources.map((source) =>
        "filePath" in source
          ? { kind: "file", filePath: source.filePath, entryName: source.entryName, mtimeMs: source.mtime?.getTime() }
          : { kind: "data", data: source.data, entryName: source.entryName, mtimeMs: source.mtime?.getTime() },
      )
      const request: ArchivePackRequest = {
        type: "pack",
        id: nextRequestId++,
        sources: workerSources,
        outputPath,
        level: options.level,
        progressIntervalMs: options.progressIntervalMs,
      }
      await runInWorker(request, options.signal, options.onProgress)
      return
    }
    await packArchive(sources, outputPath, options)
  }

  async readEntriesText(input: ArchiveInput, names: string[], options: ArchiveTextOptions = {}): Promise<Map<string, string>> {
    return readArchiveEntriesText(input, names, options)
  }

  async readEntryBuffer(input: ArchiveInput, name: string, options: ArchiveReadOptions = {}): Promise<Buffer | null> {
    return readArchiveEntry(input, name, options)
  }

  async readEntries(input: ArchiveInput, names: string[], options: ArchiveReadOptions = {}): Promise<Map<string, Buffer>> {
    return readArchiveEntries(input, names, options)
  }
}

export const archiveService = new ArchiveService()
