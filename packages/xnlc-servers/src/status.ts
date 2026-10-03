// ============================================================
// Minecraft Server Status Checker (Native SLP Protocol)
// Based on mc-pinger — correct Handshake → Status → Ping → Pong
// ============================================================

import net from "net"
import { resolveSrv } from "dns/promises"
import type { ServerStatusResult } from "@xnlc/types"

// Тип объявлен в `@xnlc/types` (он пересекает IPC-границу: `servers:ping` →
// preload → renderer). Реэкспорт сохраняет прежний импорт из `@xnlc/servers`.
export type { ServerStatusResult }

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

// ── Protocol version → name ─────────────────────────────

/**
 * Соответствие protocol version → версия Minecraft.
 * Если один протокол делят несколько версий, указана младшая из них
 * (так же поступает и клиент Minecraft).
 * Источник: https://minecraft.wiki/w/Protocol_version
 */
const PROTOCOL_VERSION_NAMES: Record<number, string> = {
  47: "1.8",
  107: "1.9", 108: "1.9.1", 109: "1.9.2", 110: "1.9.3",
  210: "1.10",
  315: "1.11", 316: "1.11.1",
  335: "1.12", 338: "1.12.1", 340: "1.12.2",
  393: "1.13", 401: "1.13.1", 404: "1.13.2",
  477: "1.14", 480: "1.14.1", 485: "1.14.2", 490: "1.14.3", 498: "1.14.4",
  573: "1.15", 575: "1.15.1", 578: "1.15.2",
  735: "1.16", 736: "1.16.1", 751: "1.16.2", 753: "1.16.3", 754: "1.16.4",
  755: "1.17", 756: "1.17.1",
  757: "1.18", 758: "1.18.2",
  759: "1.19", 760: "1.19.1", 761: "1.19.3", 762: "1.19.4",
  763: "1.20", 764: "1.20.2", 765: "1.20.3", 766: "1.20.5",
  767: "1.21", 768: "1.21.2", 769: "1.21.4", 770: "1.21.5", 771: "1.21.6",
  772: "1.21.7", 773: "1.21.9", 774: "1.21.11",
  775: "26.1", 776: "26.2",
}

function getProtocolVersionName(protocol: number): string {
  return PROTOCOL_VERSION_NAMES[protocol] || `Неизвестная (${protocol})`
}

/** Убирает §-коды форматирования из строки версии. */
function stripFormatting(value: string): string {
  return value.replace(/§./g, "").trim()
}

/**
 * Определяет версию сервера.
 *
 * Главный источник — `version.name` из ответа сервера: именно его показывает
 * клиент Minecraft, и только там видно ПО сервера («Paper 26.2»). Поэтому
 * собственный маппинг по protocol number используется лишь как запасной
 * вариант — например, когда прокси отдаёт «Velocity» без номера версии.
 */
function resolveVersionName(version?: { name?: string; protocol?: number }): string {
  const reported = typeof version?.name === "string" ? stripFormatting(version.name) : ""
  const protocol = version?.protocol
  const byProtocol = protocol ? PROTOCOL_VERSION_NAMES[protocol] : undefined

  // «Paper 26.2», «1.8-1.21» — версия уже есть в имени
  if (reported && /\d/.test(reported)) return reported
  // Имя без номера версии («Velocity») — берём версию из протокола
  if (byProtocol) return byProtocol
  if (reported) return reported
  if (protocol) return getProtocolVersionName(protocol)
  return "Неизвестная"
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
            const versionName = resolveVersionName(status.version)

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
