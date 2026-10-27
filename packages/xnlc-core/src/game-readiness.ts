/** Общий критерий готовности Minecraft для интерфейса и Discord RPC. */
export const GAME_READY_RE = /Sound engine started|OpenAL initialized|Created: \d+x\d+x\d+ .*-atlas|Narrator library for .* successfully loaded/i
export const GAME_READY_FALLBACK_MS = 45_000

export class GameReadinessTracker {
  private started = false
  private stopped = false
  private ready = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private buffers = { stdout: "", stderr: "" }

  constructor(private readonly onReady: () => void, private readonly fallbackMs = GAME_READY_FALLBACK_MS) {}

  start(): void {
    if (this.started || this.stopped) return
    this.started = true
    this.timer = setTimeout(() => this.markReady(), this.fallbackMs)
    this.timer.unref?.()
  }

  push(channel: "stdout" | "stderr", text: string): void {
    if (!this.started || this.stopped || this.ready) return
    const combined = this.buffers[channel] + text
    if (GAME_READY_RE.test(combined)) this.markReady()
    // Строки могут прийти несколькими порциями; потоки друг с другом не склеиваем.
    this.buffers[channel] = combined.slice(combined.lastIndexOf("\n") + 1).slice(-4096)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.buffers = { stdout: "", stderr: "" }
  }

  private markReady(): void {
    if (!this.started || this.stopped || this.ready) return
    this.ready = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.onReady()
  }
}
