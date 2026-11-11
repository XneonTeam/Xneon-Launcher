import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"

/**
 * Метафайлы релиза в формате electron-builder — `.blockmap` и `latest*.yml` —
 * чтобы набор файлов совпадал с прежней Electron-сборкой.
 *
 * Наш лаунчер эти файлы не читает: обновления идут через подписанный
 * `*-update-v2.json` и `tar.zst`. Поэтому `.blockmap` здесь — честная карта
 * блоков в формате v2 (gzip + JSON), побайтно совпадающая с выводом
 * app-builder/electron-builder: тот же Rabin-чанкер (poly 0xbfe6b8a5bf378d83,
 * окно 64, min 8 КиБ, avg 16 КиБ, max 32 КиБ) и BLAKE2b с дайджестом 18 байт.
 */

const POLYNOMIAL = 0xbfe6b8a5bf378d83n
const DEGREE = 63
const WINDOW = 64
const MIN_CHUNK = 8 * 1024
const AVG_CHUNK = 16 * 1024
const MAX_CHUNK = 32 * 1024
const MASK64 = (1n << 64n) - 1n
const SHIFT = 55n
const HASH_MASK = BigInt(AVG_CHUNK - 1)

const BLAKE2B_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
]
const BLAKE2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]

function rotateRight(value: bigint, bits: bigint) {
  return ((value >> bits) | (value << (64n - bits))) & MASK64
}

function readUInt64LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true)
}

function blake2bCompress(state: bigint[], block: Uint8Array, counter: bigint, last: boolean) {
  const message = new Array<bigint>(16)
  for (let i = 0; i < 16; i++) message[i] = readUInt64LE(block, i * 8)
  const v = [...state, ...BLAKE2B_IV]
  v[12] ^= counter & MASK64
  v[13] ^= (counter >> 64n) & MASK64
  if (last) v[14] ^= MASK64
  const mix = (a: number, b: number, c: number, d: number, x: bigint, y: bigint) => {
    v[a] = (v[a] + v[b] + x) & MASK64
    v[d] = rotateRight(v[d] ^ v[a], 32n)
    v[c] = (v[c] + v[d]) & MASK64
    v[b] = rotateRight(v[b] ^ v[c], 24n)
    v[a] = (v[a] + v[b] + y) & MASK64
    v[d] = rotateRight(v[d] ^ v[a], 16n)
    v[c] = (v[c] + v[d]) & MASK64
    v[b] = rotateRight(v[b] ^ v[c], 63n)
  }
  // BLAKE2b — 12 раундов, таблица SIGMA из 10 строк повторяется по кругу.
  for (let round = 0; round < 12; round++) {
    const sigma = BLAKE2B_SIGMA[round % 10]
    mix(0, 4, 8, 12, message[sigma[0]], message[sigma[1]])
    mix(1, 5, 9, 13, message[sigma[2]], message[sigma[3]])
    mix(2, 6, 10, 14, message[sigma[4]], message[sigma[5]])
    mix(3, 7, 11, 15, message[sigma[6]], message[sigma[7]])
    mix(0, 5, 10, 15, message[sigma[8]], message[sigma[9]])
    mix(1, 6, 11, 12, message[sigma[10]], message[sigma[11]])
    mix(2, 7, 8, 13, message[sigma[12]], message[sigma[13]])
    mix(3, 4, 9, 14, message[sigma[14]], message[sigma[15]])
  }
  for (let i = 0; i < 8; i++) state[i] ^= v[i] ^ v[i + 8]
}

