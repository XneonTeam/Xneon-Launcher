import { bundledWorker } from "../../platform/resources"
import { Worker } from "worker_threads"
import type { ScanFile, ScanResult, ScanOutcome } from "./scan-worker-protocol"

/** Ответ применяется ровно один раз; fallback начинается только после остановки потока. */
export async function runJarScanWorker(
  files: ScanFile[],
  onResult: (result: ScanResult) => void,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ScanOutcome> {
  const errors: ScanOutcome["errors"] = []
  const processed = new Set<string>(), received = new Set<string>()
  const expected = new Map(files.map(file => [file.filePath, file]))
  if (options.signal?.aborted) return { state: "cancelled", ok: false, processedPaths: [], errors }
  if (!files.length) return { state: "success", ok: true, processedPaths: [], errors }
  return new Promise(resolve => {
    let settled = false, worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (state: ScanOutcome["state"]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
      worker?.removeListener("message", message)
      // error listener остаётся до завершения, чтобы поздний error не стал uncaught.
      void (async () => {
        try { await worker?.terminate() } catch (error) { errors.push({ filePath: "", message: String(error) }); state = "failed" }
        worker?.removeAllListeners()
        resolve({ state, ok: state === "success", processedPaths: [...processed], errors: [...errors] })
      })()
    }
    const abort = () => finish("cancelled")
    const fail = (error: unknown) => {
      if (settled) return
      errors.push({ filePath: "", message: error instanceof Error ? error.message : String(error) })
      finish(processed.size ? "partial" : "failed")
    }
    const message = (value: any) => {
      if (settled) return
      if (!value || typeof value !== "object") return fail("Invalid scan message")
      if (value.type === "chunk") {
        if (!Array.isArray(value.results) || value.results.length > 32) return fail("Invalid scan chunk")
        for (const result of value.results) {
          const file = expected.get(result?.filePath)
          if (!file || result.size !== file.size || result.mtime !== file.mtime
            || !/^[a-f0-9]{40}$/.test(result.inspection?.sha1 ?? "")
            || !result.inspection.metadata || typeof result.inspection.metadata !== "object") return fail("Invalid scan result")
          if (received.has(file.filePath)) { errors.push({ filePath: file.filePath, message: "Duplicate scan result" }); continue }
          received.add(file.filePath)
          try { onResult(result); processed.add(file.filePath) }
          catch (error) { errors.push({ filePath: file.filePath, message: error instanceof Error ? error.message : String(error) }) }
        }
      } else if (value.type === "error") {
        if (typeof value.filePath !== "string" || !expected.has(value.filePath)) return fail(value.message || "Scan failed")
        errors.push({ filePath: value.filePath, message: String(value.message) })
      } else if (value.type === "failed") fail(value.message || "Scan failed")
      else if (value.type === "done") {
        if (!Number.isSafeInteger(value.inspected) || value.inspected !== received.size) errors.push({ filePath: "", message: "Invalid inspected count" })
        finish(processed.size === expected.size && errors.length === 0 ? "success" : processed.size ? "partial" : "failed")
      } else fail("Unknown scan message")
    }
    try { worker = new Worker(bundledWorker("scan-worker"), { workerData: { files } }) }
    catch (error) { fail(error); return }
    worker.on("message", message)
    worker.on("error", fail)
    worker.on("exit", () => { if (!settled) fail("Scan worker exited without terminal result") })
    timer = setTimeout(() => fail("Scan worker timed out"), options.timeoutMs ?? 120_000)
    options.signal?.addEventListener("abort", abort, { once: true })
    if (options.signal?.aborted) abort()
  })
}
