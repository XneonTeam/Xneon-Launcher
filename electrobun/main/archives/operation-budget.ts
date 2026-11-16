/** Простой лимит тяжёлых архивных операций, без пула постоянно живущих Worker. */
export class ArchiveOperationBudget {
  private active = 0
  private readonly waiting: Array<() => void> = []
  constructor(private readonly limit = 2) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid archive concurrency")
  }
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(start)
        if (index >= 0) this.waiting.splice(index, 1)
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
      }
      const start = () => {
        signal?.removeEventListener("abort", abort)
        this.active++
        void Promise.resolve().then(() => { signal?.throwIfAborted(); return operation() }).then(resolve, reject).finally(() => {
          this.active--
          this.drain()
        })
      }
      if (signal?.aborted) { abort(); return }
      this.waiting.push(start)
      signal?.addEventListener("abort", abort, { once: true })
      this.drain()
    })
  }
  private drain(): void {
    while (this.active < this.limit && this.waiting.length) this.waiting.shift()!()
  }
}

export const archiveOperationBudget = new ArchiveOperationBudget(2)
