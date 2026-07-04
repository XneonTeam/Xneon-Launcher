// P2P logger — mirrors client/logger.py.
// Emits each formatted line to the renderer via sendToRenderer("p2p:log", entry).

import type { P2PLogLevel } from "@xnlc/types" with { "resolution-mode": "import" }

export type { P2PLogLevel }

export type P2PLogCallback = (level: P2PLogLevel, ts: string, prefix: string, message: string) => void

const LEVEL_ORDER: Record<P2PLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class P2PLogger {
  constructor(
    private prefix = "",
    private minLevel: P2PLogLevel = "debug",
    private onLog?: P2PLogCallback,
  ) {}

  child(suffix: string): P2PLogger {
    return new P2PLogger(this.prefix + suffix, this.minLevel, this.onLog)
  }

  setLevel(level: P2PLogLevel): void {
    this.minLevel = level
  }

  debug(msg: string, ...args: unknown[]): void {
    this.emit("debug", msg, args)
  }
  log(msg: string, ...args: unknown[]): void {
    this.emit("info", msg, args)
  }
  info(msg: string, ...args: unknown[]): void {
    this.emit("info", msg, args)
  }
  warning(msg: string, ...args: unknown[]): void {
    this.emit("warn", msg, args)
  }
  warn(msg: string, ...args: unknown[]): void {
    this.emit("warn", msg, args)
  }
  error(msg: string, ...args: unknown[]): void {
    this.emit("error", msg, args)
  }

  private emit(level: P2PLogLevel, msg: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return
    const formatted = args.length > 0 ? formatMsg(msg, args) : msg
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19)
    const line = `[${ts}] [${level.toUpperCase()}] ${this.prefix}${formatted}`
    // eslint-disable-next-line no-console
    console.log(line)
    this.onLog?.(level, ts, this.prefix, formatted)
  }
}

// Minimal printf-style %s/%d/%j formatter matching Python's msg % args.
function formatMsg(msg: string, args: unknown[]): string {
  let i = 0
  return msg.replace(/%([sdj%])/g, (_, spec: string) => {
    if (spec === "%") return "%"
    const arg = args[i++]
    if (arg === undefined) return "undefined"
    if (spec === "s") return typeof arg === "string" ? arg : JSON.stringify(arg)
    if (spec === "d") return String(Number(arg))
    return JSON.stringify(arg)
  })
}
