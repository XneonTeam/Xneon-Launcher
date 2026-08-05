// ============================================================
// Minecraft Server Status Checker (Native SLP Protocol)
// No external API dependency - uses raw TCP + Minecraft protocol
// ============================================================

import { Socket } from "net"
import { resolveSrv } from "dns/promises"

export interface ServerStatusResult {
  online: boolean
  ip: string
  port: number
  players_online: number
  players_max: number
  motd_raw?: string
  motd_clean?: string
  version: string
  latency_ms: number
  icon?: string
  error?: string
}

const DEFAULT_TIMEOUT = 5000
const DEFAULT_PORT = 25565

/**
 * Parse a host string that may contain a port.
 * Supports: "play.example.com", "play.example.com:25577", "[::1]:25565", "192.168.1.1:25565"
 */
export function parseHost(input: string): { host: string; port: number } {
  const trimmed = input.trim()
  if (!trimmed) return { host: input, port: DEFAULT_PORT }

  // IPv6 with port: [::1]:25565
  if (trimmed.startsWith("[")) {
    const closeBracket = trimmed.indexOf("]")
    if (closeBracket !== -1) {
      const host = trimmed.slice(1, closeBracket)
      const after = trimmed.slice(closeBracket + 1)
      const port = after.startsWith(":")
        ? Number.parseInt(after.slice(1), 10)
        : DEFAULT_PORT
      return { host, port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT }
    }
  }

  // host:port (last colon)
  const lastColon = trimmed.lastIndexOf(":")
  if (lastColon !== -1) {
    const portStr = trimmed.slice(lastColon + 1)
    const port = Number.parseInt(portStr, 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) {
      return { host: trimmed.slice(0, lastColon), port }
    }
  }

  return { host: trimmed, port: DEFAULT_PORT }
}

// ── VarInt encoding (Minecraft protocol) ──────────────────

function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  while (true) {
    if ((value & ~0x7f) === 0) {
      bytes.push(value)
      return Buffer.from(bytes)
    }
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
}

function readVarInt(buffer: Buffer, offset: number = 0): { value: number; length: number } {
  let value = 0
  let length = 0
  while (true) {
    if (offset + length >= buffer.length) break
    const byte = buffer[offset + length]
    value |= (byte & 0x7f) << (length * 7)
    length++
    if ((byte & 0x80) === 0) break
    if (length >= 5) break
  }
  return { value, length }
}

function writeString(str: string): Buffer {
  const encoded = Buffer.from(str, "utf-8")
  return Buffer.concat([writeVarInt(encoded.length), encoded])
}

// ── MOTD parsing ──────────────────────────────────────────

function stripColorCodes(text: string): string {
  return text.replace(/\u00A7[0-9a-fklmnor]/gi, "")
}

function parseMotdClean(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    function extractText(obj: unknown): string {
      if (typeof obj === "string") return obj
      if (obj && typeof obj === "object") {
        const o = obj as Record<string, unknown>
        let result = typeof o.text === "string" ? o.text : ""
        if (Array.isArray(o.extra)) {
          result += (o.extra as unknown[]).map(extractText).join("")
        }
        return result
      }
      return ""
    }
    return stripColorCodes(extractText(parsed))
  } catch {
    return stripColorCodes(raw)
  }
}

// ── SRV lookup ────────────────────────────────────────────

async function resolveSrvRecord(host: string): Promise<{ host: string; port: number } | null> {
  try {
    const records = await resolveSrv(`_minecraft._tcp.${host}`)
    if (records && records.length > 0) {
      return { host: records[0].name, port: records[0].port }
    }
  } catch {
    // No SRV record — not an error
  }
  return null
}

// ── Main ping function ────────────────────────────────────

function createOfflineResult(host: string, port: number, error?: string): ServerStatusResult {
  return {
    online: false,
    ip: host,
    port,
    players_online: 0,
    players_max: 0,
    version: "",
    latency_ms: 0,
    error,
  }
}

/**
 * Ping a Minecraft server using the Server List Ping (SLP) protocol.
 * Connects via raw TCP and performs the handshake + status request.
 *
 * @param input Server address, optionally with port (e.g. "play.example.com:25577")
 */
