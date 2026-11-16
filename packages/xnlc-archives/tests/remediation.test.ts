import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import { ArchiveContext } from "../../xnlc-parser/src/archive"
import { analyzeServerJar } from "../../xnlc-servers/src/jar-analyzer"
import { inspectExternalObject } from "../../xnlc-share/src/object-policy"
import { extractArchive, packArchiveBuffer, packArchiveSync, packDirectory } from "../src/index"

test("замена файла атомарна при отмене и ошибке CRC", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-atomic-"))
  try {
    const target = path.join(root, "existing")
    await writeFile(target, "user data")
    const bytes = packArchiveSync({ existing: Buffer.alloc(8 << 20, 42) })
    const controller = new AbortController()
    const extraction = extractArchive(bytes, root, {
      signal: controller.signal,
      include: () => { setTimeout(() => controller.abort(), 5); return true },
    })
    await expect(extraction).rejects.toMatchObject({ code: "ABORTED" })
    expect(await readFile(target, "utf8")).toBe("user data")
    const central = bytes.readUInt32LE(bytes.length - 6)
    bytes[central + 16] ^= 1
    await expect(extractArchive(bytes, root)).rejects.toMatchObject({ code: "INVALID_ARCHIVE" })
    expect(await readdir(root)).toEqual(["existing"])
    expect(await readFile(target, "utf8")).toBe("user data")
    const occupied = path.join(root, "occupied")
    await mkdir(occupied)
    await writeFile(path.join(occupied, "user.txt"), "untouched")
    await expect(extractArchive(packArchiveSync({ occupied: Buffer.from("new") }), root)).rejects.toMatchObject({ code: "IO_ERROR" })
    expect((await readdir(root)).sort()).toEqual(["existing", "occupied"])
    expect(await readFile(path.join(occupied, "user.txt"), "utf8")).toBe("untouched")
    await extractArchive(packArchiveSync({ existing: Buffer.from("new") }), root)
    expect(await readFile(target, "utf8")).toBe("new")
    await expect(extractArchive(bytes, root, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "ABORTED" })
    expect(await readFile(target, "utf8")).toBe("new")
    const race = path.join(root, "race")
    const contenders = await Promise.allSettled(["first", "second"].map(value =>
      extractArchive(packArchiveSync({ "nested/value": Buffer.from(value) }), race, { overwrite: false })))
    expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(await readdir(path.join(race, "nested"))).toEqual(["value"])
    expect(["first", "second"]).toContain(await readFile(path.join(race, "nested", "value"), "utf8"))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("пустые вложенные папки и DOS mtime проходят round-trip", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-mtime-"))
  try {
    const source = path.join(root, "src")
    const empty = path.join(source, "empty", "nested")
    await mkdir(empty, { recursive: true })
    const target = path.join(source, "file")
    const mtime = new Date(2024, 6, 2, 12, 30, 4)
    await writeFile(target, "content")
    await utimes(target, mtime, mtime)
    await utimes(empty, mtime, mtime)
    const archive = path.join(root, "archive.zip")
    await packDirectory(source, archive)
    const output = path.join(root, "output")
    await extractArchive(archive, output)
    expect(await readdir(path.join(output, "empty", "nested"))).toEqual([])
    expect((await stat(path.join(output, "empty", "nested"))).mtimeMs).toBe(+mtime)
    expect((await stat(path.join(output, "file"))).mtimeMs).toBe(+mtime)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("ZIP64 на границе 65535 читается xnlc-parser", async () => {
  const bytes = await packArchiveBuffer(Array.from({ length: 65535 }, (_, i) => ({
    kind: "data", entryName: i === 0 ? "пусто/вложенная/" : i === 65534 ? "item/последний" : `item/${i}`, data: i === 65534 ? Buffer.from("last") : Buffer.alloc(0),
  })), { level: 0 })
  const archive = await ArchiveContext.open(bytes)
  try {
    expect(archive.entries()).toHaveLength(65535)
    expect(archive.get("пусто/вложенная/")?.size).toBe(0)
    expect(Buffer.from(await archive.read("item/последний")).toString()).toBe("last")
  } finally { archive.close() }
}, 30_000)

test("ZIP отклоняет коллизии имён и traversal", async () => {
  const data = Buffer.from("value")
  await expect(packArchiveBuffer([
    { kind: "data", entryName: "./mods\\file.jar", data },
    { kind: "data", entryName: "mods//FILE.jar", data },
  ])).rejects.toMatchObject({ code: "INVALID_ARCHIVE" })
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-traversal-"))
  try {
    await expect(extractArchive(zipSync({ "../escaped": data }), root)).rejects.toMatchObject({ code: "UNSAFE_ENTRY" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("JAR с 33 посторонними JSON читает манифест и NeoForge без распаковки ресурсов", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-jar-meta-"))
  try {
    const jar = path.join(root, "server.jar")
    const filler = Buffer.alloc(1 << 20, 32)
    const data = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`assets/${i}.json`, filler]))
    data["META-INF/MANIFEST.MF"] = Buffer.from("Main-Class: example.Main\r\n")
    data["META-INF/neoforge.mods.toml"] = Buffer.from('[[mods]]\nmodId="example"\n[[dependencies.example]]\nmodId="minecraft"\nversionRange="[1.21.1,)"')
    await writeFile(jar, packArchiveSync(data))
    expect(await analyzeServerJar(jar)).toMatchObject({ minecraftVersion: "1.21.1", loaderId: "neoforge", mainClass: "example.Main" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("Share проверяет 1500 записей и обнаруживает вложенный исполняемый файл", async () => {
  const files = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`assets/${i}.json`, Buffer.from("{}")]))
  await inspectExternalObject(packArchiveSync(files))
  files["nested.zip"] = packArchiveSync({ "payload.dat": Buffer.from("MZ") })
  await expect(inspectExternalObject(packArchiveSync(files))).rejects.toMatchObject({ code: "FILE_POLICY" })
})

test("распаковка ограничивает коэффициент сжатия и заявленный размер", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-zip-limit-"))
  try {
    const bytes = packArchiveSync({ data: Buffer.alloc(17 * 1024 * 1024) })
    await expect(extractArchive(bytes, root, { maxCompressionRatio: 100 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    await expect(extractArchive(bytes, root, { maxEntrySize: 1 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
    expect(await readdir(root)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
// Фикстура Python zipfile: неseekable output, force_zip64=True для маленькой записи.
test("Parser читает 64-битный локальный descriptor Python при 32-битном каталоге", async () => {
  const bytes = Buffer.from("UEsDBC0ACAgIAAAAIQAAAAAA//////////8SABQAbW9kcy/RgtC10YHRgi5qc29uAQAQAAAAAAAAAAAAAAAAAAAAAACrVirOLy1KTlWyUiqoLMnIz1OqBQBQSwcI5FJJpBUAAAAAAAAAEwAAAAAAAABQSwMEFAAIAAgAzLhuXQAAAAAAAAAAAAAAAA0AAABlbXB0eS9uZXN0ZWQvAwBQSwcIAAAAAAIAAAAAAAAAUEsBAi0DLQAICAgAAAAhAORSSaQVAAAAEwAAABIAAAAAAAAAAAAAAIABAAAAAG1vZHMv0YLQtdGB0YIuanNvblBLAQIUAxQACAAIAMy4bl0AAAAAAgAAAAAAAAANAAAAAAAAAAAAEAD9QXEAAABlbXB0eS9uZXN0ZWQvUEsFBgAAAAACAAIAewAAAK4AAAAAAA==", "base64")
  const archive = await ArchiveContext.open(bytes)
  try {
    expect(Buffer.from(await archive.read("mods/тест.json")).toString()).toBe('{"source":"python"}')
    expect(archive.get("empty/nested/")?.size).toBe(0)
  } finally { archive.close() }
})
