// ============================================================
// Servers DAT Generator (NBT format)
// Author: MAINER4IK
// ============================================================

import { ipcMain } from "electron"
import fs from "fs"
import path from "path"
import zlib from "zlib"

let xnlcModulePromise: Promise<any> | null = null

function loadXnlcModule(): Promise<any> {
  if (!xnlcModulePromise) {
    xnlcModulePromise = import("@xnlc/core")
  }
  return xnlcModulePromise
}

async function getMinecraftRoot(): Promise<string> {
  const { getDefaultMinecraftRootFromEnv } = await loadXnlcModule()
  return getDefaultMinecraftRootFromEnv()
}

// NBT Tag type constants
const TAG_END = 0
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10

class NbtWriter {
  private parts: Buffer[] = []

  private writeByte(value: number) {
    this.parts.push(Buffer.from([value & 0xff]))
  }

  private writeShort(value: number) {
    const buf = Buffer.alloc(2)
    buf.writeInt16BE(value)
    this.parts.push(buf)
  }

  private writeInt(value: number) {
    const buf = Buffer.alloc(4)
    buf.writeInt32BE(value)
    this.parts.push(buf)
  }

  private writeString(value: string) {
    const bytes = Buffer.from(value, "utf-8")
    this.writeShort(bytes.length)
    this.parts.push(bytes)
  }

  private writeNamedTag(type: number, name: string, writePayload: () => void) {
    this.writeByte(type)
    this.writeString(name)
    writePayload()
  }

  writeCompound(name: string, entries: () => void) {
    this.writeNamedTag(TAG_COMPOUND, name, () => {
      entries()
      this.writeByte(TAG_END)
    })
  }

  writeStringTag(name: string, value: string) {
    this.writeNamedTag(TAG_STRING, name, () => {
      this.writeString(value)
    })
  }

  writeList(name: string, elementType: number, items: (() => void)[]) {
    this.writeNamedTag(TAG_LIST, name, () => {
      this.writeByte(elementType)
      this.writeInt(items.length)
      for (const item of items) item()
    })
  }

  writeCompoundPayload(entries: () => void) {
    entries()
    this.writeByte(TAG_END)
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.parts)
  }
}

function generateServersDat(servers: Array<{ name: string; ip: string }>): Buffer {
  const writer = new NbtWriter()

  writer.writeCompound("", () => {
    writer.writeList(
      "servers",
      TAG_COMPOUND,
      servers.map(
        (server) => () => {
          writer.writeCompoundPayload(() => {
            writer.writeStringTag("name", server.name)
            writer.writeStringTag("ip", server.ip)
          })
        }
      )
    )
  })

  const nbtBuffer = writer.toBuffer()
  return zlib.gzipSync(nbtBuffer)
}

export function registerServersHandlers() {
  ipcMain.handle(
    "servers:write-dat",
    async (_event, servers: Array<{ name: string; ip: string }>) => {
      try {
        const root = await getMinecraftRoot()
        if (!fs.existsSync(root)) {
          fs.mkdirSync(root, { recursive: true })
        }
        const datPath = path.join(root, "servers.dat")
        const compressed = generateServersDat(servers)
        fs.writeFileSync(datPath, compressed)
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
