import fs from "node:fs"
import { mkdir, open, readdir, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { Readable, Transform, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import zlib from "node:zlib"
import { zipSync } from "fflate"
import { assertSafeEntryName, normalizeEntryName } from "./paths.js"
import { ArchiveError, throwIfAborted } from "./errors.js"
import {
  openArchiveReader,
  readEntryChunks,
  readZipDirectory,
  type ArchiveEntryInfo,
  type ArchiveReader,
} from "./zip.js"

export type ArchiveFileSource = { kind: "file"; filePath: string; entryName: string; mtime?: Date }
export type ArchiveDataSource = { kind: "data"; data: Uint8Array; entryName: string; mtime?: Date }
export type ArchiveEntrySource = { kind: "entry"; archivePath: string; entry: ArchiveEntryInfo; entryName?: string; mtime?: Date }

export type ArchivePackSource = ArchiveFileSource | ArchiveDataSource | ArchiveEntrySource

export interface ArchivePackProgress {
  done: number
  total: number
  bytes: number
  name: string
}

export interface ArchivePackOptions {
  signal?: AbortSignal
  level?: number
  progressIntervalMs?: number
  onProgress?: (progress: ArchivePackProgress) => void
}

export interface CollectDirectoryOptions {
  signal?: AbortSignal
  /** Префикс внутри архива (например, имя папки сборки). */
  prefix?: string
  /** Фильтр по относительному пути внутри `rootDir` (POSIX-разделители). */
  include?: (relativePath: string) => boolean
}

const SIG_LOCAL = 0x04034b50
const SIG_DESCRIPTOR = 0x08074b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_LOCATOR = 0x07064b50
const FLAGS = 0x0808
const METHOD_DEFLATE = 8
/** Ниже этого размера сжатие гарантированно укладывается в 32 бита. */
const ZIP64_THRESHOLD = 0xf0000000
const SMALL_FILE_SIZE = 32 * 1024
const FILE_PREFETCH = 2

interface ZipOutput {
  write(chunk: Uint8Array): Promise<void>
}

class FileZipOutput implements ZipOutput {
  private readonly buffer = Buffer.allocUnsafe(256 * 1024)
  private used = 0

  constructor(private readonly handle: Awaited<ReturnType<typeof open>>) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (chunk.length > this.buffer.length - this.used) await this.flush()
    if (chunk.length <= this.buffer.length) {
      this.buffer.set(chunk, this.used)
      this.used += chunk.length
    } else await this.writeDirect(chunk)
  }

  async flush(): Promise<void> {
    if (!this.used) return
    await this.writeDirect(this.buffer.subarray(0, this.used))
    this.used = 0
  }

  private async writeDirect(chunk: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < chunk.length) {
      const { bytesWritten } = await this.handle.write(chunk, offset, chunk.length - offset)
      if (!bytesWritten) throw new ArchiveError("IO_ERROR", "Cannot write archive output")
      offset += bytesWritten
    }
  }
}

class MemoryZipOutput implements ZipOutput {
  readonly chunks: Buffer[] = []

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

class OutputSink extends Writable {
  bytes = 0

  constructor(private readonly output: ZipOutput) {
    super()
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.bytes += chunk.length
    this.output.write(chunk).then(() => callback(), callback)
  }
}

class AbortGate extends Transform {
  constructor(private readonly signal?: AbortSignal) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    if (this.signal?.aborted) {
      callback(new ArchiveError("ABORTED", "Archive operation cancelled"))
      return
    }
    callback(null, chunk)
  }
}

