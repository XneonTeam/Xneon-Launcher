import { ArchiveError, extractArchive, packArchive, type ArchivePackSource } from "@xnlc/archives"
import type {
  ArchiveWorkerInput,
  ArchiveWorkerRequest,
  ArchiveWorkerResponse,
  ArchiveWorkerResult,
} from "./protocol"

const controllers = new Map<number, AbortController>()

function toArchiveInput(input: ArchiveWorkerInput): string | Uint8Array {
  return "path" in input ? input.path : input.data
}

function send(message: ArchiveWorkerResponse): void {
  self.postMessage(message)
}

function progressHandler(id: number): (progress: { done: number; total: number; bytes: number; name: string }) => void {
  return ({ done, total, bytes, name }) => send({ type: "progress", id, done, total, bytes, name })
}

async function runExtract(request: Extract<ArchiveWorkerRequest, { type: "extract" }>): Promise<ArchiveWorkerResult> {
  const controller = new AbortController()
  controllers.set(request.id, controller)
  try {
    const allowed = request.entries ? new Set(request.entries) : null
    const result = await extractArchive(toArchiveInput(request.input), request.destination, {
      signal: controller.signal,
      stripPrefix: request.stripPrefix,
      sanitizeNames: request.sanitizeNames,
      overwrite: request.overwrite,
      skipUnsafe: request.skipUnsafe,
      maxEntries: request.maxEntries,
      maxTotalSize: request.maxTotalSize,
      include: allowed ? (entry) => allowed.has(entry.name) : undefined,
      onProgress: progressHandler(request.id),
    })
    return { type: "result", id: request.id, files: result.files, bytes: result.bytes, skipped: result.skipped }
  } finally {
    controllers.delete(request.id)
  }
}

async function runPack(request: Extract<ArchiveWorkerRequest, { type: "pack" }>): Promise<ArchiveWorkerResult> {
  const controller = new AbortController()
  controllers.set(request.id, controller)
  try {
    const sources: ArchivePackSource[] = request.sources.map((source) =>
      source.kind === "file"
        ? { kind: "file", filePath: source.filePath, entryName: source.entryName, mtime: source.mtimeMs ? new Date(source.mtimeMs) : undefined }
        : { kind: "data", data: source.data, entryName: source.entryName, mtime: source.mtimeMs ? new Date(source.mtimeMs) : undefined },
    )
    let files = 0
    let bytes = 0
    await packArchive(sources, request.outputPath, {
      signal: controller.signal,
      level: request.level,
      onProgress: (progress) => {
        files = progress.done
        bytes = progress.bytes
        progressHandler(request.id)(progress)
      },
    })
    return { type: "result", id: request.id, files, bytes, skipped: 0 }
  } finally {
    controllers.delete(request.id)
  }
}

self.onmessage = (event: MessageEvent<ArchiveWorkerRequest>) => {
  const request = event.data
  if (!request || typeof request !== "object") return
  if (request.type === "abort") {
    controllers.get(request.id)?.abort()
    return
  }
  const run = request.type === "extract" ? runExtract(request) : runPack(request)
  run.then(
    (result) => send(result),
    (error: unknown) => {
      const code = error instanceof ArchiveError ? error.code : "IO_ERROR"
      const message = error instanceof Error ? error.message : String(error)
      send({ type: "error", id: request.id, code, message })
    },
  )
}
