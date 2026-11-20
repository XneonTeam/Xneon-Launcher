import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile, lstat, readdir, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { inspectUnixUpdateTar, extractUnixUpdateArchive } from "../../electrobun/main/unix-update-archive"

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
const root = "XneonLauncher"
const valid = () => tar([{ name: root, type: "5" }, { name: `${root}/bin/bun`, data: "executable" }, { name: `${root}/bin/bun Helper`, type: "2", link: "bun" }])
test("tar принимает обычные файлы и внутренние SDK symlinks", () => {
  const entries = inspectUnixUpdateTar(valid(), root)
  expect(entries.map(entry => entry.name)).toEqual([root, `${root}/bin/bun`, `${root}/bin/bun Helper`])
})
for (const entries of [
  [{ name: "../escape", data: "x" }], [{ name: "/absolute", data: "x" }], [{ name: `${root}/a\\b`, data: "x" }],
  [{ name: `${root}/a`, type: "2", link: "/etc/passwd" }], [{ name: `${root}/a`, type: "2", link: "../../escape" }],
  [{ name: `${root}/a`, type: "1", link: "other" }], [{ name: `${root}/device`, type: "3" }],
  [{ name: `${root}/a`, data: "one" }, { name: `${root}/a`, data: "two" }],
  [{ name: `${root}/a`, type: "2", link: "." }, { name: `${root}/a/escape`, data: "x" }],
  [{ name: `${root}/deep`, type: "2", link: "." }, { name: `${root}/a`, type: "2", link: "deep/../escape" }],
  [{ name: `${root}/a`, type: "2", link: "b" }, { name: `${root}/b`, type: "2", link: "a" }],
] as Entry[][]) test(`tar отвергает опасную структуру: ${JSON.stringify(entries)}`, () => {
  expect(() => inspectUnixUpdateTar(tar(entries), root)).toThrow()
})
test("повреждённый checksum и усечённый tar отвергаются", () => {
  const bytes = valid(); bytes[0] ^= 1
  expect(() => inspectUnixUpdateTar(bytes, root)).toThrow()
  expect(() => inspectUnixUpdateTar(valid().subarray(0, 800), root)).toThrow()
})
test("извлечение публикует только проверенный tar и сохраняет внутреннюю ссылку", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xneon-update-archive-"))
  try {
    const bytes = valid(), compressed = Buffer.from(Bun.zstdCompressSync(bytes))
    const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex")
    const artifact = { file: "fixture.tar.zst", format: "electrobun-tar-zstd" as const, downloadSize: compressed.length, downloadSha256: sha(compressed), tarSize: bytes.length, tarSha256: sha(bytes) }
    const source = path.join(directory, "archive.zst")
    await writeFile(source, compressed)
    const destination = path.join(directory, "stage")
    await extractUnixUpdateArchive(source, destination, root, artifact)
    expect((await lstat(path.join(destination, root, "bin/bun Helper"))).isSymbolicLink()).toBe(true)
    expect((await readFile(path.join(destination, root, "bin/bun"))).toString()).toBe("executable")
    await expect(extractUnixUpdateArchive(source, path.join(directory, "bad"), root, { ...artifact, tarSha256: "0".repeat(64) })).rejects.toThrow()
    expect((await readdir(directory)).includes("bad")).toBe(false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
