import { Worker } from "node:worker_threads"
import { ParserError, type ArchiveOptions, type ParserErrorCode } from "./archive.js"
import type { ParserResult } from "./metadata.js"

interface Task {
  id: number; path: string; options: Omit<ArchiveOptions, "signal">; signal?: AbortSignal
  resolve: (value: ParserResult) => void; reject: (reason: unknown) => void
  abort?: () => void; settled: boolean
  timer?: ReturnType<typeof setTimeout>
}
type WorkerReply = { id: number; result?: ParserResult; failureCode?: ParserErrorCode; failureMessage?: string }

/** основный последовательный worker с ограниченной очередью файловых задач. */
export class ParserWorker {
  private readonly queue: Task[] = []
  private active?: Task
  private worker?: Worker
  private termination?: Promise<unknown>
  private finishing?: Task
  private nextId = 1
  private closed = false
  private closing?: Promise<void>
  constructor(readonly maxPending = 32, readonly timeoutMs = 30_000) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 10000) throw new RangeError("Invalid worker queue limit")
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new RangeError("Invalid worker deadline")
  }
  analyze(path: string, options: ArchiveOptions = {}): Promise<ParserResult> {
    if (this.closed) return Promise.reject(new ParserError("CLOSED", "Parser worker is closed"))
    if (options.signal?.aborted) return Promise.reject(new ParserError("ABORTED", "Operation aborted"))
    if (this.queue.length + Number(!!this.active) >= this.maxPending) return Promise.reject(new ParserError("LIMIT_EXCEEDED", "Parser worker queue is full"))
    return new Promise((resolve, reject) => {
      const task: Task = { id: this.nextId++, path, options: { limits: options.limits, nested: options.nested }, signal: options.signal, resolve, reject, settled: false }
      task.abort = () => {
        if (task.settled) return
        this.settle(task, new ParserError("ABORTED", "Operation aborted"))
        if (this.active === task) void this.finish(task)
        else { const index = this.queue.indexOf(task); if (index >= 0) this.queue.splice(index, 1) }
      }
      task.signal?.addEventListener("abort", task.abort, { once: true })
      task.timer = setTimeout(() => {
        this.settle(task, new ParserError("TIMEOUT", "Parser worker deadline exceeded"))
        if (this.active === task) void this.finish(task)
        else { const index = this.queue.indexOf(task); if (index >= 0) this.queue.splice(index, 1) }
      }, this.timeoutMs)
      this.queue.push(task)
      this.drain()
    })
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    if (this.closed) return Promise.resolve()
    this.closed = true
    const error = new ParserError("CLOSED", "Parser worker is closed")
    if (this.active) this.settle(this.active, error)
    for (const task of this.queue.splice(0)) this.settle(task, error)
    const worker = this.worker
    this.active = undefined; this.worker = undefined
    const termination = worker ? worker.terminate() : this.termination
    this.closing = Promise.resolve(termination).then(() => {})
    return this.closing
  }
  private settle(task: Task, error?: unknown, value?: ParserResult) {
    if (task.settled) return
    task.settled = true
    clearTimeout(task.timer)
    if (task.abort) task.signal?.removeEventListener("abort", task.abort)
    if (error !== undefined) task.reject(error)
    else task.resolve(value!)
  }
  private drain() {
    if (this.closed || this.active) return
    const task = this.queue.shift()
    if (!task) return
    this.active = task
    try {
      const entry = new URL(import.meta.url.endsWith(".ts") ? "./worker-entry.ts" : "./worker-entry.js", import.meta.url)
      const worker = new Worker(entry)
      this.worker = worker
      worker.on("message", async (message: WorkerReply) => {
        if (this.active !== task || message.id !== task.id) return
        await this.finish(task)
        if (message.failureMessage !== undefined) this.settle(task, new ParserError(message.failureCode ?? "IO_ERROR", message.failureMessage))
        else if (message.result) this.settle(task, undefined, message.result)
        else this.settle(task, new ParserError("IO_ERROR", "Invalid worker response"))
      })
      worker.on("error", error => { if (this.active === task) { this.settle(task, new ParserError("IO_ERROR", error instanceof Error ? error.message : "Worker failed")); void this.finish(task) } })
      worker.on("exit", code => { if (this.active === task) { this.settle(task, new ParserError("IO_ERROR", `Parser worker exited (${code})`)); void this.finish(task) } })
      worker.postMessage({ type: "analyze", id: task.id, path: task.path, options: task.options })
    } catch (error) { this.settle(task, new ParserError("IO_ERROR", error instanceof Error ? error.message : "Unable to start worker")); void this.finish(task) }
  }
  private async finish(task: Task) {
    if (this.active !== task) return
    if (this.finishing === task) { if (this.termination) await this.termination; return }
    this.finishing = task
    const worker = this.worker
    this.worker = undefined
    if (worker) {
      worker.removeAllListeners("exit"); worker.removeAllListeners("error"); worker.removeAllListeners("message")
      worker.on("error", () => {})
      const termination = worker.terminate().catch(() => {})
      this.termination = termination
      await termination
      if (this.termination === termination) this.termination = undefined
    }
    if (this.active === task) this.active = undefined
    if (this.finishing === task) this.finishing = undefined
    this.drain()
  }
}
