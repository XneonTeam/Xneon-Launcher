import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Readable, Transform, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createDeflateRaw } from "node:zlib"

export type ZipStage = "scan" | "compress" | "finalize" | "done"
export type ZipEntryInput = { name: string; filePath?: string; data?: Buffer }
const table = new Uint32Array(256)
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
const MAX32 = 0xffffffff
const u64 = (buffer: Buffer, at: number, value: number) => buffer.writeBigUInt64LE(BigInt(value), at)

/** ZIP/ZIP64 с data descriptors: в памяти только текущие stream-чанки и центральный каталог. */
export async function createStreamingZip(
  archivePath: string, entries: ZipEntryInput[],
  options: { signal?: AbortSignal; onProgress?: (event: { stage: ZipStage; percent: number }) => void } = {},
): Promise<void> {
  options.signal?.throwIfAborted()
  if (!entries.length || entries.length > 1_000_000) throw new Error("Empty or oversized ZIP task")
  const names = new Set<string>()
  for (const entry of entries) {
    if (!entry.name || entry.name.includes("\\") || entry.name.startsWith("/") || entry.name.split("/").some(part => part === ".." || part === "")
      || /^[A-Za-z]:/.test(entry.name) || entry.name.includes("\0") || Buffer.byteLength(entry.name) > 65535 || names.has(entry.name)) throw new Error("Invalid ZIP entry name")
    names.add(entry.name)
  }
  await fs.mkdir(path.dirname(archivePath), { recursive: true })
  if (await fs.lstat(archivePath).then(() => true, error => { if (error.code === "ENOENT") return false; throw error })) throw new Error("ZIP destination already exists")
  const partial = archivePath + "." + randomUUID() + ".partial"
  const handle = await fs.open(partial, "wx", 0o600)
  let offset = 0, published = false, usesZip64 = false
  const central: Buffer[] = []
  const write = async (buffer: Buffer) => {
    options.signal?.throwIfAborted()
    let at = 0
    while (at < buffer.length) { const { bytesWritten } = await handle.write(buffer, at, buffer.length - at); if (!bytesWritten) throw new Error("Short ZIP write"); at += bytesWritten; offset += bytesWritten }
  }
  try {
    for (const [index, entry] of entries.entries()) {
      options.signal?.throwIfAborted()
      const stat = entry.filePath ? await fs.lstat(entry.filePath) : undefined
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("ZIP source is not a regular file")
      const size = stat?.size ?? entry.data?.length ?? 0
      // Запас для deflate overhead около границы ZIP32.
      const zip64 = size >= 0xff000000 || offset >= MAX32
      usesZip64 ||= zip64
      const name = Buffer.from(entry.name, "utf8"), localOffset = offset
      const now = stat?.mtime ?? new Date(), year = Math.min(2107, Math.max(1980, now.getFullYear()))
      const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
      const local = Buffer.alloc(30 + name.length + (zip64 ? 20 : 0))
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(zip64 ? 45 : 20, 4)
      local.writeUInt16LE(0x808, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12)
      local.writeUInt32LE(zip64 ? MAX32 : 0, 18); local.writeUInt32LE(zip64 ? MAX32 : 0, 22)
      local.writeUInt16LE(name.length, 26); local.writeUInt16LE(zip64 ? 20 : 0, 28); name.copy(local, 30)
      if (zip64) { const at = 30 + name.length; local.writeUInt16LE(1, at); local.writeUInt16LE(16, at + 2); u64(local, at + 4, size) }
      await write(local)
      let crc = MAX32, read = 0
      const dataStart = offset
      const source = entry.filePath ? createReadStream(entry.filePath) : Readable.from([entry.data ?? Buffer.alloc(0)])
      const checksum = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        for (const byte of chunk) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
        read += chunk.length
        options.onProgress?.({ stage: "compress", percent: Math.min(99, Math.floor((index + (size ? read / size : 1)) / entries.length * 100)) })
        callback(null, chunk)
      } })
      await pipeline(source, checksum, createDeflateRaw(), new Writable({ write(chunk, _encoding, callback) { write(chunk).then(() => callback(), callback) } }), { signal: options.signal })
      const compressed = offset - dataStart
      if (read !== size) throw new Error("ZIP source changed size")
      if (entry.filePath && stat) {
        const after = await fs.lstat(entry.filePath)
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.ino !== stat.ino) throw new Error("ZIP source changed during compression")
      }
      const digest = (crc ^ MAX32) >>> 0
      const descriptor = Buffer.alloc(zip64 ? 24 : 16)
      descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(digest, 4)
      if (zip64) { u64(descriptor, 8, compressed); u64(descriptor, 16, read) }
      else { if (compressed >= MAX32) throw new Error("ZIP32 overflow"); descriptor.writeUInt32LE(compressed, 8); descriptor.writeUInt32LE(read, 12) }
      await write(descriptor)
      const record = Buffer.alloc(46 + name.length + (zip64 ? 28 : 0))
      record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x32d, 4); record.writeUInt16LE(zip64 ? 45 : 20, 6)
      record.writeUInt16LE(0x808, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(dosTime, 12); record.writeUInt16LE(dosDate, 14)
      record.writeUInt32LE(digest, 16); record.writeUInt32LE(zip64 ? MAX32 : compressed, 20); record.writeUInt32LE(zip64 ? MAX32 : read, 24)
      record.writeUInt16LE(name.length, 28); record.writeUInt16LE(zip64 ? 28 : 0, 30)
      record.writeUInt32LE(((stat?.mode ?? 0o100644) << 16) >>> 0, 38); record.writeUInt32LE(zip64 ? MAX32 : localOffset, 42)
      name.copy(record, 46)
      if (zip64) { const at = 46 + name.length; record.writeUInt16LE(1, at); record.writeUInt16LE(24, at + 2); u64(record, at + 4, read); u64(record, at + 12, compressed); u64(record, at + 20, localOffset) }
      central.push(record)
    }
    options.onProgress?.({ stage: "finalize", percent: 100 })
    const centralOffset = offset
    for (const record of central) await write(record)
    const centralSize = offset - centralOffset
    if (usesZip64 || entries.length >= 65535 || centralOffset >= MAX32 || centralSize >= MAX32) {
      const endOffset = offset, end = Buffer.alloc(56), locator = Buffer.alloc(20)
      end.writeUInt32LE(0x06064b50); u64(end, 4, 44); end.writeUInt16LE(45, 12); end.writeUInt16LE(45, 14)
      u64(end, 24, entries.length); u64(end, 32, entries.length); u64(end, 40, centralSize); u64(end, 48, centralOffset)
      locator.writeUInt32LE(0x07064b50); u64(locator, 8, endOffset); locator.writeUInt32LE(1, 16)
      await write(end); await write(locator)
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Math.min(entries.length, 65535), 8); end.writeUInt16LE(Math.min(entries.length, 65535), 10)
    end.writeUInt32LE(Math.min(centralSize, MAX32), 12); end.writeUInt32LE(Math.min(centralOffset, MAX32), 16)
    await write(end); await handle.sync()
    const actual = await handle.stat()
    if (!actual.isFile() || actual.size !== offset) throw new Error("Incomplete ZIP file")
    await handle.close()
    options.signal?.throwIfAborted()
    await fs.rename(partial, archivePath)
    published = true
    options.onProgress?.({ stage: "done", percent: 100 })
  } finally {
    await handle.close().catch(() => {})
    if (!published) await fs.unlink(partial).catch(() => {})
  }
}
