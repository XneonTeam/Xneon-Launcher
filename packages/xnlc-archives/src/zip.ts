import { open } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import { Inflate } from "fflate"
import { ArchiveError, throwIfAborted } from "./errors.js"
import { normalizeEntryName } from "./paths.js"

export type ArchiveInput = string | Uint8Array

export interface ArchiveEntryInfo {
  /** Нормализованное имя (POSIX-разделители, без хвостового `/`). */
  name: string
  directory: boolean
  symlink: boolean
  method: number
  flags: number
  crc: number
  /** Размер сжатых данных. */
  compressedSize: number
  /** Размер распакованных данных. */
  size: number
  /** Смещение локального заголовка в архиве. */
  localOffset: number
}

export interface ArchiveDirectoryOptions {
  signal?: AbortSignal
  /** Предохранитель от архивов с огромным каталогом. */
  maxEntries?: number
  /** Максимальный размер центрального каталога. */
  maxDirectorySize?: number
}

export interface ArchiveReader {
  readonly size: number
  readAt(offset: number, length: number): Promise<Uint8Array>
  close(): Promise<void>
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const MAX_DIRECTORY_SIZE = 512 * 1024 * 1024
const MAX_ENTRIES = 500_000
const READ_CHUNK = 64 * 1024

// CP437 — кодировка по умолчанию для имён без флага UTF-8 (ZIP APPNOTE 4.4.4).
const CP437_HIGH =
  "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5" +
  "\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192" +
  "\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb" +
  "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510" +
  "\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567" +
  "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580" +
  "\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229" +
  "\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0"

function decodeCp437(bytes: Uint8Array): string {
  let result = ""
  for (const byte of bytes) {
    result += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80]
  }
  return result
}

function decodeName(bytes: Uint8Array, utf8Flagged: boolean): string {
  if (utf8Flagged) return new TextDecoder("utf-8").decode(bytes)
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    // Некоторые архиваторы пишут UTF-8 без флага. Оставляем его только если
    // байты действительно являются корректным UTF-8 и не выглядят как CP437.
    if (new TextEncoder().encode(text).every((byte, index) => byte === bytes[index])) return text
  } catch {
    // Не UTF-8 — ниже декодируем как CP437.
  }
  return decodeCp437(bytes)
}

class BufferArchiveReader implements ArchiveReader {
  constructor(private readonly bytes: Uint8Array) {}

  get size(): number {
    return this.bytes.length
  }

  async readAt(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.bytes.length) {
      throw new ArchiveError("INVALID_ARCHIVE", "Archive read is out of bounds")
    }
    return this.bytes.subarray(offset, offset + length)
  }

  async close(): Promise<void> {
    // Буфером владеет вызывающий код.
  }
}

class FileArchiveReader implements ArchiveReader {
  constructor(
    private readonly handle: FileHandle,
    readonly size: number,
  ) {}

