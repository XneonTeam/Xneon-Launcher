import { parentPort } from "node:worker_threads"
import { analyze } from "./metadata.js"
import { ParserError, type ArchiveOptions } from "./archive.js"

if (!parentPort) throw new Error("Parser worker requires a parent port")
const port = parentPort
let current: { id: number; controller: AbortController } | undefined
port.on("message", async (message: { type: "analyze" | "cancel"; id: number; path?: string; options?: ArchiveOptions }) => {
  if (message.type === "cancel") { if (current?.id === message.id) current.controller.abort(); return }
  if (current || typeof message.path !== "string") { port.postMessage({ id: message.id, failureCode: "IO_ERROR", failureMessage: "Invalid worker request" }); return }
  const controller = new AbortController()
  current = { id: message.id, controller }
  try {
    const result = await analyze(message.path, { ...message.options, signal: controller.signal })
    port.postMessage({ id: message.id, result })
  } catch (error) {
    port.postMessage({ id: message.id, failureCode: error instanceof ParserError ? error.code : "IO_ERROR", failureMessage: error instanceof Error ? error.message : "Worker failed" })
  } finally { current = undefined }
})
