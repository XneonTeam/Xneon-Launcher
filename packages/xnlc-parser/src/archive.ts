import { ArchiveError, readZipDirectory, readEntryChunks, type ArchiveEntryInfo, type ArchiveReader } from "@xnlc/archives"
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
type Source = ArchiveReader
function fail(code: ParserErrorCode, message: string): never { throw new ParserError(code, message) }
function translateZipError(error: unknown, opening = false): never {
  if (error instanceof ParserError) throw error
  if (!(error instanceof ArchiveError)) throw error
  if (error.code === "UNSUPPORTED_METHOD") throw new ParserError("UNSUPPORTED_ARCHIVE", error.message)
  if (error.code === "LIMIT_EXCEEDED" || error.code === "ABORTED" || error.code === "IO_ERROR") fail(error.code, error.message)
  if (error.message.includes("expands beyond")) fail("LIMIT_EXCEEDED", error.message)
  if (opening && /too small|central directory was not found/.test(error.message)) fail("INVALID_ARCHIVE", error.message)
  fail("CORRUPTED_ARCHIVE", error.message)
}
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) fail("ABORTED", "Operation aborted") }
function safeName(name: string) { return !!name && !name.includes("\0") && !name.includes("\\") && !name.startsWith("/") && !name.includes("//") && !/^[a-z]:/i.test(name) && !name.split("/").some(p => p === "." || p === "..") }
function crc32(data: Uint8Array): number {
  return Bun.hash.crc32(data)
}

export class ArchiveContext {
  private closed = false
  private budget = { total: 0, attemptedBytes: 0, attempts: 0, active: 0 }
  private constructor(private source: Source, private readonly index: Map<string, ArchiveEntry>, private readonly records: Map<string, ArchiveEntryInfo>, readonly limits: Readonly<ArchiveLimits>, private readonly signal?: AbortSignal) {}

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
      source = { size: initial.size, close: async () => {}, readAt: async (offset, length) => {
        await verify()
        let bytes: Uint8Array
        try { bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) } catch { return fail("IO_ERROR", "Unable to read archive") }
        await verify()
        return bytes
      } }
    } else source = { size: input.byteLength, close: async () => {}, readAt: async (offset, length) => input.subarray(offset, offset + length) }
    if (source.size > limits.maxArchiveSize) fail("LIMIT_EXCEEDED", "Archive size limit exceeded")
    const index = new Map<string, ArchiveEntry>()
    const records = new Map<string, ArchiveEntryInfo>()
    try {
      const entries = await readZipDirectory(source, {
        signal: options.signal, maxEntries: limits.maxEntries,
        maxDirectorySize: limits.maxCentralDirectorySize, strict: true,
      })
      for (const entry of entries) {
        const name = entry.rawName ?? entry.name
        if (!safeName(name) || index.has(name)) fail("CORRUPTED_ARCHIVE", "Unsafe or duplicate entry name")
        records.set(name, entry)
        index.set(name, Object.freeze({
          name, size: entry.size, compressedSize: entry.compressedSize, method: entry.method,
          crc32: entry.crc, offset: entry.localOffset, flags: entry.flags,
        }))
      }
    } catch (error) { translateZipError(error, true) }
    return new ArchiveContext(source, index, records, Object.freeze(limits), options.signal)
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
    this.index.clear(); this.records.clear()
    // Буфер вызывающей стороны не копируется, поэтому после закрытия не удерживаем ссылку на него.
    this.source = { size: 0, readAt: async () => fail("CLOSED", "Archive is closed"), close: async () => {} }
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
    const combined = this.signal && signal ? AbortSignal.any([this.signal, signal]) : signal ?? this.signal
    const data = new Uint8Array(entry.size)
    let offset = 0
    try {
      for await (const chunk of readEntryChunks(this.source, this.records.get(name)!, { strict: true, signal: combined })) {
        check()
        data.set(chunk, offset)
        offset += chunk.length
      }
    } catch (error) { translateZipError(error) }
    if (offset !== entry.size || crc32(data) !== entry.crc32) fail("CORRUPTED_ARCHIVE", "Entry size or CRC mismatch")
    check()
    return data
    } catch (error) {
      this.budget.total -= entry.size
      throw error
    } finally { this.budget.active-- }
  }
}

