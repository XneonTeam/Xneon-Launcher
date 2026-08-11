// ============================================================
// Minecraft Server Status Checker (Native SLP Protocol)
// Based on mc-pinger — correct Handshake → Status → Ping → Pong
// ============================================================

import net from "net"
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

// ── Parse host:port ──────────────────────────────────────

export function parseHost(input: string): { host: string; port: number } {
  const trimmed = input.trim()
  if (!trimmed) return { host: input, port: DEFAULT_PORT }

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

// ── VarInt encoding ──────────────────────────────────────

class VarIntBuffer {
  private buffer: number[] = []

  writeVarInt(value: number): void {
    const bytes: number[] = []
    let v = new Uint32Array([value])[0]
    do {
      let byte = v & 0x7f
      v >>>= 7
      if (v !== 0) {
        byte |= 0x80
      }
      bytes.push(byte)
    } while (v !== 0)
    this.buffer.push(...bytes)
  }

  writeString(value: string): void {
    const encoded = Buffer.from(value, "utf-8")
    this.writeVarInt(encoded.length)
    this.buffer.push(...encoded)
  }

  writeShort(value: number): void {
    this.buffer.push((value >> 8) & 0xff)
    this.buffer.push(value & 0xff)
  }

  writeLong(value: bigint): void {
    const buf = Buffer.alloc(8)
    buf.writeBigInt64BE(value)
    this.buffer.push(...buf)
  }

  toPacket(): Buffer {
    const lengthBuffer: number[] = []
    let temp = this.buffer.length
    do {
      let byte = temp & 0x7f
      temp >>>= 7
      if (temp !== 0) {
        byte |= 0x80
      }
      lengthBuffer.push(byte)
    } while (temp !== 0)

    return Buffer.from([...lengthBuffer, ...this.buffer])
  }
}

// ── VarInt decoding ──────────────────────────────────────

function readVarInt(buffer: Buffer, offset: number): { value: number; newOffset: number } {
  let value = 0
  let shift = 0
  let currentOffset = offset

  while (currentOffset < buffer.length) {
    const byte = buffer[currentOffset]
    value |= (byte & 0x7f) << shift
    currentOffset++
    if ((byte & 0x80) === 0) {
      break
    }
    shift += 7
    if (shift > 35) {
      throw new Error("VarInt is too big")
    }
  }

  return { value, newOffset: currentOffset }
}

function readString(buffer: Buffer, offset: number): { value: string; newOffset: number } {
  const { value: length, newOffset } = readVarInt(buffer, offset)
  const value = buffer.toString("utf-8", newOffset, newOffset + length)
  return { value, newOffset: newOffset + length }
}

// ── MOTD parsing ──────────────────────────────────────────

function stripColorCodes(text: string): string {
  return text.replace(/\u00A7[0-9a-fklmnor]/gi, "")
}

function parseMinecraftText(obj: unknown): string {
  if (!obj) return ""
  if (typeof obj === "string") return stripColorCodes(obj)

  let result = ""
  const o = obj as Record<string, unknown>

  if (typeof o.text === "string") {
    result += o.text
  }

  if (Array.isArray(o.extra)) {
    for (const part of o.extra) {
      result += parseMinecraftText(part)
    }
  }

  return stripColorCodes(result)
}

function parseMotd(description: unknown): string {
  if (!description) return ""
  if (typeof description === "string") return stripColorCodes(description)
  return parseMinecraftText(description) || ""
}

function parseMotdRaw(description: unknown): string {
  if (!description) return ""
  return JSON.stringify(description)
}

// ── Protocol version → name ──────────────────────────────

function getProtocolVersionName(protocol: number): string {
  const versions: Record<number, string> = {
    47: "1.8.x",
    107: "1.9", 110: "1.9.1", 210: "1.9.2",
    315: "1.10", 316: "1.10.1",
    335: "1.11", 336: "1.11.1", 338: "1.11.2",
    340: "1.12", 341: "1.12.1", 342: "1.12.2",
    393: "1.13", 401: "1.13.1", 404: "1.13.2",
    477: "1.14", 480: "1.14.1", 485: "1.14.2", 490: "1.14.3", 498: "1.14.4",
    573: "1.15", 575: "1.15.1", 578: "1.15.2",
    736: "1.16", 737: "1.16.1", 753: "1.16.2", 754: "1.16.3", 756: "1.16.4", 757: "1.16.5",
    758: "1.17", 759: "1.17.1",
    760: "1.18", 761: "1.18.1", 762: "1.18.2",
    763: "1.19", 764: "1.19.2", 765: "1.19.3", 766: "1.19.4",
    767: "1.20", 768: "1.20.1", 769: "1.20.2", 770: "1.20.3", 771: "1.20.4", 772: "1.20.5", 773: "1.20.6",
    774: "1.21", 775: "1.21.1", 776: "1.21.2", 777: "1.21.3", 778: "1.21.4", 779: "1.21.5",
  }
  return versions[protocol] || `Неизвестная (${protocol})`
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
 * Ping a Minecraft server using the correct SLP protocol:
 *   1. Handshake (0x00) → next state = 1
 *   2. Status Request (0x00)
 *   3. Status Response (0x00) — parse JSON
 *   4. Ping (0x01) with timestamp
 *   5. Pong (0x01) — calculate real latency
 */
export async function pingServer(input: string): Promise<ServerStatusResult> {
  const { host, port: inputPort } = parseHost(input)

  // SRV lookup
  let targetHost = host
  let targetPort = inputPort
  const srv = await resolveSrvRecord(host)
  if (srv) {
    targetHost = srv.host
    targetPort = srv.port
  }

  return new Promise<ServerStatusResult>((resolve) => {
    const socket = new net.Socket()
    let resolved = false

    const finish = (result: ServerStatusResult) => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(DEFAULT_TIMEOUT)

    socket.on("timeout", () => {
      finish(createOfflineResult(host, inputPort, "Connection timed out"))
    })

    socket.on("error", (err: Error) => {
      finish(createOfflineResult(host, inputPort, err.message))
    })

    socket.on("connect", () => {
      // Packet 0x00: Handshake
      const handshake = new VarIntBuffer()
      handshake.writeVarInt(0x00)
      handshake.writeVarInt(-1) // -1 = any protocol (like Notchian client)
      handshake.writeString(host)
      handshake.writeShort(inputPort)
      handshake.writeVarInt(1) // Next state: Status

      socket.write(handshake.toPacket())

      // Packet 0x00: Status Request
      const statusRequest = new VarIntBuffer()
      statusRequest.writeVarInt(0x00)

      socket.write(statusRequest.toPacket())
    })

    let dataBuffer = Buffer.alloc(0)
    let savedStatus: {
      version?: { name?: string; protocol?: number }
      players?: { max?: number; online?: number }
      description?: unknown
      favicon?: string
    } | null = null
    let pingSent = false
    let pingTimestamp = BigInt(0)

    socket.on("data", (chunk: Buffer) => {
      dataBuffer = Buffer.concat([dataBuffer, chunk])

      try {
        while (dataBuffer.length > 0) {
          let offset = 0

          const packetLengthResult = readVarInt(dataBuffer, offset)
          const packetLength = packetLengthResult.value
          offset = packetLengthResult.newOffset

          if (dataBuffer.length < offset + packetLength) {
            break
          }

          const packetData = dataBuffer.subarray(offset, offset + packetLength)
          dataBuffer = dataBuffer.subarray(offset + packetLength)

          let packetOffset = 0
          const packetIdResult = readVarInt(packetData, packetOffset)
          const packetId = packetIdResult.value
          packetOffset = packetIdResult.newOffset

          if (packetId === 0x00 && !savedStatus) {
            // Status Response — save, then send Ping
            const jsonString = readString(packetData, packetOffset)
            savedStatus = JSON.parse(jsonString.value)

            // Send Ping (0x01) with current timestamp
            pingTimestamp = BigInt(Date.now())
            const pingPacket = new VarIntBuffer()
            pingPacket.writeVarInt(0x01)
            pingPacket.writeLong(pingTimestamp)
            socket.write(pingPacket.toPacket())
            pingSent = true
          } else if (packetId === 0x01 && pingSent) {
            // Pong — calculate real latency
            const receivedTimestamp = packetData.readBigInt64BE(packetOffset)
            const latency = Number(BigInt(Date.now()) - receivedTimestamp)

            const status = savedStatus!
            const protocolVersion = status.version?.protocol
            const versionName = protocolVersion
              ? getProtocolVersionName(protocolVersion)
              : status.version?.name || "Неизвестная"

            finish({
              online: true,
              ip: host,
              port: inputPort,
              players_online: status.players?.online ?? 0,
              players_max: status.players?.max ?? 0,
              motd_raw: parseMotdRaw(status.description),
              motd_clean: parseMotd(status.description),
              version: versionName,
              latency_ms: Math.max(0, latency),
              icon: typeof status.favicon === "string" ? status.favicon : undefined,
            })
            return
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Parse error"
        finish(createOfflineResult(host, inputPort, message))
      }
    })

    socket.on("close", () => {
      if (!resolved) {
        finish(createOfflineResult(host, inputPort, "Connection closed"))
      }
    })

    socket.connect(targetPort, targetHost)
  })
}
