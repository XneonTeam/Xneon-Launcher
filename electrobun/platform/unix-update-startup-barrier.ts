/** До commit B разрешены только bootstrap/health и чтение темы; остальные RPC не запускают side effects. */
export class UnixUpdateStartupBarrier {
  private pending: Promise<void> | null = null
  hold(commit: Promise<void>) {
    const waiting = commit.then(() => { if (this.pending === waiting) this.pending = null })
    this.pending = waiting
    void waiting.catch(() => {})
  }
  wait() { return this.pending ?? Promise.resolve() }
  waitForRpc(channel: string) {
    return ["startup:ready", "startup:update-ready", "settings:get", "settings:get-many", "theme:local-list"].includes(channel) ? null : this.pending
  }
  get active() { return this.pending !== null }
}
export const unixUpdateStartupBarrier = new UnixUpdateStartupBarrier()
