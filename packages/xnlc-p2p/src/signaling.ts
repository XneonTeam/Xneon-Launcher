
// WSS connection, binary heartbeat (UUID 16 bytes + BE double timestamp), receive loop.

import WebSocket from "ws"
import { P2PLogger } from "./logger.js"

const HEARTBEAT_INTERVAL = 4.0 // seconds

export type MessageHandler = (message: string | Buffer) => void

export class SignalingClient {
  private ws: WebSocket | null = null
  private closed = false
  private handlers: MessageHandler[] = []
  private hbTimer: NodeJS.Timeout | null = null
  private hbCount = 0
  private msgRecvCount = 0

  constructor(
    private host: string,
    private groupId: string,
    private clientUuid: string,
    private token: string,
    private log: P2PLogger,
  ) {
    // Normalise host: strip trailing slash and any /group suffix
    this.host = host.replace(/\/+$/, "").replace(/\/group$/, "")
  }

  addMessageHandler(handler: MessageHandler): void {
    if (!this.handlers.includes(handler)) this.handlers.push(handler)
  }

  async connect(maxRetries = 3): Promise<void> {
    const uri = `${this.host}/group/${this.groupId}?client=${this.clientUuid}&token=${encodeURIComponent(this.token)}`
    this.log.log("Connecting to %s", uri)

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log.debug("Attempt %d/%d...", attempt, maxRetries)
        this.ws = await this.openSocket(uri, 15000)
        this.log.log("WebSocket CONNECTED")
        this.startHeartbeat()
        this.startReceiveLoop()
        return
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        this.log.warning("Connect attempt %d/%d failed: %s", attempt, maxRetries, lastError.message)
        if (attempt < maxRetries) {
          const delay = 2.0 * attempt
          this.log.debug("Retrying in %.1fs...", delay)
          await sleep(delay * 1000)
        }
      }
    }
    throw lastError ?? new Error(`Could not connect to signaling server after ${maxRetries} attempts`)
  }

  private openSocket(uri: string, timeoutMs: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(uri)
      const onOpen = () => {
        cleanup()
        resolve(ws)
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const t = setTimeout(() => {
        cleanup()
        try { ws.terminate() } catch { /* noop */ }
        reject(new Error("connect timeout"))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(t)
        ws.removeListener("open", onOpen)
        ws.removeListener("error", onError)
      }
      ws.once("open", onOpen)
      ws.once("error", onError)
    })
  }

  private startHeartbeat(): void {
    this.hbTimer = setInterval(() => {
      if (!this.ws || this.closed) return
      try {
        // 16 bytes UUID + 8 bytes BE double timestamp
        const uuidBytes = Buffer.from(this.clientUuid.replace(/-/g, ""), "hex")
        const tsBuf = Buffer.alloc(8)
        tsBuf.writeDoubleBE(Date.now() / 1000, 0)
        const payload = Buffer.concat([uuidBytes, tsBuf])
        this.ws.send(payload)
        this.hbCount++
        if (this.hbCount % 5 === 0) this.log.log("Heartbeat #%d sent", this.hbCount)
        else this.log.debug("Heartbeat #%d sent", this.hbCount)
      } catch (e) {
        this.log.error("Heartbeat error: %s", e instanceof Error ? e.message : String(e))
        this.stopHeartbeat()
      }
    }, HEARTBEAT_INTERVAL * 1000)
  }

  private stopHeartbeat(): void {
    if (this.hbTimer) {
      clearInterval(this.hbTimer)
      this.hbTimer = null
    }
  }

  private startReceiveLoop(): void {
    if (!this.ws) return
    this.ws.on("message", (data: Buffer, isBinary: boolean) => {
      this.msgRecvCount++
      const isBin = isBinary || Buffer.isBuffer(data)
      const size = Buffer.isBuffer(data) ? data.length : (data as { length?: number }).length ?? 0
      if (this.msgRecvCount % 20 === 0) {
        this.log.debug("Messages received: %d (last: %s %dB)", this.msgRecvCount, isBin ? "binary" : "text", size)
      }
      const message: string | Buffer = isBin ? Buffer.from(data as Uint8Array) : String(data)
      for (const handler of this.handlers) {
        try {
          handler(message)
        } catch (e) {
          this.log.error("Handler error: %s", e instanceof Error ? e.message : String(e))
        }
      }
    })
    this.ws.on("close", (code: number, reason: Buffer) => {
      this.log.log("Connection CLOSED: code=%s reason=%s", code, reason?.toString() || "none")
    })
    this.ws.on("error", (err: Error) => {
      this.log.error("WebSocket error: %s", err.message)
    })
  }

  async send(data: string | Buffer): Promise<void> {
    if (this.ws && !this.closed) {
      this.ws.send(data)
      this.log.debug("Sent %s %dB", Buffer.isBuffer(data) ? "binary" : "text", data.length)
    }
  }

  async close(): Promise<void> {
    this.log.log("Closing signaling connection...")
    this.closed = true
    this.stopHeartbeat()
    if (this.ws) {
      try { this.ws.close() } catch { /* noop */ }
      this.ws = null
    }
    this.log.debug("WebSocket closed")
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
