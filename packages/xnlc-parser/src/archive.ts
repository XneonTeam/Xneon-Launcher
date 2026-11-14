import { Readable } from "node:stream"
import { createInflateRaw } from "node:zlib"
import { stat } from "node:fs/promises"

export type ParserErrorCode = "INVALID_ARCHIVE" | "CORRUPTED_ARCHIVE" | "UNSUPPORTED_ARCHIVE" | "INVALID_CLASS" | "LIMIT_EXCEEDED" | "ABORTED" | "CLOSED" | "IO_ERROR" | "TIMEOUT"

export class ParserError extends Error {
  constructor(public readonly code: ParserErrorCode, message: string) { super(message); this.name = "ParserError" }
}

export interface ArchiveLimits {
  maxArchiveSize: number
  maxCentralDirectorySize: number
  maxEntries: number
  maxEntrySize: number
  maxTotalUncompressedSize: number
  maxMetadataSize: number
  maxIconSize: number
  maxNestedDepth: number
  maxNestedArchives: number
  maxNestedArchiveSize: number
  maxNestedTotalSize: number
  maxReadBytes: number
  maxReadAttempts: number
  maxConcurrentReads: number
}
export interface ArchiveOptions { limits?: Partial<ArchiveLimits>; signal?: AbortSignal; nested?: boolean }
export interface ArchiveEntry { readonly name: string; readonly size: number; readonly compressedSize: number; readonly method: number; readonly crc32: number; readonly offset: number; readonly flags: number }
const defaults: ArchiveLimits = { maxArchiveSize: 512 * 1024 * 1024, maxCentralDirectorySize: 16 * 1024 * 1024, maxEntries: 100000, maxEntrySize: 64 * 1024 * 1024, maxTotalUncompressedSize: 256 * 1024 * 1024, maxMetadataSize: 2 * 1024 * 1024, maxIconSize: 4 * 1024 * 1024, maxNestedDepth: 2, maxNestedArchives: 64, maxNestedArchiveSize: 32 * 1024 * 1024, maxNestedTotalSize: 128 * 1024 * 1024, maxReadBytes: 512 * 1024 * 1024, maxReadAttempts: 100000, maxConcurrentReads: 8 }
type Source = { size: number; read(offset: number, length: number): Promise<Uint8Array> }
const decoder = new TextDecoder("utf-8", { fatal: true })
function fail(code: ParserErrorCode, message: string): never { throw new ParserError(code, message) }
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) fail("ABORTED", "Operation aborted") }
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
function safeName(name: string) { return !!name && !name.includes("\0") && !name.includes("\\") && !name.startsWith("/") && !name.includes("//") && !/^[a-z]:/i.test(name) && !name.split("/").some(p => p === "." || p === "..") }
function crc32(data: Uint8Array): number {
  return Bun.hash.crc32(data)
}

export class ArchiveContext {
  private closed = false
  private budget = { total: 0, attemptedBytes: 0, attempts: 0, active: 0 }
  private constructor(private source: Source, private readonly index: Map<string, ArchiveEntry>, private readonly boundaries: Map<string, number>, readonly limits: Readonly<ArchiveLimits>, private readonly signal?: AbortSignal) {}

