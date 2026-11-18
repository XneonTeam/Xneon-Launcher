import { Worker } from "node:worker_threads"
import { availableParallelism } from "node:os"
import path from "node:path"
import { ScanGate } from "./scan-gate.js"
import { inspectJar } from "./jar-inspector.js"
import { analyzeDatapack } from "./datapack.js"
import type { ScanFile, ScanRequest, ScanResult, ScanWorkerCommand, ScanWorkerData, ScanWorkerMessage } from "./scan-worker-protocol.js"

let bundledEntry: string | URL | undefined
const inlineGate = new ScanGate(2)

/** Упакованные приложения могут передать путь к своему собранному worker. */
export function setScanWorkerEntry(entry?: string | URL): void {
  bundledEntry = entry
}

const workerLimit = Math.max(1, Math.min(3, availableParallelism() - 1))
const foreground: Array<() => void> = []
const background: Array<() => void> = []
let activeWorkers = 0
let activeBackgroundWorkers = 0
const blockedFiles = new Map<string, number>()
type StopReading = (files: string[]) => Promise<void>
const readers = new Map<StopReading, Map<string, string[]>>()

function fileKey(file: string): string {
  const absolute = path.resolve(file)
  return process.platform === "win32" ? absolute.toLowerCase() : absolute
}

/** Удаление ждёт только закрытия выбранных файлов и запрещает заново их открыть. */
export async function pauseScanFiles(files: Iterable<string>, remove: () => Promise<void>): Promise<void> {
  const keys = new Set(Array.from(files, fileKey))
  for (const key of keys) blockedFiles.set(key, (blockedFiles.get(key) ?? 0) + 1)
  try {
    await Promise.all([...readers].map(([stop, paths]) => {
      const affected = [...keys].flatMap(key => paths.get(key) ?? [])
      return affected.length ? stop(affected) : undefined
    }))
    await remove()
  } finally {
    for (const key of keys) {
      const count = blockedFiles.get(key) ?? 0
      if (count <= 1) blockedFiles.delete(key)
      else blockedFiles.set(key, count - 1)
    }
  }
}

function drainQueue(): void {
  while (activeWorkers < workerLimit) {
    const next = foreground.shift() ?? (activeBackgroundWorkers < Math.max(1, workerLimit - 1) ? background.shift() : undefined)
    if (!next) break
    next()
  }
}

function queueShard(workerData: ScanWorkerData, onResult: (result: ScanResult) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = workerData.request
    const lowPriority = request.curseforgeFingerprint && !request.sha1 && !request.metadata && !request.loaderRequirements && !request.dependencies
    const queue = lowPriority ? background : foreground
    const abort = () => {
      const index = queue.indexOf(start)
      if (index >= 0) queue.splice(index, 1)
      reject(signal?.reason)
    }
    const start = () => {
      signal?.removeEventListener("abort", abort)
      activeWorkers++
      if (lowPriority) activeBackgroundWorkers++
      void runScanShard(workerData, onResult, signal).then(resolve, reject).finally(() => {
        activeWorkers--
        if (lowPriority) activeBackgroundWorkers--
        drainQueue()
      })
    }
    if (signal?.aborted) { reject(signal.reason); return }
    queue.push(start)
    signal?.addEventListener("abort", abort, { once: true })
    drainQueue()
  })
}