  async readAt(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new ArchiveError("INVALID_ARCHIVE", "Archive read is out of bounds")
    }
    const buffer = Buffer.allocUnsafe(length)
    let total = 0
    while (total < length) {
      const { bytesRead } = await this.handle.read(buffer, total, length - total, offset + total)
      if (bytesRead === 0) throw new ArchiveError("INVALID_ARCHIVE", "Unexpected end of archive")
      total += bytesRead
    }
    return buffer
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

export async function openArchiveReader(input: ArchiveInput): Promise<ArchiveReader> {
  if (typeof input !== "string") return new BufferArchiveReader(input)
  try {
    const handle = await open(input, "r")
    const stat = await handle.stat()
    return new FileArchiveReader(handle, stat.size)
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ArchiveError("IO_ERROR", `Cannot open archive ${input}: ${message}`)
  }
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u16(bytes: Uint8Array, offset: number): number {
  return viewOf(bytes).getUint16(offset, true)
}

function u32(bytes: Uint8Array, offset: number): number {
  return viewOf(bytes).getUint32(offset, true)
}

function u64(bytes: Uint8Array, offset: number): number {
  const value = viewOf(bytes).getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ArchiveError("LIMIT_EXCEEDED", "Archive uses sizes beyond the supported range")
  }
  return Number(value)
}

interface EndOfCentralDirectory {
  entries: number
  directorySize: number
  directoryOffset: number
}

async function readEndOfCentralDirectory(reader: ArchiveReader): Promise<EndOfCentralDirectory> {
  if (reader.size < 22) throw new ArchiveError("INVALID_ARCHIVE", "Archive is too small to be a ZIP file")
  const tailLength = Math.min(reader.size, 65_557 + 20)
  const tailStart = reader.size - tailLength
  const tail = await reader.readAt(tailStart, tailLength)
  let eocd = -1
  for (let index = tail.length - 22; index >= 0; index--) {
    if (u32(tail, index) !== SIG_EOCD) continue
    const commentLength = u16(tail, index + 20)
    if (index + 22 + commentLength > tail.length) continue
    eocd = index
    break
  }
  if (eocd < 0) throw new ArchiveError("INVALID_ARCHIVE", "ZIP end of central directory was not found")

  let entries = u16(tail, eocd + 10)
  let directorySize = u32(tail, eocd + 12)
  let directoryOffset = u32(tail, eocd + 16)
  const zip64 = entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff
  if (!zip64) return { entries, directorySize, directoryOffset }

  const absoluteEocd = tailStart + eocd
  if (absoluteEocd < 20) throw new ArchiveError("INVALID_ARCHIVE", "ZIP64 locator is missing")
  const locator = await reader.readAt(absoluteEocd - 20, 20)
  if (u32(locator, 0) !== SIG_LOCATOR64) throw new ArchiveError("INVALID_ARCHIVE", "ZIP64 locator is missing")
  const eocd64Offset = u64(locator, 8)
  const eocd64 = await reader.readAt(eocd64Offset, 56)
  if (u32(eocd64, 0) !== SIG_EOCD64) throw new ArchiveError("INVALID_ARCHIVE", "ZIP64 end of central directory is missing")
  entries = u64(eocd64, 32)
  directorySize = u64(eocd64, 40)
  directoryOffset = u64(eocd64, 48)
  return { entries, directorySize, directoryOffset }
}

interface Zip64Values {
  size?: number
  compressedSize?: number
  localOffset?: number
}

function parseZip64Extra(extra: Uint8Array, needs: { size: boolean; compressedSize: boolean; localOffset: boolean }): Zip64Values {
  if (!needs.size && !needs.compressedSize && !needs.localOffset) return {}
  let position = 0
  while (position + 4 <= extra.length) {
    const id = u16(extra, position)
    const length = u16(extra, position + 2)
    const dataStart = position + 4
    if (dataStart + length > extra.length) break
    if (id === 0x0001) {
      const values: Zip64Values = {}
      let cursor = dataStart
      const readNext = (): number => {
        const value = u64(extra, cursor)
        cursor += 8
        return value
      }
      if (needs.size) values.size = readNext()
      if (needs.compressedSize) values.compressedSize = readNext()
      if (needs.localOffset) values.localOffset = readNext()
      return values
    }
    position = dataStart + length
  }
  return {}
}

function isSymlinkEntry(externalAttributes: number): boolean {
  const mode = externalAttributes >>> 16
  return (mode & 0o170000) === 0o120000
}

/** Читает центральный каталог: имена, размеры и смещения без распаковки данных. */
export async function readZipDirectory(reader: ArchiveReader, options: ArchiveDirectoryOptions = {}): Promise<ArchiveEntryInfo[]> {
  throwIfAborted(options.signal)
  const eocd = await readEndOfCentralDirectory(reader)
  const maxEntries = options.maxEntries ?? MAX_ENTRIES
  const maxDirectorySize = options.maxDirectorySize ?? MAX_DIRECTORY_SIZE
  if (eocd.entries > maxEntries) {
    throw new ArchiveError("LIMIT_EXCEEDED", `Archive has ${eocd.entries} entries, limit is ${maxEntries}`)
  }
  if (eocd.directorySize > maxDirectorySize) {
    throw new ArchiveError("LIMIT_EXCEEDED", `Archive central directory is ${eocd.directorySize} bytes`)
  }
  if (eocd.directoryOffset + eocd.directorySize > reader.size) {
    throw new ArchiveError("INVALID_ARCHIVE", "ZIP central directory is out of bounds")
  }

  const directory = await reader.readAt(eocd.directoryOffset, eocd.directorySize)
  const entries: ArchiveEntryInfo[] = []
  let position = 0
  for (let index = 0; index < eocd.entries; index++) {
    throwIfAborted(options.signal)
    if (position + 46 > directory.length) throw new ArchiveError("INVALID_ARCHIVE", "Truncated ZIP central directory")
    if (u32(directory, position) !== SIG_CENTRAL) throw new ArchiveError("INVALID_ARCHIVE", "Invalid ZIP central directory entry")
    const flags = u16(directory, position + 8)
    const method = u16(directory, position + 10)
    const crc = u32(directory, position + 16)
    const rawCompressedSize = u32(directory, position + 20)
    const rawSize = u32(directory, position + 24)
    const nameLength = u16(directory, position + 28)
    const extraLength = u16(directory, position + 30)
    const commentLength = u16(directory, position + 32)
    const externalAttributes = u32(directory, position + 38)
    const rawLocalOffset = u32(directory, position + 42)
    const nameStart = position + 46
    const extraStart = nameStart + nameLength
    const next = extraStart + extraLength + commentLength
    if (next > directory.length) throw new ArchiveError("INVALID_ARCHIVE", "Truncated ZIP central directory entry")

    const zip64 = parseZip64Extra(directory.subarray(extraStart, extraStart + extraLength), {
      size: rawSize === 0xffffffff,
      compressedSize: rawCompressedSize === 0xffffffff,
      localOffset: rawLocalOffset === 0xffffffff,
    })
    const rawName = decodeName(directory.subarray(nameStart, nameStart + nameLength), (flags & FLAG_UTF8) !== 0)
    const directoryEntry = rawName.endsWith("/")
    entries.push({
      name: normalizeEntryName(directoryEntry ? rawName.slice(0, -1) : rawName),
      directory: directoryEntry,
      symlink: isSymlinkEntry(externalAttributes),
      method,
      flags,
      crc,
      compressedSize: zip64.compressedSize ?? rawCompressedSize,
      size: zip64.size ?? rawSize,
      localOffset: zip64.localOffset ?? rawLocalOffset,
    })
    position = next
  }
  return entries
}

export interface ReadEntryOptions {
  signal?: AbortSignal
  chunkSize?: number
}

/** Потоково распаковывает одну запись архива, не загружая её целиком в память. */
export async function* readEntryChunks(
  reader: ArchiveReader,
  entry: ArchiveEntryInfo,
  options: ReadEntryOptions = {},
): AsyncGenerator<Uint8Array> {
  const chunkSize = Math.max(4 * 1024, options.chunkSize ?? READ_CHUNK)
  throwIfAborted(options.signal)
  if ((entry.flags & 1) !== 0) throw new ArchiveError("INVALID_ARCHIVE", `Encrypted archive entry: ${entry.name}`, entry.name)
  const local = await reader.readAt(entry.localOffset, 30)
  if (u32(local, 0) !== SIG_LOCAL) throw new ArchiveError("INVALID_ARCHIVE", `Invalid local header for ${entry.name}`, entry.name)
  const nameLength = u16(local, 26)
  const extraLength = u16(local, 28)
  let position = entry.localOffset + 30 + nameLength + extraLength
  let remaining = entry.method === METHOD_STORE && entry.compressedSize === 0 ? entry.size : entry.compressedSize
  let expanded = 0
  const checkSize = (length: number) => {
    expanded += length
    if (expanded > entry.size) throw new ArchiveError("INVALID_ARCHIVE", `Archive entry ${entry.name} expands beyond its declared size`, entry.name)
  }
  const checkEnd = () => {
    if (expanded !== entry.size) throw new ArchiveError("INVALID_ARCHIVE", `Archive entry ${entry.name} has an invalid expanded size`, entry.name)
  }

  if (entry.method === METHOD_STORE) {
    while (remaining > 0) {
      throwIfAborted(options.signal)
      const length = Math.min(chunkSize, remaining)
      const chunk = await reader.readAt(position, length)
      position += length
      remaining -= length
      checkSize(chunk.length)
      yield chunk
    }
    checkEnd()
    return
  }

  if (entry.method !== METHOD_DEFLATE) {
    throw new ArchiveError("UNSUPPORTED_METHOD", `Unsupported compression method ${entry.method} for ${entry.name}`, entry.name)
  }

  const pending: Uint8Array[] = []
  const inflate = new Inflate((data) => {
    if (data.length) pending.push(data)
  })

  do {
    throwIfAborted(options.signal)
    const length = Math.min(chunkSize, remaining)
    const chunk = length > 0 ? await reader.readAt(position, length) : new Uint8Array(0)
    position += length
    remaining -= length
    try {
      inflate.push(chunk, remaining === 0)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ArchiveError("INVALID_ARCHIVE", `Cannot inflate ${entry.name}: ${message}`, entry.name)
    }
    while (pending.length > 0) {
      const data = pending.shift()!
      checkSize(data.length)
      yield data
    }
  } while (remaining > 0)
  checkEnd()
}
