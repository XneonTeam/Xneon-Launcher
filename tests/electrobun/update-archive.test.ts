// Подписанный Unix-архив: разбор tar (path traversal, symlinks, checksum),
// потоковый Zstd и публикация staging-каталога только после проверок.
import { expect, test } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createZstdCompress } from "node:zlib"
import os from "node:os"
import path from "node:path"
import {
  assertZstdSize, decompressUnixUpdateArchive, extractUnixUpdateArchive, inspectUnixUpdateTar,
} from "../../electrobun/main/unix-update-archive"

const root = "XneonLauncher"
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex")

type Entry = { name: string; data?: string; type?: string; link?: string }
function tar(entries: Entry[]) {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "")
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100, "utf8"); header.write("0000755\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116)
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124)
    header.fill(32, 148, 156); header.write(entry.type ?? "0", 156); header.write(entry.link ?? "", 157, 100, "utf8"); header.write("ustar\0", 257)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148)
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)])
}
const bundle = () => tar([{ name: root, type: "5" }, { name: `${root}/bin/bun`, data: "executable" }, { name: `${root}/bin/bun Helper`, type: "2", link: "bun" }])

/** Реальный потоковый кадр: энкодер не знает итоговый размер и Content Size не пишет. */
async function streamingFrame(data: Buffer) {
  const stream = createZstdCompress()
  const chunks: Buffer[] = []
  stream.on("data", chunk => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => { stream.once("end", resolve); stream.once("error", reject) })
  for (let offset = 0; offset < data.length; offset += 64 * 1024) stream.write(data.subarray(offset, offset + 64 * 1024))
  stream.end()
  await done
  return Buffer.concat(chunks)
}

