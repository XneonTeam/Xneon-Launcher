import { access } from "node:fs/promises"
import { archiveOperationBudget } from "./operation-budget"
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
  signal?.throwIfAborted()
  const worker = new Worker(bundledWorker("archive-worker"), { smol: true })
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let cancelTimer: ReturnType<typeof setTimeout> | undefined
  let detach = () => {}
  try {
    return await new Promise<ArchiveWorkerResult>((resolve, reject) => {
      const abort = () => {
        try { worker.postMessage({ type: "abort", id: request.id }) } catch { /* finally завершит worker. */ }
        cancelTimer = setTimeout(() => reject(new ArchiveError("ABORTED", "Archive cancellation timed out")), 5000)
      }
      signal?.addEventListener("abort", abort, { once: true })
      detach = () => signal?.removeEventListener("abort", abort)
      // Прогресс идёт по записям: большой одиночный файл может долго не давать
      // событий. Не считаем отсутствие progress ошибкой; ограничиваем всю задачу.
      deadlineTimer = setTimeout(() => reject(new ArchiveError("IO_ERROR", "Archive operation exceeded its deadline")), 30 * 60_000)
      worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
        const response = event.data
        if (!response || response.id !== request.id) return
        try {
          if (response.type === "progress") {
            if (![response.done, response.total, response.bytes].every(value => Number.isFinite(value) && value >= 0) || typeof response.name !== "string") throw new Error("Invalid archive progress")
            onProgress?.({ done: response.done, total: response.total, bytes: response.bytes, name: response.name })
            return
          }
          if (response.type === "error") { reject(toWorkerError(response)); return }
          signal?.throwIfAborted()
          if (response.type !== "result" || ![response.files, response.bytes, response.skipped].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid archive result")
          resolve(response)
        } catch (error) {
          reject(error)
        }
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
    detach()
    clearTimeout(deadlineTimer)
    clearTimeout(cancelTimer)
    worker.onmessage = null
    worker.onerror = null
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
    return archiveOperationBudget.run(async () => {
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
        maxEntrySize: rest.maxEntrySize,
        maxCompressionRatio: rest.maxCompressionRatio,
        symlinks: rest.symlinks,
        progressIntervalMs: rest.progressIntervalMs,
      }
      const result = await runInWorker(request, rest.signal, rest.onProgress)
      return { files: result.files, bytes: result.bytes, skipped: result.skipped }
    }
    return extractArchive(input, destination, options)
    }, options.signal)
  }

  async pack(sources: ArchiveServicePackSource[], outputPath: string, options: ArchiveServicePackOptions = {}): Promise<void> {
    return archiveOperationBudget.run(async () => {
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
    }, options.signal)
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