  static async open(input: string | Uint8Array, options: ArchiveOptions = {}): Promise<ArchiveContext> {
    const limits = { ...defaults, ...options.limits }
    for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 0) fail("LIMIT_EXCEEDED", `Invalid limit ${key}`)
    checkSignal(options.signal)
    let source: Source
    if (typeof input === "string") {
      const file = Bun.file(input)
      const initial = await stat(input).catch(() => null)
      if (!initial?.isFile()) fail("IO_ERROR", "Archive does not exist")
      const verify = async () => {
        const current = await stat(input).catch(() => null)
        if (!current || current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs) fail("IO_ERROR", "Archive changed while reading")
      }
      source = { size: initial.size, read: async (offset, length) => {
        await verify()
        let bytes: Uint8Array
        try { bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) } catch { return fail("IO_ERROR", "Unable to read archive") }
        await verify()
        return bytes
      } }
    } else source = { size: input.byteLength, read: async (offset, length) => input.subarray(offset, offset + length) }
    if (source.size > limits.maxArchiveSize) fail("LIMIT_EXCEEDED", "Archive size limit exceeded")
    const read = async (offset: number, length: number) => {
      checkSignal(options.signal)
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > source.size) fail("CORRUPTED_ARCHIVE", "Archive range out of bounds")
      const result = await source.read(offset, length)
      if (result.length !== length) fail("CORRUPTED_ARCHIVE", "Truncated archive")
      return result
    }
    const tailLength = Math.min(source.size, 65557)
    const tail = await read(source.size - tailLength, tailLength)
    const tv = view(tail)
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50 && i + 22 + tv.getUint16(i + 20, true) === tail.length) { end = i; break }
    if (end < 0) fail("INVALID_ARCHIVE", "ZIP end record not found")
    const disk = tv.getUint16(end + 4, true), cdDisk = tv.getUint16(end + 6, true), countDisk = tv.getUint16(end + 8, true), count = tv.getUint16(end + 10, true)
    const cdSize = tv.getUint32(end + 12, true), cdOffset = tv.getUint32(end + 16, true)
    if (disk || cdDisk || countDisk !== count) fail("UNSUPPORTED_ARCHIVE", "Multi-disk ZIP is unsupported")
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail("UNSUPPORTED_ARCHIVE", "ZIP64 is unsupported")
    if (count > limits.maxEntries || cdSize > limits.maxCentralDirectorySize) fail("LIMIT_EXCEEDED", "Central directory limit exceeded")
    if (cdOffset + cdSize > source.size - tailLength + end) fail("CORRUPTED_ARCHIVE", "Invalid central directory range")
    const central = await read(cdOffset, cdSize), cv = view(central)
    const index = new Map<string, ArchiveEntry>()
    let p = 0
    for (let i = 0; i < count; i++) {
      if (p + 46 > central.length || cv.getUint32(p, true) !== 0x02014b50) fail("CORRUPTED_ARCHIVE", "Invalid central directory record")
      const flags = cv.getUint16(p + 8, true), method = cv.getUint16(p + 10, true), crc = cv.getUint32(p + 16, true), compressedSize = cv.getUint32(p + 20, true), size = cv.getUint32(p + 24, true)
      const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true), diskStart = cv.getUint16(p + 34, true), offset = cv.getUint32(p + 42, true)
      if (p + 46 + nl + xl + cl > central.length) fail("CORRUPTED_ARCHIVE", "Truncated central directory record")
      if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff || diskStart === 0xffff) fail("UNSUPPORTED_ARCHIVE", "ZIP64 is unsupported")
      if (diskStart || flags & (1 | 0x40 | 0x2000)) fail("UNSUPPORTED_ARCHIVE", "Encrypted or multi-disk entry")
      let name: string
      try { name = decoder.decode(central.subarray(p + 46, p + 46 + nl)) } catch { return fail("UNSUPPORTED_ARCHIVE", "Invalid UTF-8 entry name") }
      if (!safeName(name) || index.has(name)) fail("CORRUPTED_ARCHIVE", "Unsafe or duplicate entry name")
      index.set(name, Object.freeze({ name, size, compressedSize, method, crc32: crc, offset, flags }))
      p += 46 + nl + xl + cl
    }
    if (p !== central.length) fail("CORRUPTED_ARCHIVE", "Unexpected central directory data")
    const sorted = [...index.values()].sort((a, b) => a.offset - b.offset)
    const boundaries = new Map<string, number>()
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i], end = sorted[i + 1]?.offset ?? cdOffset
      // Даже без переменной части локального заголовка такие записи уже перекрываются.
      if (entry.offset + 30 + entry.compressedSize > end) fail("CORRUPTED_ARCHIVE", "Overlapping entry ranges")
      boundaries.set(entry.name, end)
    }
    return new ArchiveContext(source, index, boundaries, Object.freeze(limits), options.signal)
  }

  entries(): readonly ArchiveEntry[] { this.check(); return [...this.index.values()] }
  get(name: string): ArchiveEntry | undefined { this.check(); return this.index.get(name) }
  async openNested(input: Uint8Array, options: ArchiveOptions = {}): Promise<ArchiveContext> {
    this.check()
    const limits = { ...this.limits }
    for (const [key, value] of Object.entries(options.limits ?? {})) {
      if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 0) fail("LIMIT_EXCEEDED", `Invalid limit ${key}`)
      const name = key as keyof ArchiveLimits
      limits[name] = Math.min(limits[name], value)
    }
    const signal = this.signal && options.signal ? AbortSignal.any([this.signal, options.signal]) : options.signal ?? this.signal
    const child = await ArchiveContext.open(input, { ...options, limits, signal })
    this.check()
    child.budget = this.budget
    return child
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.index.clear(); this.boundaries.clear()
    // Буфер вызывающей стороны не копируется, поэтому после закрытия не удерживаем ссылку на него.
    this.source = { size: 0, read: async () => fail("CLOSED", "Archive is closed") }
  }
  private check() { if (this.closed) fail("CLOSED", "Archive is closed"); checkSignal(this.signal) }

  async read(name: string, maxSize = this.limits.maxEntrySize, signal?: AbortSignal): Promise<Uint8Array> {
    const check = () => { this.check(); checkSignal(signal) }
    check()
    const entry = this.index.get(name)
    if (!entry) fail("INVALID_ARCHIVE", `Entry not found: ${name}`)
    if (entry.method !== 0 && entry.method !== 8) fail("UNSUPPORTED_ARCHIVE", "Unsupported compression method")
    const limit = Math.min(maxSize, this.limits.maxEntrySize, this.limits.maxTotalUncompressedSize - this.budget.total)
    if (!Number.isSafeInteger(maxSize) || limit < 0 || entry.size > limit) fail("LIMIT_EXCEEDED", "Entry size limit exceeded")
    if (entry.compressedSize > this.limits.maxEntrySize + 65536) fail("LIMIT_EXCEEDED", "Compressed entry size limit exceeded")
    if (this.budget.active >= this.limits.maxConcurrentReads || this.budget.attempts >= this.limits.maxReadAttempts || entry.compressedSize > this.limits.maxReadBytes - this.budget.attemptedBytes) fail("LIMIT_EXCEEDED", "Archive read budget exceeded")
    this.budget.attempts++
    this.budget.attemptedBytes += entry.compressedSize
    this.budget.active++
    // Резервируем бюджет до await, чтобы параллельные чтения не обходили лимит.
    this.budget.total += entry.size
    try {
    if (entry.offset + 30 > this.source.size) fail("CORRUPTED_ARCHIVE", "Invalid local header")
    const header = await this.source.read(entry.offset, 30)
    if (header.length !== 30) fail("CORRUPTED_ARCHIVE", "Truncated local header")
    const h = view(header)
    if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(6, true) !== entry.flags || h.getUint16(8, true) !== entry.method) fail("CORRUPTED_ARCHIVE", "Local header mismatch")
    if (!(entry.flags & 8) && (h.getUint32(14, true) !== entry.crc32 || h.getUint32(18, true) !== entry.compressedSize || h.getUint32(22, true) !== entry.size)) fail("CORRUPTED_ARCHIVE", "Local entry sizes or CRC mismatch")
    const nl = h.getUint16(26, true), xl = h.getUint16(28, true), dataOffset = entry.offset + 30 + nl + xl
    if (dataOffset + entry.compressedSize > this.boundaries.get(name)!) fail("CORRUPTED_ARCHIVE", "Entry data overlaps another entry")
    const localName = await this.source.read(entry.offset + 30, nl)
    let decoded: string
    try { decoded = decoder.decode(localName) } catch { return fail("CORRUPTED_ARCHIVE", "Invalid local name") }
    if (decoded !== entry.name) fail("CORRUPTED_ARCHIVE", "Local entry name mismatch")
    if (entry.flags & 8) {
      const descriptorOffset = dataOffset + entry.compressedSize
      const available = this.boundaries.get(name)! - descriptorOffset
      if (available < 12) fail("CORRUPTED_ARCHIVE", "Missing data descriptor")
      const length = Math.min(available, 16)
      const descriptor = await this.source.read(descriptorOffset, length)
      if (descriptor.length !== length) fail("CORRUPTED_ARCHIVE", "Truncated data descriptor")
      const d = view(descriptor)
      const matches = (offset: number) => descriptor.length >= offset + 12 && d.getUint32(offset, true) === entry.crc32 && d.getUint32(offset + 4, true) === entry.compressedSize && d.getUint32(offset + 8, true) === entry.size
      if (!matches(0) && !(descriptor.length >= 16 && d.getUint32(0, true) === 0x08074b50 && matches(4))) fail("CORRUPTED_ARCHIVE", "Data descriptor mismatch")
    }
    let data: Uint8Array
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) fail("CORRUPTED_ARCHIVE", "Stored entry size mismatch")
      data = await this.source.read(dataOffset, entry.compressedSize)
      if (data.length !== entry.compressedSize) fail("CORRUPTED_ARCHIVE", "Truncated entry")
      check()
    }
    else {
      const context = this
      const compressedSize = entry.compressedSize
      async function* compressedChunks(): AsyncGenerator<Uint8Array> {
        for (let offset = 0; offset < compressedSize;) {
          check()
          const length = Math.min(64 * 1024, compressedSize - offset)
          const chunk = await context.source.read(dataOffset + offset, length)
          if (chunk.length !== length) fail("CORRUPTED_ARCHIVE", "Truncated entry")
          offset += length
          yield chunk
        }
      }
      const input = Readable.from(compressedChunks())
      const inflater = createInflateRaw({ chunkSize: 16 * 1024 })
      input.on("error", error => inflater.destroy(error))
      const output = new Uint8Array(entry.size)
      let size = 0
      const abort = () => inflater.destroy(new ParserError("ABORTED", "Operation aborted"))
      this.signal?.addEventListener("abort", abort, { once: true })
      signal?.addEventListener("abort", abort, { once: true })
      try {
        check()
        input.pipe(inflater)
        for await (const part of inflater) {
          check()
          const chunk = part as Uint8Array
          size += chunk.length
          if (size > limit || size > entry.size) fail("LIMIT_EXCEEDED", "Inflated entry exceeds limit")
          output.set(chunk, size - chunk.length)
        }
        if (inflater.bytesWritten !== compressedSize) fail("CORRUPTED_ARCHIVE", "Trailing compressed data")
      } catch (error) { if (error instanceof ParserError) throw error; fail("CORRUPTED_ARCHIVE", "Invalid compressed entry") }
      finally { this.signal?.removeEventListener("abort", abort); signal?.removeEventListener("abort", abort); input.destroy(); inflater.destroy() }
      data = output.subarray(0, size)
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc32) fail("CORRUPTED_ARCHIVE", "Entry size or CRC mismatch")
    check()
    return data
    } catch (error) {
      this.budget.total -= entry.size
      throw error
    } finally { this.budget.active-- }
  }
}