/** BLAKE2b с произвольной длиной дайджеста (нужны 18 байт, как в app-builder). */
export function blake2b(data: Uint8Array, digestLength: number): Uint8Array {
  if (digestLength < 1 || digestLength > 64) throw new Error("Invalid BLAKE2b digest length")
  const state = [...BLAKE2B_IV]
  state[0] ^= 0x01010000n ^ BigInt(digestLength)
  let counter = 0n
  let offset = 0
  while (data.length - offset > 128) {
    counter += 128n
    blake2bCompress(state, data.subarray(offset, offset + 128), counter, false)
    offset += 128
  }
  const tail = data.subarray(offset)
  const block = new Uint8Array(128)
  block.set(tail)
  counter += BigInt(tail.length)
  blake2bCompress(state, block, counter, true)
  const digest = new Uint8Array(64)
  const view = new DataView(digest.buffer)
  for (let i = 0; i < 8; i++) view.setBigUint64(i * 8, state[i], true)
  return digest.subarray(0, digestLength)
}

function polynomialDegree(value: bigint) {
  return value === 0n ? -1 : value.toString(2).length - 1
}

function polynomialMod(value: bigint, polynomial: bigint) {
  let rest = value
  const divisorDegree = polynomialDegree(polynomial)
  while (polynomialDegree(rest) >= divisorDegree) rest ^= polynomial << BigInt(polynomialDegree(rest) - divisorDegree)
  return rest
}

const pushTable = new Array<bigint>(256)
const popTable = new Array<bigint>(256)
for (let byte = 0; byte < 256; byte++) {
  const shifted = BigInt(byte) << BigInt(DEGREE)
  pushTable[byte] = (shifted ^ polynomialMod(shifted, POLYNOMIAL)) & MASK64
  popTable[byte] = polynomialMod(BigInt(byte) << BigInt((WINDOW - 1) * 8), POLYNOMIAL)
}

function rabinUpdate(hash: bigint, data: Uint8Array, start: number, end: number) {
  let value = hash
  for (let i = start; i < end; i++) {
    const top = Number((value >> SHIFT) & 0xffn)
    value = (((value << 8n) | BigInt(data[i])) & MASK64) ^ pushTable[top]
  }
  return value
}

/**
 * Границы блоков: content-defined chunking из aclements/go-rabin, который
 * использует app-builder. Единственное отличие от «учебной» версии — завершающий
 * блок длины 0, когда файл кончается ровно на границе блока: app-builder его пишет.
 */
export function blockSizes(data: Uint8Array): number[] {
  const total = data.length
  const sizes: number[] = []
  let start = 0
  while (start < total) {
    const remaining = total - start
    if (remaining < MIN_CHUNK || start + MIN_CHUNK > total) {
      sizes.push(remaining)
      break
    }
    let head = start + (MIN_CHUNK - WINDOW)
    let hash = rabinUpdate(0n, data, head, head + WINDOW)
    const limit = start + MAX_CHUNK - WINDOW
    let truncatedByEnd = false
    while ((hash & HASH_MASK) !== HASH_MASK && head < limit) {
      if (head + WINDOW >= total) {
        truncatedByEnd = true
        break
      }
      const outgoing = data[head]
      const incoming = data[head + WINDOW]
      head++
      hash ^= popTable[outgoing]
      const top = Number((hash >> SHIFT) & 0xffn)
      hash = (((hash << 8n) | BigInt(incoming)) & MASK64) ^ pushTable[top]
    }
    head += WINDOW
    sizes.push(head - start)
    start = head
    if (start === total && !truncatedByEnd) sizes.push(0)
  }
  return sizes
}

/** Карта блоков v2 в том же виде, что пишет electron-builder: gzip(JSON). */
export function blockMapBytes(data: Uint8Array): Buffer {
  const sizes = blockSizes(data)
  const checksums: string[] = []
  let offset = 0
  for (const size of sizes) {
    checksums.push(Buffer.from(blake2b(data.subarray(offset, offset + size), 18)).toString("base64"))
    offset += size
  }
  const document = { version: "2", files: [{ name: "file", offset: 0, checksums, sizes }] }
  // Заголовок gzip без mtime (Node и Bun пишут 0), поэтому повторная сборка
  // того же файла даёт тот же blockmap байт-в-байт.
  return gzipSync(JSON.stringify(document), { level: 9 })
}