async function fixture(action: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xneon-update-archive-"))
  try { await action(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test("tar принимает обычные файлы и внутренние SDK symlinks", () => {
  expect(inspectUnixUpdateTar(bundle(), root).map(entry => entry.name)).toEqual([root, `${root}/bin/bun`, `${root}/bin/bun Helper`])
})

test("tar отвергает опасную структуру: выход за root, абсолютные/чужие ссылки, дубли и циклы", () => {
  for (const entries of [
    [{ name: "../escape", data: "x" }], [{ name: "/absolute", data: "x" }], [{ name: `${root}/a\\b`, data: "x" }],
    [{ name: `${root}/a`, type: "2", link: "/etc/passwd" }], [{ name: `${root}/a`, type: "2", link: "../../escape" }],
    [{ name: `${root}/a`, type: "1", link: "other" }], [{ name: `${root}/device`, type: "3" }],
    [{ name: `${root}/a`, data: "one" }, { name: `${root}/a`, data: "two" }],
    [{ name: `${root}/a`, type: "2", link: "." }, { name: `${root}/a/escape`, data: "x" }],
    [{ name: `${root}/deep`, type: "2", link: "." }, { name: `${root}/a`, type: "2", link: "deep/../escape" }],
    [{ name: `${root}/a`, type: "2", link: "b" }, { name: `${root}/b`, type: "2", link: "a" }],
  ] as Entry[][]) expect(() => inspectUnixUpdateTar(tar(entries), root), JSON.stringify(entries)).toThrow()
})

test("повреждённый checksum и усечённый tar отвергаются", () => {
  const bytes = bundle(); bytes[0] ^= 1
  expect(() => inspectUnixUpdateTar(bytes, root)).toThrow()
  expect(() => inspectUnixUpdateTar(bundle().subarray(0, 800), root)).toThrow()
})

test("объявленный Content Size сверяется с подписанным tarSize, потоковый кадр проверяется распаковкой", async () => {
  const data = bundle(), sized = Buffer.from(Bun.zstdCompressSync(data)), streamed = await streamingFrame(data)
  expect(sized[4] >> 6).not.toBe(0)
  expect(() => assertZstdSize(sized, data.length)).not.toThrow()
  expect(() => assertZstdSize(sized, data.length + 1)).toThrow(/content size differs/)
  expect(streamed[4] >> 6).toBe(0)
  expect(() => assertZstdSize(streamed, data.length)).not.toThrow()
  expect(await decompressUnixUpdateArchive(streamed, data.length)).toEqual(data)
})

test("потоковые кадры всех типов блоков и несколько кадров подряд дают ровно подписанный размер", async () => {
  const compressible = Buffer.alloc(400_000); for (let index = 0; index < compressible.length; index++) compressible[index] = (index * 31) % 251
  const payloads = [compressible, randomBytes(300_000), Buffer.alloc(300_000, 7)]
  for (const payload of payloads) expect(await decompressUnixUpdateArchive(await streamingFrame(payload), payload.length)).toEqual(payload)
  const repeated = payloads[2]
  const archive = Buffer.concat([Buffer.from(Bun.zstdCompressSync(compressible)), await streamingFrame(repeated)])
  expect(await decompressUnixUpdateArchive(archive, compressible.length + repeated.length)).toEqual(Buffer.concat([compressible, repeated]))
})

test("распакованный размер больше или меньше подписанного отвергается", async () => {
  const frame = await streamingFrame(Buffer.alloc(400_000, 7))
  await expect(decompressUnixUpdateArchive(frame, 400_000 - 1)).rejects.toThrow(/exceeds signed tar size/)
  await expect(decompressUnixUpdateArchive(frame, 400_000 + 1)).rejects.toThrow(/Update tar size mismatch/)
})

test("усечённый кадр, усечённый заголовок, мусор после кадра и пустой архив отвергаются", async () => {
  const frame = await streamingFrame(bundle()), size = bundle().length
  const cases: Array<[string, Buffer]> = [
    ["truncated frame", frame.subarray(0, frame.length - 12)],
    ["truncated header", frame.subarray(0, 7)],
    ["junk after frame", Buffer.concat([frame, Buffer.from("junk")])],
    ["empty", Buffer.alloc(0)],
  ]
  for (const [name, bytes] of cases) await expect(decompressUnixUpdateArchive(bytes, size), name).rejects.toThrow()
})

test("Zstd-словарь и неподдерживаемые флаги кадра отвергаются", async () => {
  const frame = await streamingFrame(bundle()), size = bundle().length
  const dictionary = Buffer.from(frame); dictionary[4] |= 1
  expect(() => assertZstdSize(dictionary, size)).toThrow(/dictionary/)
  const reserved = Buffer.from(frame); reserved[4] |= 8
  expect(() => assertZstdSize(reserved, size)).toThrow(/Unsupported Zstd frame flags/)
})

test("потоковый архив извлекается целиком, сохраняет внутреннюю ссылку и не публикует каталог при ошибке", () => fixture(async directory => {
  const data = bundle(), frame = await streamingFrame(data)
  const artifact = { file: "fixture.tar.zst", format: "electrobun-tar-zstd" as const, downloadSize: frame.length, downloadSha256: sha(frame), tarSize: data.length, tarSha256: sha(data) }
  const source = path.join(directory, "archive.zst")
  await writeFile(source, frame)
  const destination = path.join(directory, "stage")
  await extractUnixUpdateArchive(source, destination, root, artifact)
  expect((await lstat(path.join(destination, root, "bin/bun Helper"))).isSymbolicLink()).toBe(true)
  expect(await readFile(path.join(destination, root, "bin/bun"), "utf8")).toBe("executable")
  for (const [name, patch] of [
    ["неверный SHA-256 tar", { tarSha256: "0".repeat(64) }],
    ["неверный размер tar", { tarSize: data.length + 512 }],
  ] as const) {
    await expect(extractUnixUpdateArchive(source, path.join(directory, "bad"), root, { ...artifact, ...patch }), name).rejects.toThrow()
    expect((await readdir(directory)).includes("bad")).toBe(false)
  }
}))