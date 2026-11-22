import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstat, mkdir, open, readFile, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { createZstdDecompress } from "node:zlib"
import type { UnixUpdateManifest } from "./update-manifest"
import { UPDATE_MAX_BYTES } from "./update-manifest"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"

type Entry = { name: string; type: "file" | "directory" | "symlink"; offset: number; size: number; mode: number; link?: string }
const decoder = new TextDecoder("utf-8", { fatal: true })
const text = (bytes: Buffer) => decoder.decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)))
function octal(bytes: Buffer) {
  const value = bytes.toString("ascii").replace(/\0.*$/, "").trim()
  assert.match(value || "0", /^[0-7]+$/, "Invalid tar numeric field")
  const number = parseInt(value || "0", 8)
  assert.ok(Number.isSafeInteger(number) && number >= 0, "Invalid tar size")
  return number
}
function safeName(name: string, root: string) {
  name = name.replace(/^(?:\.\/)+/, "").replace(/\/$/, "")
  assert.ok(name.length > 0 && name.length <= 4096 && !/[\\:\u0000-\u001f]/.test(name), "Unsafe update archive path")
  const parts = name.split("/")
  assert.ok(parts.length <= 64 && parts.every(part => part && part !== "." && part !== "..") && parts[0] === root, "Update archive escapes bundle")
  return name
}
function paxRecords(data: Buffer) {
  const result: Record<string, string> = Object.create(null)
  let cursor = 0
  while (cursor < data.length) {
    const space = data.indexOf(32, cursor)
    assert.ok(space > cursor && space - cursor <= 9, "Invalid PAX record length")
    const digits = data.toString("ascii", cursor, space)
    assert.match(digits, /^[1-9]\d*$/)
    const end = cursor + Number(digits)
    assert.ok(end > space + 2 && end <= data.length && data[end - 1] === 10, "Truncated PAX record")
    const record = decoder.decode(data.subarray(space + 1, end - 1)), equals = record.indexOf("=")
    assert.ok(equals > 0, "Invalid PAX record")
    const key = record.slice(0, equals)
    assert.ok(!Object.hasOwn(result, key) && !/sparse|filetype/i.test(key), "Unsupported PAX metadata")
    result[key] = record.slice(equals + 1)
    cursor = end
  }
  return result
}

