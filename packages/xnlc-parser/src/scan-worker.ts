import { parentPort, workerData } from "node:worker_threads"
import { inspectJar } from "./jar-inspector.js"
import { analyzeDatapack } from "./datapack.js"
import type { ScanResult, ScanWorkerCommand, ScanWorkerData, ScanWorkerMessage } from "./scan-worker-protocol.js"

const port = parentPort
const { files, request } = workerData as ScanWorkerData
const controller = new AbortController()
const skipped = new Set<string>()
const reading = new Map<string, { controller: AbortController; closed: Promise<void> }>()
const send = (message: ScanWorkerMessage) => port?.postMessage(message)
port?.on("message", (message: ScanWorkerCommand) => {
  if (message.type === "cancel") controller.abort()
  if (message.type === "skip") {
    const closing: Promise<void>[] = []
    for (const filePath of message.filePaths) {
      skipped.add(filePath)
      const reader = reading.get(filePath)
      if (!reader) continue
      reader.controller.abort()
      closing.push(reader.closed)
    }
    void Promise.all(closing).then(() => send({ type: "skipped", filePaths: message.filePaths }))
  }
})

async function run(): Promise<void> {
  if (!port) return
  for (let i = 0; i < files.length; i += 8) {
    if (controller.signal.aborted) break
    const chunk = files.slice(i, i + 8)
    const results = await Promise.all(chunk.map(async (file): Promise<ScanResult> => {
      const snapshot = { filePath: file.filePath, size: file.size, mtimeMs: file.mtimeMs }
      if (skipped.has(file.filePath)) return { ...snapshot, error: "Content is being deleted" }
      const fileController = new AbortController()
      const { promise: closed, resolve } = Promise.withResolvers<void>()
      const signal = AbortSignal.any([controller.signal, fileController.signal])
      reading.set(file.filePath, { controller: fileController, closed })
      try {
        if (request.datapack) return { ...snapshot, datapack: await analyzeDatapack(file.bytes ?? file.filePath, { signal }) }
        const stat = file.size !== undefined && file.mtimeMs !== undefined ? { size: file.size, mtimeMs: file.mtimeMs } : undefined
        return { ...snapshot, inspection: await inspectJar(file.filePath, { ...request, signal }, stat) }
      } catch (error) {
        return { ...snapshot, error: error instanceof Error ? error.message : String(error) }
      } finally {
        reading.delete(file.filePath)
        resolve()
      }
    }))
    if (!controller.signal.aborted) send({ type: "chunk", results })
  }
  send(controller.signal.aborted ? { type: "cancelled" } : { type: "done", inspected: files.length })
  port.close()
}

run().catch(error => { send({ type: "fatal", message: String(error) }); port?.close() })
