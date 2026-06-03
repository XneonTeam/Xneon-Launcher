// ============================================================
// XNLC — Output Relay
// Processes Minecraft stdout/stderr line-by-line with filtering
// Extracted from minecraft-launch-worker.ts
// ============================================================

import iconv from "iconv-lite"

export type OutputRelayCallback = (payload: Record<string, unknown>) => void

/**
 * Buffers and filters Minecraft process output, relaying
 * complete lines through a callback. Suppresses known noisy
 * stack traces (e.g. MinecraftResources FileNotFoundException).
 */
export class OutputRelay {
  private buffer = ""
  private suppressingMinecraftResources = false

  constructor(
    private readonly channel: "stdout" | "stderr",
    private readonly sendFn: OutputRelayCallback,
  ) {}

  push(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : iconv.decode(chunk, "cp866")
    this.buffer += text
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ""

    for (const line of lines) {
      this.processLine(line)
    }
  }

  flush(): void {
    if (!this.buffer) return
    this.processLine(this.buffer)
    this.buffer = ""
  }

  private processLine(line: string): void {
    if (this.shouldSuppressMinecraftResourcesLine(line)) {
      return
    }

    this.sendFn({ type: this.channel, data: `${line}\n` })
  }

  private shouldSuppressMinecraftResourcesLine(line: string): boolean {
    const trimmed = line.trim()
    const startsMinecraftResources = trimmed === "java.io.FileNotFoundException: http://s3.amazonaws.com/MinecraftResources/"

    if (startsMinecraftResources) {
      this.suppressingMinecraftResources = true
      return true
    }

    if (!this.suppressingMinecraftResources) {
      return false
    }

    if (!trimmed) {
      this.suppressingMinecraftResources = false
      return true
    }

    if (trimmed.startsWith("at ") || trimmed === "Caused by:" || trimmed.startsWith("Caused by: ")) {
      return true
    }

    this.suppressingMinecraftResources = false
    return false
  }
}