/** Полная проверка структуры до первой записи; ссылки рассматриваются как граф, а не только lexical paths. */
export function inspectUnixUpdateTar(tar: Buffer, root: string): Entry[] {
  assert.ok(root && !/[\/\\:\u0000-\u001f]/.test(root) && root !== "." && root !== "..", "Invalid bundle root")
  assert.ok(tar.length <= UPDATE_MAX_BYTES && tar.length % 512 === 0, "Invalid tar length")
  const entries: Entry[] = [], seen = new Set<string>(), folded = new Set<string>()
  let cursor = 0, extended: Record<string, string> = {}, ended = false
  while (cursor + 512 <= tar.length) {
    const header = tar.subarray(cursor, cursor + 512)
    if (header.every(byte => byte === 0)) {
      assert.ok(cursor + 1024 <= tar.length && tar.subarray(cursor).every(byte => byte === 0), "Invalid tar trailer")
      ended = true; break
    }
    assert.equal(text(header.subarray(257, 263)).slice(0, 5), "ustar", "Unsupported tar header")
    const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0)
    assert.equal(octal(header.subarray(148, 156)), checksum, "Tar checksum mismatch")
    const size = octal(header.subarray(124, 136)), dataOffset = cursor + 512
    const next = dataOffset + Math.ceil(size / 512) * 512
    assert.ok(next <= tar.length, "Truncated update tar")
    const type = String.fromCharCode(header[156] || 48)
    if (["x", "g", "L", "K"].includes(type)) {
      assert.ok(size <= 1024 ** 2, "Oversized tar extended metadata")
      const data = tar.subarray(dataOffset, dataOffset + size)
      if (type === "x") extended = { ...extended, ...paxRecords(data) }
      else if (type === "g") {
        const global = paxRecords(data)
        assert.ok(!["path", "linkpath", "size"].some(key => Object.hasOwn(global, key)), "Unsafe global PAX metadata")
      } else extended[type === "L" ? "path" : "linkpath"] = text(data)
      cursor = next; continue
    }
    assert.ok(["0", "5", "2"].includes(type), "Unsupported update tar entry type")
    if (extended.size !== undefined) assert.equal(extended.size, String(size), "Conflicting PAX size")
    const prefix = text(header.subarray(345, 500)), basename = text(header.subarray(0, 100))
    const name = safeName(extended.path ?? (prefix ? prefix + "/" : "") + basename, root)
    const normalized = name.normalize("NFC").toLowerCase()
    assert.ok(!seen.has(name) && !folded.has(normalized), "Duplicate update tar entry")
    seen.add(name); folded.add(normalized)
    const link = type === "2" ? extended.linkpath ?? text(header.subarray(157, 257)) : undefined
    if (link !== undefined) assert.ok(link && link.length <= 4096 && !/[\\:\u0000-\u001f]/.test(link) && !link.startsWith("/"), "Unsafe update symlink")
    assert.ok(type === "0" || size === 0, "Unexpected data in tar link/directory")
    entries.push({ name, type: type === "0" ? "file" : type === "5" ? "directory" : "symlink", offset: dataOffset, size, mode: octal(header.subarray(100, 108)), ...(link !== undefined ? { link } : {}) })
    assert.ok(entries.length <= 50_000, "Too many update archive entries")
    extended = {}; cursor = next
  }
  assert.ok(ended && entries.length > 0 && Object.keys(extended).length === 0, "Incomplete update tar")
  const nodes = new Map(entries.map(entry => [entry.name, entry]))
  for (const entry of entries) {
    for (let parent = path.posix.dirname(entry.name); parent !== "."; parent = path.posix.dirname(parent)) {
      const existing = nodes.get(parent)
      assert.ok(!existing || existing.type === "directory", "Update archive traverses a non-directory")
      if (!existing) nodes.set(parent, { name: parent, type: "directory", offset: 0, size: 0, mode: 0o755 })
    }
  }
  assert.equal(nodes.get(root)?.type, "directory", "Invalid update bundle root")
  for (const entry of entries.filter(entry => entry.type === "symlink")) {
    const pending = [...entry.name.split("/").slice(0, -1), ...entry.link!.split("/")], stack: string[] = []
    let hops = 0
    while (pending.length) {
      const part = pending.shift()!
      if (!part || part === ".") continue
      if (part === "..") { assert.ok(stack.length > 1, "Update symlink escapes bundle"); stack.pop(); continue }
      stack.push(part)
      assert.equal(stack[0], root, "Update symlink escapes bundle")
      const node = nodes.get(stack.join("/"))
      assert.ok(node, "Dangling update symlink")
      if (node.type === "symlink") {
        assert.ok(++hops <= 40, "Cyclic update symlink")
        stack.pop(); pending.unshift(...node.link!.split("/"))
      } else if (pending.length) assert.equal(node.type, "directory", "Update link traverses a file")
    }
  }
  return entries
}

/**
 * Проверяет структуру всех Zstd frames и объявленный Content Size, если он есть.
 * Hutch 0.30 пишет потоковый кадр (fcs_flag=0) и размер не объявляет, поэтому
 * фактический размер проверяет `decompressUnixUpdateArchive`: выход ограничен
 * подписанным `tarSize` и обязан с ним совпасть.
 */
export function assertZstdSize(bytes: Buffer, expected: number) {
  let cursor = 0, declared = 0n, frames = 0, complete = true
  while (cursor < bytes.length) {
    assert.ok(cursor + 5 <= bytes.length && bytes.readUInt32LE(cursor) === 0xfd2fb528 && ++frames <= 1024, "Invalid Zstd frame")
    cursor += 4
    const descriptor = bytes[cursor++], single = !!(descriptor & 32), flag = descriptor >>> 6
    assert.ok(!(descriptor & 24), "Unsupported Zstd frame flags")
    if (!single) { assert.ok(cursor < bytes.length, "Truncated Zstd frame header"); cursor++ }
    const dictionarySize = [0, 1, 2, 4][descriptor & 3]
    assert.ok(dictionarySize === 0, "Zstd dictionary updates are unsupported")
    const sizeBytes = flag === 0 ? single ? 1 : 0 : [0, 2, 4, 8][flag]
    if (!sizeBytes) complete = false
    else {
      assert.ok(cursor + sizeBytes <= bytes.length, "Truncated Zstd content size")
      const size = sizeBytes === 8 ? bytes.readBigUInt64LE(cursor) : BigInt(bytes.readUIntLE(cursor, sizeBytes)) + (flag === 1 ? 256n : 0n)
      declared += size
      assert.ok(declared <= BigInt(expected), "Zstd output exceeds signed tar size")
      cursor += sizeBytes
    }
    let last = false
    while (!last) {
      assert.ok(cursor + 3 <= bytes.length, "Truncated Zstd block")
      const block = bytes.readUIntLE(cursor, 3); cursor += 3
      last = !!(block & 1)
      const type = (block >>> 1) & 3, length = block >>> 3
      assert.ok(type !== 3, "Invalid Zstd block")
      cursor += type === 1 ? 1 : length
      assert.ok(cursor <= bytes.length, "Truncated Zstd block data")
    }
    if (descriptor & 4) cursor += 4
    assert.ok(cursor <= bytes.length, "Truncated Zstd checksum")
  }
  assert.ok(frames > 0, "Empty Zstd update")
  if (complete) assert.equal(declared, BigInt(expected), "Zstd content size differs from signed tar size")
}