export async function pingServer(input: string): Promise<ServerStatusResult> {
  const { host, port: inputPort } = parseHost(input)
  const startTime = Date.now()

  // SRV lookup: _minecraft._tcp.<host>
  let targetHost = host
  let targetPort = inputPort
  const srv = await resolveSrvRecord(host)
  if (srv) {
    targetHost = srv.host
    targetPort = srv.port
  }

  return new Promise<ServerStatusResult>((resolve) => {
    let resolved = false
    let buffer = Buffer.alloc(0)
    let timeoutHandle: NodeJS.Timeout | null = null
    const socket = new Socket()

    const finish = (result: ServerStatusResult) => {
      if (resolved) return
      resolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      socket.destroy()
      resolve(result)
    }

    timeoutHandle = setTimeout(() => {
      finish(createOfflineResult(host, inputPort, "Connection timed out"))
    }, DEFAULT_TIMEOUT)

    socket.setNoDelay(true)

    socket.on("connect", () => {
      // ── Handshake packet (ID 0x00) ─────────────────────
      const handshakePayload = Buffer.concat([
        writeVarInt(0),     // Packet ID: handshake
        writeVarInt(-1),    // Protocol version: -1 (accepted by most servers)
        writeString(host),  // Server address (original, NOT SRV-resolved)
        Buffer.from([       // Port as unsigned short (big-endian)
          (inputPort >> 8) & 0xff,
          inputPort & 0xff,
        ]),
        writeVarInt(1),     // Next state: 1 = status
      ])
      const handshakePacket = Buffer.concat([
        writeVarInt(handshakePayload.length),
        handshakePayload,
      ])

      // ── Status request packet (ID 0x00, no payload) ────
      const statusPayload = writeVarInt(0)
      const statusPacket = Buffer.concat([
        writeVarInt(statusPayload.length),
        statusPayload,
      ])

      socket.write(handshakePacket)
      socket.write(statusPacket)
    })

    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data])
      if (buffer.length < 1) return

      try {
        // Read total packet length (VarInt)
        const { value: packetLen, length: lenSize } = readVarInt(buffer, 0)
        const totalSize = lenSize + packetLen
        if (buffer.length < totalSize) return

        // Read packet ID (should be 0x00 for status response)
        const body = buffer.slice(lenSize, totalSize)
        const { value: packetId, length: idSize } = readVarInt(body, 0)
        if (packetId !== 0) {
          finish(createOfflineResult(host, inputPort, `Unexpected packet ID: ${packetId}`))
          return
        }

        // Read JSON string (VarInt length prefix)
        const jsonOffset = idSize
        const { value: jsonLen, length: jsonLenSize } = readVarInt(body, jsonOffset)
        const jsonStart = jsonOffset + jsonLenSize
        const jsonEnd = jsonStart + jsonLen
        const jsonStr = body.slice(jsonStart, jsonEnd).toString("utf-8")
        const parsed = JSON.parse(jsonStr)

        const latency = Date.now() - startTime
        const players = (parsed.players || {}) as Record<string, unknown>
        const version = (parsed.version || {}) as Record<string, unknown>
        const description = parsed.description

        let motdRaw: string
        if (description && typeof description === "object") {
          motdRaw = JSON.stringify(description)
        } else {
          motdRaw = String(description || "")
        }

        finish({
          online: true,
          ip: host,
          port: inputPort,
          players_online: typeof players.online === "number" ? players.online : 0,
          players_max: typeof players.max === "number" ? players.max : 0,
          motd_raw: motdRaw,
          motd_clean: parseMotdClean(motdRaw),
          version: typeof version.name === "string" ? stripColorCodes(version.name) : "",
          latency_ms: Math.max(0, latency),
          icon: typeof parsed.favicon === "string" ? parsed.favicon : undefined,
        })
      } catch {
        if (buffer.length > 16384) {
          finish(createOfflineResult(host, inputPort, "Failed to parse server response"))
        }
      }
    })

    socket.on("error", (err: Error) => {
      finish(createOfflineResult(host, inputPort, err.message))
    })

    socket.on("close", () => {
      if (!resolved) {
        finish(createOfflineResult(host, inputPort, "Connection closed"))
      }
    })

    socket.setTimeout(DEFAULT_TIMEOUT, () => {
      finish(createOfflineResult(host, inputPort, "Connection timed out"))
    })

    socket.connect(targetPort, targetHost)
  })
}