class CrcCounter extends Transform {
  crc = 0
  size = 0

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.crc = zlib.crc32(chunk, this.crc)
    this.size += chunk.length
    callback(null, chunk)
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function localHeader(name: Buffer, time: number, date: number, zip64: boolean): Buffer {
  const size = 30 + name.length + (zip64 ? 20 : 0)
  const header = Buffer.alloc(size)
  header.writeUInt32LE(SIG_LOCAL, 0)
  header.writeUInt16LE(zip64 ? 45 : 20, 4)
  header.writeUInt16LE(FLAGS, 6)
  header.writeUInt16LE(METHOD_DEFLATE, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(zip64 ? 0xffffffff : 0, 18)
  header.writeUInt32LE(zip64 ? 0xffffffff : 0, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(zip64 ? 20 : 0, 28)
  name.copy(header, 30)
  if (zip64) {
    const offset = 30 + name.length
    header.writeUInt16LE(0x0001, offset)
    header.writeUInt16LE(16, offset + 2)
    // Размеры неизвестны до сжатия — их кладёт data descriptor.
    header.writeBigUInt64LE(0n, offset + 4)
    header.writeBigUInt64LE(0n, offset + 12)
  }
  return header
}

interface CentralEntry {
  name: Buffer
  time: number
  date: number
  crc: number
  compressed: number
  uncompressed: number
  offset: number
  zip64: boolean
}

function centralHeader(entry: CentralEntry): Buffer {
  const sizes64 = entry.zip64 || entry.compressed >= 0xffffffff || entry.uncompressed >= 0xffffffff
  const offset64 = entry.offset >= 0xffffffff
  const needsExtra = sizes64 || offset64
  const extra = needsExtra ? 4 + (sizes64 ? 16 : 0) + (offset64 ? 8 : 0) : 0
  const header = Buffer.alloc(46 + entry.name.length + extra)
  header.writeUInt32LE(SIG_CENTRAL, 0)
  header.writeUInt16LE(needsExtra ? 45 : 20, 4)
  header.writeUInt16LE(needsExtra ? 45 : 20, 6)
  header.writeUInt16LE(FLAGS, 8)
  header.writeUInt16LE(METHOD_DEFLATE, 10)
  header.writeUInt16LE(entry.time, 12)
  header.writeUInt16LE(entry.date, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(sizes64 ? 0xffffffff : entry.compressed, 20)
  header.writeUInt32LE(sizes64 ? 0xffffffff : entry.uncompressed, 24)
  header.writeUInt16LE(entry.name.length, 28)
  header.writeUInt16LE(extra, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(entry.name.at(-1) === 47 ? 0x10 : 0, 38)
  header.writeUInt32LE(offset64 ? 0xffffffff : entry.offset, 42)
  entry.name.copy(header, 46)
  if (needsExtra) {
    const offset = 46 + entry.name.length
    header.writeUInt16LE(0x0001, offset)
    header.writeUInt16LE(extra - 4, offset + 2)
    if (sizes64) {
      header.writeBigUInt64LE(BigInt(entry.uncompressed), offset + 4)
      header.writeBigUInt64LE(BigInt(entry.compressed), offset + 12)
    }
    if (offset64) header.writeBigUInt64LE(BigInt(entry.offset), offset + 4 + (sizes64 ? 16 : 0))
  }
  return header
}

interface SourceInfo {
  entryName: string
  size: number
  mtime: Date
  small?: () => Promise<Uint8Array>
  open: (signal?: AbortSignal) => Readable
}

async function describeSource(
  source: ArchivePackSource,
  readers: Map<string, Promise<{ reader: ArchiveReader; entries: ArchiveEntryInfo[] }>>,
  signal?: AbortSignal,
): Promise<SourceInfo> {
  if ("data" in source) {
    const data = source.data
    return {
      entryName: source.entryName,
      size: data.length,
      mtime: source.mtime ?? new Date(),
      small: async () => data,
      open: () => Readable.from([data]),
    }
  }
  if ("filePath" in source) {
    const stat = await fs.promises.stat(source.filePath)
    return {
      entryName: source.entryName,
      size: stat.isDirectory() ? 0 : stat.size,
      small: stat.isDirectory() ? async () => Buffer.alloc(0) : stat.size <= SMALL_FILE_SIZE ? async () => {
        const handle = await open(source.filePath, "r")
        try {
          const data = Buffer.allocUnsafe(stat.size + 1)
          let length = 0
          while (length < data.length) {
            const { bytesRead } = await handle.read(data, length, data.length - length, length)
            if (!bytesRead) break
            length += bytesRead
          }
          if (length !== stat.size) throw new ArchiveError("IO_ERROR", `File changed while packing: ${source.filePath}`)
          return data.subarray(0, length)
        } finally { await handle.close() }
      } : undefined,
      mtime: source.mtime ?? stat.mtime,
      open: (streamSignal) => fs.createReadStream(source.filePath, streamSignal ? { signal: streamSignal } : {}),
    }
  }
  let pending = readers.get(source.archivePath)
  if (!pending) {
    pending = (async () => {
      const reader = await openArchiveReader(source.archivePath)
      try {
        const entries = await readZipDirectory(reader, { signal })
        return { reader, entries }
      } catch (error) {
        await reader.close().catch(() => {})
        throw error
      }
    })()
    readers.set(source.archivePath, pending)
  }
  const { reader, entries } = await pending
  const entry = entries.find((candidate) => candidate.name === source.entry.name && !candidate.directory)
  if (!entry) throw new ArchiveError("INVALID_ARCHIVE", `Archive entry ${source.entry.name} disappeared before packing`, source.entry.name)
  return {
    entryName: source.entryName ?? entry.name,
    size: entry.size,
    mtime: source.mtime ?? entry.mtime ?? new Date(),
    open: (streamSignal) => Readable.from(readEntryChunks(reader, entry, { signal: streamSignal })),
  }
}

async function writeEntry(output: ZipOutput, source: SourceInfo, offset: number, options: ArchivePackOptions): Promise<CentralEntry> {
  const name = Buffer.from(source.entryName, "utf8")
  if (!name.length || name.length > 0xffff) throw new ArchiveError("INVALID_ARCHIVE", "Archive entry has an empty name")
  const { time, date } = dosDateTime(source.mtime)
  const zip64 = source.size >= ZIP64_THRESHOLD
  const header = localHeader(name, time, date, zip64)
  if (source.small && source.size <= SMALL_FILE_SIZE) {
    const data = await source.small()
    const compressed = zlib.deflateRawSync(data, { level: options.level ?? 6 })
    const crc = zlib.crc32(data)
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(SIG_DESCRIPTOR, 0)
    descriptor.writeUInt32LE(crc, 4)
    descriptor.writeUInt32LE(compressed.length, 8)
    descriptor.writeUInt32LE(data.length, 12)
    await output.write(Buffer.concat([header, compressed, descriptor]))
    return { name, time, date, crc, compressed: compressed.length, uncompressed: data.length, offset, zip64 }
  }
  await output.write(header)

  const counter = new CrcCounter()
  const sink = new OutputSink(output)
  const input = source.open(options.signal)
  await pipeline(input, new AbortGate(options.signal), counter, zlib.createDeflateRaw({ level: options.level ?? 6 }), sink)
  if (counter.size !== source.size) throw new ArchiveError("IO_ERROR", `Source size changed while packing: ${source.entryName}`)

  const descriptor = Buffer.alloc(zip64 ? 24 : 16)
  descriptor.writeUInt32LE(SIG_DESCRIPTOR, 0)
  descriptor.writeUInt32LE(counter.crc >>> 0, 4)
  if (zip64) {
    descriptor.writeBigUInt64LE(BigInt(sink.bytes), 8)
    descriptor.writeBigUInt64LE(BigInt(counter.size), 16)
  } else {
    descriptor.writeUInt32LE(sink.bytes, 8)
    descriptor.writeUInt32LE(counter.size, 12)
  }
  await output.write(descriptor)

  return {
    name,
    time,
    date,
    crc: counter.crc >>> 0,
    compressed: sink.bytes,
    uncompressed: counter.size,
    offset,
    zip64,
  }
}

async function writeZip(sources: ArchivePackSource[], output: ZipOutput, options: ArchivePackOptions): Promise<void> {
  const readers = new Map<string, Promise<{ reader: ArchiveReader; entries: ArchiveEntryInfo[] }>>()
  const names = new Set<string>()
  const canonical = sources.map(source => {
    const name = packedName(source.entryName ?? (source.kind === "entry" ? source.entry.name : ""))
    const key = name.replace(/\/$/, "").toLowerCase()
    if (names.has(key)) throw new ArchiveError("INVALID_ARCHIVE", `Duplicate ZIP entry: ${name}`, name)
    names.add(key)
    return { ...source, entryName: name }
  })
  const total = sources.length
  const interval = options.progressIntervalMs ?? 100
  let lastProgress = 0
  let bytes = 0
  try {
    const entries: CentralEntry[] = []
    let offset = 0
    let prefetched: SourceInfo[] = []
    let batchStart = 0
    for (let index = 0; index < total; index++) {
      throwIfAborted(options.signal)
      if (index >= batchStart + prefetched.length) {
        batchStart = index
        let end = index + 1
        if (canonical[index].kind === "file") {
          while (end < total && end - index < FILE_PREFETCH && canonical[end].kind === "file") end++
          // Держим не более двух небольших файлов; большие по-прежнему идут потоком.
          const batch = await Promise.allSettled(canonical.slice(index, end).map(async source => {
            const info = await describeSource(source, readers, options.signal)
            throwIfAborted(options.signal)
            if (!info.small) return info
            const data = await info.small()
            return { ...info, small: async () => data }
          }))
          prefetched = batch.map(result => {
            if (result.status === "rejected") throw result.reason
            return result.value
          })
        } else {
          prefetched = [await describeSource(canonical[index], readers, options.signal)]
        }
        throwIfAborted(options.signal)
      }
      const info = prefetched[index - batchStart]
      const entry = await writeEntry(output, info, offset, options)
      offset += 30 + entry.name.length + (entry.zip64 ? 20 : 0) + entry.compressed + (entry.zip64 ? 24 : 16)
      entries.push(entry)
      bytes += entry.uncompressed
      const now = Date.now()
      if (options.onProgress && (index + 1 === total || now - lastProgress >= interval)) {
        lastProgress = now
        options.onProgress({ done: index + 1, total, bytes, name: info.entryName })
      }
    }

    const directory: Buffer[] = []
    let directorySize = 0
    for (const entry of entries) {
      const buffer = centralHeader(entry)
      directory.push(buffer)
      directorySize += buffer.length
    }
    const directoryOffset = offset
    if (directory.length) await output.write(Buffer.concat(directory))

    const needsZip64 = entries.length >= 0xffff || directoryOffset >= 0xffffffff || directorySize >= 0xffffffff || entries.some(entry => entry.zip64)
    if (needsZip64) {
      const eocd64 = Buffer.alloc(56)
      eocd64.writeUInt32LE(SIG_EOCD64, 0)
      eocd64.writeBigUInt64LE(44n, 4)
      eocd64.writeUInt16LE(45, 12)
      eocd64.writeUInt16LE(45, 14)
      eocd64.writeUInt32LE(0, 16)
      eocd64.writeUInt32LE(0, 20)
      eocd64.writeBigUInt64LE(BigInt(entries.length), 24)
      eocd64.writeBigUInt64LE(BigInt(entries.length), 32)
      eocd64.writeBigUInt64LE(BigInt(directorySize), 40)
      eocd64.writeBigUInt64LE(BigInt(directoryOffset), 48)
      await output.write(eocd64)

      const locator = Buffer.alloc(20)
      locator.writeUInt32LE(SIG_LOCATOR, 0)
      locator.writeUInt32LE(0, 4)
      locator.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 8)
      locator.writeUInt32LE(1, 16)
      await output.write(locator)
    }

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(SIG_EOCD, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(needsZip64 ? 0xffff : entries.length, 8)
    eocd.writeUInt16LE(needsZip64 ? 0xffff : entries.length, 10)
    eocd.writeUInt32LE(needsZip64 ? 0xffffffff : directorySize, 12)
    eocd.writeUInt32LE(needsZip64 ? 0xffffffff : directoryOffset, 16)
    eocd.writeUInt16LE(0, 20)
    await output.write(eocd)
  } finally {
    await Promise.allSettled([...readers.values()].map(async (pending) => (await pending).reader.close()))
  }
}

/** Пишет ZIP из файлов, буферов и записей других архивов. */
export async function packArchive(sources: ArchivePackSource[], outputPath: string, options: ArchivePackOptions = {}): Promise<void> {
  throwIfAborted(options.signal)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${randomUUID()}.partial`
  let owned = false
  try {
    const handle = await open(temporary, "wx")
    owned = true
    try {
      const output = new FileZipOutput(handle)
      await writeZip(sources, output, options)
      await output.flush()
    } finally {
      await handle.close()
    }
    throwIfAborted(options.signal)
    await rename(temporary, outputPath)
  } catch (error) {
    throwIfAborted(options.signal)
    throw error
  } finally {
    if (owned) await rm(temporary, { force: true })
  }
}

/** Пишет ZIP в память: для небольших архивов вроде тем оформления. */
export async function packArchiveBuffer(sources: ArchivePackSource[], options: ArchivePackOptions = {}): Promise<Buffer> {
  const output = new MemoryZipOutput()
  await writeZip(sources, output, options)
  return output.toBuffer()
}

/** Синхронная упаковка маленьких архивов (например, classpath-JAR). */
export function packArchiveSync(entries: Record<string, Uint8Array>, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Buffer {
  const names = new Set<string>()
  const normalized = Object.create(null) as Record<string, Uint8Array>
  for (const [raw, data] of Object.entries(entries)) {
    const name = packedName(raw)
    const key = name.replace(/\/$/, "").toLowerCase()
    if (names.has(key)) throw new ArchiveError("INVALID_ARCHIVE", `Duplicate ZIP entry: ${name}`, name)
    names.add(key)
    normalized[name] = data
  }
  if (names.size >= 0xffff) throw new ArchiveError("LIMIT_EXCEEDED", "Use asynchronous packing for ZIP64")
  return Buffer.from(zipSync(normalized, { level }))
}

function packedName(raw: string): string {
  const name = normalizeEntryName(raw)
  assertSafeEntryName(name)
  const components = name.split("/").filter(part => part && part !== ".")
  if (!components.length) throw new ArchiveError("UNSAFE_ENTRY", `Empty ZIP entry: ${raw}`, raw)
  return components.map(part => {
    if (/[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)) throw new ArchiveError("UNSAFE_ENTRY", `Unsafe ZIP entry: ${raw}`, raw)
    return part
  }).join("/") + (name.endsWith("/") ? "/" : "")
}

function joinEntryName(prefix: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/")
  if (!prefix) return normalized
  const base = prefix.replace(/\\/g, "/").replace(/\/+$/, "")
  return base ? `${base}/${normalized}` : normalized
}

/** Собирает список файлов каталога для упаковки, пропуская ссылки и junction'ы. */
export async function collectDirectorySources(rootDir: string, options: CollectDirectoryOptions = {}): Promise<ArchiveFileSource[]> {
  const sources: ArchiveFileSource[] = []
  const walk = async (directory: string, relative: string): Promise<void> => {
    throwIfAborted(options.signal)
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      throwIfAborted(options.signal)
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!options.include || options.include(nextRelative)) sources.push({ kind: "file", filePath: fullPath, entryName: joinEntryName(options.prefix ?? "", nextRelative) + "/" })
        await walk(fullPath, nextRelative)
        continue
      }
      if (!entry.isFile()) continue
      if (options.include && !options.include(nextRelative)) continue
      sources.push({ kind: "file", filePath: fullPath, entryName: joinEntryName(options.prefix ?? "", nextRelative) })
    }
  }
  await walk(rootDir, "")
  return sources
}

/** Упаковывает каталог целиком (с необязательным префиксом и фильтром). */
export async function packDirectory(rootDir: string, outputPath: string, options: ArchivePackOptions & CollectDirectoryOptions = {}): Promise<void> {
  const sources = await collectDirectorySources(rootDir, options)
  await packArchive(sources, outputPath, options)
}
