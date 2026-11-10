export function withinDeadline<T>(operation: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout) }),
  ]).finally(() => clearTimeout(timer))
}

export class OperationGate {
  blocked = false
  private readonly pending = new Set<Promise<unknown>>()

  run<T>(operation: () => T): T {
    if (this.blocked) throw new Error("Launcher is preparing to restart.")
    const result = operation()
    if (result && typeof (result as { then?: unknown }).then === "function") {
      const tracked = Promise.resolve(result)
      this.pending.add(tracked)
      const remove = () => { this.pending.delete(tracked) }
      void tracked.then(remove, remove)
    }
    return result
  }

  drain(timeout: number) {
    return withinDeadline(Promise.allSettled(this.pending), timeout, "Active operations did not finish before update.")
  }
}

export const launcherOperations = new OperationGate()