export function sha512Base64(bytes: Uint8Array) {
  return createHash("sha512").update(bytes).digest("base64")
}

export type ReleaseArtifact = { name: string; size: number; sha512: string; blockMapSize?: number }

/** Пишет `<file>.blockmap` и возвращает описание артефакта для latest*.yml. */
export function writeBlockMap(file: string): ReleaseArtifact {
  const data = readFileSync(file)
  const map = blockMapBytes(data)
  writeFileSync(file + ".blockmap", map)
  return { name: path.basename(file), size: data.length, sha512: sha512Base64(data), blockMapSize: map.length }
}

/** Описание артефакта без карты блоков (deb/rpm/pacman и прочее). */
export function describeArtifact(file: string): ReleaseArtifact {
  const data = readFileSync(file)
  return { name: path.basename(file), size: data.length, sha512: sha512Base64(data) }
}

const LATEST_FILE: Record<"win" | "mac" | "linux", string> = {
  win: "latest.yml",
  mac: "latest-mac.yml",
  linux: "latest-linux.yml",
}

/**
 * `latest*.yml` в формате electron-updater: version, files[] и path/sha512
 * предпочтительного артефакта. Пишем ровно те поля, что и electron-builder.
 */
export function writeLatestFile(directory: string, platform: "win" | "mac" | "linux", version: string, artifacts: ReleaseArtifact[], primary: string) {
  const preferred = artifacts.find(artifact => artifact.name === primary)
  if (!preferred) throw new Error("Primary artifact is missing from latest file: " + primary)
  const lines = ["version: " + version, "files:"]
  for (const artifact of artifacts) {
    lines.push("  - url: " + artifact.name, "    sha512: " + artifact.sha512, "    size: " + artifact.size)
    if (artifact.blockMapSize !== undefined) lines.push("    blockMapSize: " + artifact.blockMapSize)
  }
  lines.push("path: " + preferred.name, "sha512: " + preferred.sha512, "releaseDate: '" + new Date().toISOString() + "'")
  writeFileSync(path.join(directory, LATEST_FILE[platform]), lines.join("\n") + "\n")
  return LATEST_FILE[platform]
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  if (command === "blockmap") {
    if (!rest.length) throw new Error("Usage: release-metadata.ts blockmap <file...>")
    for (const file of rest) {
      const artifact = writeBlockMap(file)
      console.log("blockmap: " + artifact.name + " (" + artifact.blockMapSize + " bytes, " + artifact.size + " bytes mapped)")
    }
  } else if (command === "latest") {
    const [platform, directory, version, primary, ...names] = rest
    if (platform !== "win" && platform !== "mac" && platform !== "linux") throw new Error("Unknown latest platform: " + platform)
    if (!directory || !version || !primary) throw new Error("Usage: release-metadata.ts latest <win|mac|linux> <dir> <version> <primary> [file...]")
    const root = path.resolve(directory)
    // electron-builder кладёт .blockmap только рядом с установщиком, zip/dmg и
    // AppImage: у deb/rpm/pacman дифференциальных патчей нет.
    const artifacts = (names.length ? names : [primary]).map(name => {
      const file = path.join(root, name)
      const withBlockMap = platform !== "linux" || name.endsWith(".AppImage")
      if (!withBlockMap) return describeArtifact(file)
      const mapFile = file + ".blockmap"
      if (existsSync(mapFile)) {
        const data = readFileSync(file)
        return { name, size: data.length, sha512: sha512Base64(data), blockMapSize: statSync(mapFile).size }
      }
      return writeBlockMap(file)
    })
    const written = writeLatestFile(root, platform, version, artifacts, primary)
    console.log("latest metadata: " + written)
  } else {
    throw new Error("Usage: release-metadata.ts <blockmap|latest> ...")
  }
}