/** Скан в текущем потоке: библиотека используется напрямую, без отдельного файла worker. */
async function runScanInline(
  files: ScanFile[],
  request: ScanRequest,
  onResult: (result: ScanResult) => void,
  signal?: AbortSignal,
): Promise<void> {
  const skipped = new Set<string>()
  const reading = new Map<string, { abort: AbortController; closed: Promise<void> }>()
  const paths = new Map<string, string[]>()
  for (const file of files) {
    const key = fileKey(file.filePath)
    paths.set(key, [...(paths.get(key) ?? []), file.filePath])
  }
  const stop: StopReading = async selected => {
    for (const file of selected) { skipped.add(file); reading.get(file)?.abort.abort() }
    await Promise.all(selected.map(file => reading.get(file)?.closed))
  }
  readers.set(stop, paths)
  try {
  for (let i = 0; i < files.length; i += 8) {
    signal?.throwIfAborted()
    const chunk = files.slice(i, i + 8)
    let deliveryFailed = false
    const settled = await Promise.allSettled(chunk.map(file => inlineGate.run(async (): Promise<ScanResult> => {
      const snapshot = { filePath: file.filePath, size: file.size, mtimeMs: file.mtimeMs }
      if (skipped.has(file.filePath) || blockedFiles.has(fileKey(file.filePath))) return { ...snapshot, error: "Content is being deleted" }
      const abort = new AbortController()
      const closed = Promise.withResolvers<void>()
      const fileSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
      reading.set(file.filePath, { abort, closed: closed.promise })
      try {
        if (request.datapack) return { ...snapshot, datapack: await analyzeDatapack(file.bytes ?? file.filePath, { signal: fileSignal }) }
        const stat = file.size !== undefined && file.mtimeMs !== undefined ? { size: file.size, mtimeMs: file.mtimeMs } : undefined
        return { ...snapshot, inspection: await inspectJar(file.filePath, { ...request, signal: fileSignal }, stat) }
      } catch (error) {
        return { ...snapshot, error: error instanceof Error ? error.message : String(error) }
      } finally {
        reading.delete(file.filePath)
        closed.resolve()
      }
    }, signal).then(result => {
      signal?.throwIfAborted()
      if (deliveryFailed) return
      try {
        if (skipped.has(result.filePath) || blockedFiles.has(fileKey(result.filePath))) onResult({ filePath: result.filePath, error: "Content is being deleted" })
        else onResult(result)
      } catch (error) { deliveryFailed = true; throw error }
    })))
    // При отмене queued-задания отвергаются сразу, но reader-владельцы должны
    // закончить finally до удаления регистрации скана (важно для Windows unlink).
    for (const item of settled) {
      if (item.status === "rejected") throw item.reason
    }
    signal?.throwIfAborted()
    // Уступаем event loop между пачками: основной поток успевает обслужить IPC.
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  } finally { readers.delete(stop) }
}

/** SQLite и обработка результатов остаются в main; большие списки делим между потоками. */
export async function runScanWorker(files: ScanFile[], request: ScanRequest, onResult: (result: ScanResult) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (!files.length) return
  const unique = [...new Map(files.map(file => [file.filePath, file])).values()]
  if (!bundledEntry) return runScanInline(unique, request, onResult, signal)
  const controller = new AbortController()
  const taskSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const count = Math.max(1, Math.min(workerLimit, Math.floor(unique.length / 24)))
  const shards: ScanFile[][] = Array.from({ length: count }, () => [])
  unique.forEach((file, i) => shards[i % count].push(file))
  const results = await Promise.allSettled(shards.map(shard => queueShard({ files: shard, request }, result => {
    try { onResult(result) } catch (error) { controller.abort(error); throw error }
  }, taskSignal)))
  taskSignal.throwIfAborted()
  for (const result of results) if (result.status === "rejected") throw result.reason
}

async function runScanShard(workerData: ScanWorkerData, onResult: (result: ScanResult) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const openable: ScanFile[] = []
  for (const file of workerData.files) {
    if (blockedFiles.has(fileKey(file.filePath))) onResult({ ...file, error: "Content is being deleted" })
    else openable.push(file)
  }
  if (!openable.length) return
  workerData = { ...workerData, files: openable }
  const pending = new Map(workerData.files.map(file => [file.filePath, file]))
  const paths = new Map<string, string[]>()
  for (const { filePath } of openable) {
    const key = fileKey(filePath)
    const aliases = paths.get(key)
    if (aliases) aliases.push(filePath)
    else paths.set(key, [filePath])
  }
  const workerPath = bundledEntry ?? new URL(import.meta.url.endsWith(".ts") ? "./scan-worker.ts" : "./scan-worker.js", import.meta.url)
  await new Promise<void>((resolve, reject) => {
    let worker: Worker | undefined, settled = false, cancelling = false, cancelTimer: ReturnType<typeof setTimeout> | undefined
    let terminal: { error?: unknown } | undefined
    let exitTimer: ReturnType<typeof setTimeout> | undefined
    const paused = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
    const stopReading: StopReading = async files => {
      const next: string[] = []
      const acknowledgements = files.filter(file => pending.has(file)).map(file => {
        let ack = paused.get(file)
        if (!ack) {
          ack = Promise.withResolvers<void>()
          paused.set(file, ack)
          next.push(file)
        }
        return ack.promise
      })
      if (next.length && !settled && !terminal && !cancelling) {
        const command: ScanWorkerCommand = { type: "skip", filePaths: next }
        try { worker?.postMessage(command) } catch (error) { finish(error) }
      }
      await Promise.all(acknowledgements)
    }
    const finish = (error?: unknown, terminate = true) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(cancelTimer)
      clearTimeout(exitTimer)
      signal?.removeEventListener("abort", abort)
      worker?.removeAllListeners("message")
      void (async () => {
        if (terminate) try { await worker?.terminate() } catch {}
        readers.delete(stopReading)
        for (const ack of paused.values()) ack.resolve()
        if (error !== undefined) reject(error)
        else resolve()
      })()
    }
    const waitForExit = (error?: unknown) => {
      terminal = { error }
      // Сначала даём worker закрыть собственный порт и завершиться штатно.
      exitTimer = setTimeout(() => finish(terminal?.error), 500)
    }
    const abort = () => {
      cancelling = true
      if (terminal) { terminal.error = signal?.reason; return }
      try { worker?.postMessage({ type: "cancel" }) } catch { finish(signal?.reason ?? new DOMException("Aborted", "AbortError")); return }
      cancelTimer = setTimeout(() => finish(signal?.reason ?? new DOMException("Aborted", "AbortError")), 5000)
    }
    const timer = setTimeout(() => finish(new Error("Scan worker timed out")), 300000)
    try {
      worker = new Worker(workerPath, { workerData })
      readers.set(stopReading, paths)
      worker.on("message", (message: ScanWorkerMessage) => {
        if (message?.type === "skipped") {
          for (const file of message.filePaths) paused.get(file)?.resolve()
          return
        }
        if (terminal) { finish(new Error("Unexpected message after scan completion")); return }
        if (message?.type === "chunk" && Array.isArray(message.results)) {
          try {
            for (const result of message.results) {
              if (cancelling) break
              const file = pending.get(result.filePath)
              if (!file || file.size !== result.size || file.mtimeMs !== result.mtimeMs) throw new Error("Invalid scan worker result")
              pending.delete(result.filePath)
              onResult(paused.has(result.filePath) ? { filePath: result.filePath, error: "Content is being deleted" } : result)
            }
          } catch (error) { if (!cancelling) finish(error) }
        } else if (message?.type === "done" || message?.type === "cancelled") {
          if (cancelling) waitForExit(signal?.reason ?? new DOMException("Aborted", "AbortError"))
          else if (message.type !== "done" || pending.size || message.inspected !== workerData.files.length) waitForExit(new Error("Incomplete scan worker response"))
          else waitForExit()
        }
        else if (message?.type === "fatal") waitForExit(new Error(message.message))
        else finish(new Error("Invalid scan worker response"))
      })
      worker.on("error", error => finish(error))
      worker.on("exit", code => finish(terminal && code === 0 ? terminal.error : new Error("Scan worker exited before completion"), false))
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
    } catch (error) { finish(error) }
  })
}