/**
 * Распаковывает Zstd-архив в буфер, ограниченный подписанным `tarSize`.
 * Потоковый кадр без Content Size распаковывается стримом, поэтому архив,
 * который разворачивается больше подписанного размера, отвергается, не успев
 * выделить лишнюю память; итоговая длина обязана совпасть с `tarSize`.
 */
export async function decompressUnixUpdateArchive(bytes: Buffer, expected: number, signal?: AbortSignal) {
  assert.ok(Number.isSafeInteger(expected) && expected > 0 && expected <= UPDATE_MAX_BYTES, "Invalid signed tar size")
  signal?.throwIfAborted()
  assertZstdSize(bytes, expected)
  const tar = Buffer.allocUnsafe(expected)
  let written = 0
  const stream = createZstdDecompress()
  const onAbort = () => stream.destroy(new Error("Update archive extraction aborted"))
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        if (written + chunk.length > expected) { stream.destroy(new Error("Zstd output exceeds signed tar size")); return }
        chunk.copy(tar, written); written += chunk.length
      })
      stream.once("error", reject)
      stream.once("end", resolve)
      stream.end(bytes)
    })
  } finally { signal?.removeEventListener("abort", onAbort) }
  signal?.throwIfAborted()
  assert.equal(written, expected, "Update tar size mismatch")
  return tar
}

export async function extractUnixUpdateArchive(source: string, destination: string, root: string,
  artifact: UnixUpdateManifest["artifact"], signal?: AbortSignal) {
  destination = path.resolve(destination)
  signal?.throwIfAborted()
  const info = await lstat(source)
  assert.ok(info.isFile() && info.size === artifact.downloadSize && info.size <= UPDATE_MAX_BYTES, "Invalid update archive file/size")
  const compressed = await readFile(source)
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
  assert.equal(compressed.length, artifact.downloadSize, "Update archive size mismatch")
  assert.equal(sha(compressed), artifact.downloadSha256, "Update archive SHA-256 mismatch")
  assert.ok(Number.isSafeInteger(artifact.tarSize) && artifact.tarSize > 0 && artifact.tarSize <= UPDATE_MAX_BYTES)
  const tar = await decompressUnixUpdateArchive(compressed, artifact.tarSize, signal)
  assert.equal(sha(tar), artifact.tarSha256, "Update tar SHA-256 mismatch")
  const entries = inspectUnixUpdateTar(tar, root)
  signal?.throwIfAborted()
  await mkdir(destination, { mode: 0o700 })
  try {
    for (const entry of entries.filter(entry => entry.type !== "symlink")) {
      signal?.throwIfAborted()
      const file = path.join(destination, ...entry.name.split("/"))
      if (entry.type === "directory") await mkdir(file, { recursive: true, mode: 0o755 })
      else {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o755 })
        const handle = await open(file, "wx", entry.mode & 0o111 ? 0o755 : 0o644)
        try { await handle.writeFile(tar.subarray(entry.offset, entry.offset + entry.size)); await handle.sync() } finally { await handle.close() }
      }
    }
    for (const entry of entries.filter(entry => entry.type === "symlink")) {
      signal?.throwIfAborted()
      const file = path.join(destination, ...entry.name.split("/"))
      await mkdir(path.dirname(file), { recursive: true, mode: 0o755 })
      await symlink(entry.link!, file)
    }
    const directories = new Set([destination])
    for (const entry of entries) {
      const file = path.join(destination, ...entry.name.split("/"))
      if (entry.type === "directory") directories.add(file)
      for (let parent = path.dirname(file); parent !== destination; parent = path.dirname(parent)) directories.add(parent)
    }
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) await syncUnixUpdateDirectory(directory)
    await syncUnixUpdateDirectory(path.dirname(destination))
    return path.join(destination, root)
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error }
}
