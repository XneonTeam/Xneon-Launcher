import { probeImage } from "./image.js"
import { ArchiveContext, ParserError } from "./archive.js"
import { stat } from "node:fs/promises"

export function sha1(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha1").update(data).digest("hex")
}

export async function sha1File(path: string, options: { signal?: AbortSignal; maxSize?: number } = {}): Promise<string> {
  if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
  const initial = await stat(path).catch(() => null)
  if (!initial?.isFile()) throw new ParserError("IO_ERROR", "File does not exist")
  const file = Bun.file(path)
  const maxSize = options.maxSize ?? 512 * 1024 * 1024
  if (!Number.isSafeInteger(maxSize) || maxSize < 0 || initial.size > maxSize) throw new ParserError("LIMIT_EXCEEDED", "File size limit exceeded")
  const reader = file.stream().getReader()
  const hasher = new Bun.CryptoHasher("sha1")
  let total = 0
  try {
    while (true) {
      if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.length
      if (total > maxSize) throw new ParserError("LIMIT_EXCEEDED", "File size limit exceeded")
      hasher.update(chunk.value)
    }
    if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
    const current = await stat(path).catch(() => null)
    if (!current || total !== initial.size || current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs) throw new ParserError("IO_ERROR", "File changed while hashing")
    if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
    return hasher.digest("hex")
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
    if (error instanceof ParserError) throw error
    throw new ParserError("IO_ERROR", "Unable to read file while hashing")
  } finally {
    reader.releaseLock()
  }
}

const isWhitespace = (b: number) => b === 9 || b === 10 || b === 13 || b === 32
class FingerprintState {
  private hash: number
  private word = 0
  private shift = 0
  constructor(length: number) { this.hash = (1 ^ length) | 0 }
  update(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      const b = data[i]
      if (isWhitespace(b)) continue
      this.word |= b << this.shift
      this.shift += 8
      if (this.shift === 32) {
        let k = Math.imul(this.word, 0x5bd1e995); k ^= k >>> 24; k = Math.imul(k, 0x5bd1e995)
        this.hash = Math.imul(this.hash, 0x5bd1e995) ^ k
        this.word = 0; this.shift = 0
      }
    }
  }
  digest(): number {
    let hash = this.hash
    if (this.shift) { hash ^= this.word; hash = Math.imul(hash, 0x5bd1e995) }
    hash ^= hash >>> 13; hash = Math.imul(hash, 0x5bd1e995); hash ^= hash >>> 15
    return hash >>> 0
  }
}
export function curseforgeFingerprint(data: Uint8Array): number {
  let length = 0
  for (let i = 0; i < data.length; i++) if (!isWhitespace(data[i])) length++
  const state = new FingerprintState(length)
  state.update(data)
  return state.digest()
}

export async function curseforgeFingerprintFile(path: string, options: { signal?: AbortSignal; maxSize?: number } = {}): Promise<number> {
  return (await fingerprintFile(path, options, false)).curseforgeFingerprint
}

/** SHA-1 считается при первом проходе fingerprint, без третьего чтения файла. */
export async function hashesFile(path: string, options: { signal?: AbortSignal; maxSize?: number } = {}): Promise<{ sha1: string; curseforgeFingerprint: number }> {
  const result = await fingerprintFile(path, options, true)
  return { sha1: result.sha1!, curseforgeFingerprint: result.curseforgeFingerprint }
}

async function fingerprintFile(path: string, options: { signal?: AbortSignal; maxSize?: number }, withSha1: boolean): Promise<{ sha1?: string; curseforgeFingerprint: number }> {
  if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
  const maxSize = options.maxSize ?? 512 * 1024 * 1024
  if (!Number.isSafeInteger(maxSize) || maxSize < 0) throw new ParserError("LIMIT_EXCEEDED", "Invalid file size limit")
  const initial = await stat(path).catch(() => null)
  if (!initial || !initial.isFile()) throw new ParserError("IO_ERROR", "File does not exist")
  if (initial.size > maxSize) throw new ParserError("LIMIT_EXCEEDED", "File size limit exceeded")
  const unchanged = async () => {
    const current = await stat(path).catch(() => null)
    if (!current || current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs) throw new ParserError("IO_ERROR", "File changed while hashing")
  }
  const eachChunk = async (visit: (bytes: Uint8Array) => void) => {
    if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
    const reader = Bun.file(path).stream().getReader()
    let total = 0
    try {
      while (true) {
        if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
        const item = await reader.read()
        if (item.done) break
        total += item.value.length
        if (total > maxSize) throw new ParserError("LIMIT_EXCEEDED", "File size limit exceeded")
        visit(item.value)
      }
      if (total !== initial.size) throw new ParserError("IO_ERROR", "File changed while hashing")
    } catch (error) {
      await reader.cancel().catch(() => {})
      if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
      if (error instanceof ParserError) throw error
      throw new ParserError("IO_ERROR", "Unable to read file while hashing")
    } finally { reader.releaseLock() }
    if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted")
    await unchanged()
  }
  let length = 0
  const hasher = withSha1 ? new Bun.CryptoHasher("sha1") : undefined
  await eachChunk(bytes => { hasher?.update(bytes); for (let i = 0; i < bytes.length; i++) if (!isWhitespace(bytes[i])) length++ })
  const state = new FingerprintState(length)
  await eachChunk(bytes => state.update(bytes))
  return { sha1: hasher?.digest("hex"), curseforgeFingerprint: state.digest() }
}

export async function extractIcon(archive: ArchiveContext, path: string): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
  if (!archive.get(path)) return undefined
  const data = await archive.read(path, archive.limits.maxIconSize)
  return { data, mimeType: probeImage(data).mimeType }
}
