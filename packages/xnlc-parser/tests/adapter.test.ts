import { expect, test } from "bun:test"
import TestZip from "../../../tests/helpers/zip"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectArchive, inspectJar } from "../src"
import { readContentMetadataFromPath } from "../../../electrobun/main/builds/metadata"
import { readModrinthPackContents } from "../../../electrobun/main/mods-pack-contents"

test("XNLC извлекает иконку шейдера из ZIP и из папки", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-shader-"))
  try {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=="
    const bytes = Buffer.from(png, "base64")
    const zip = new TestZip()
    zip.addFile("shaders/shaders.png", bytes)
    await mkdir(join(dir, "shaders"))
    await writeFile(join(dir, "shaders", "shaders.png"), bytes)
    const expected = `data:image/png;base64,${png}`
    expect((await inspectArchive(zip.toBuffer(), { metadata: true })).metadata?.icon_url).toBe(expected)
    expect((await readContentMetadataFromPath(dir)).icon_url).toBe(expected)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("metadata, зависимости и требования Fabric сохраняют контракт", async () => {
  const zip = new TestZip()
  zip.addFile("fabric.mod.json", Buffer.from(JSON.stringify({ id: "demo", name: "Demo", version: "1", depends: { fabricloader: ">=0.15" } })))
  const result = await inspectArchive(zip.toBuffer(), { metadata: true, dependencies: true, loaderRequirements: true })
  expect(result.metadata).toMatchObject({ name: "Demo", version: "1" })
  expect(result.dependencies).toEqual({ modId: "demo", declared: [{ modId: "fabricloader", versionRange: ">=0.15" }] })
  expect(result.loaderRequirements?.requirements).toEqual([{ loaderId: "fabric", requirement: ">=0.15" }])
})

test("приоритет NeoForge, ресурспак и частичный результат", async () => {
  const zip = new TestZip()
  zip.addFile("fabric.mod.json", Buffer.from('{"id":"fabric","name":"Fabric"}'))
  zip.addFile("META-INF/neoforge.mods.toml", Buffer.from('[[mods]]\nmodId="neo"\ndisplayName="Neo"\nversion="1"\n'))
  expect((await inspectArchive(zip.toBuffer(), { metadata: true })).metadata?.name).toBe("Neo")
  const pack = new TestZip()
  pack.addFile("pack.mcmeta", Buffer.from('{"pack":{"pack_format":15,"description":{"text":"Pack"}}}'))
  expect((await inspectArchive(pack.toBuffer(), { metadata: true })).metadata).toMatchObject({ version: "15", description: "Pack" })
})

test("локальное чтение, хеши и повторное чтение после изменения файла", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-inspection-")), file = join(dir, "mod.jar")
  try {
    const make = (name: string) => { const zip = new TestZip(); zip.addFile("fabric.mod.json", Buffer.from(JSON.stringify({ id: "demo", name }))); return zip.toBuffer() }
    const bytes = make("First")
    await writeFile(file, bytes)
    const result = await inspectJar(file, { metadata: true, sha1: true, curseforgeFingerprint: true })
    expect(result.metadata?.name).toBe("First")
    expect(result.sha1).toBe(new Bun.CryptoHasher("sha1").update(bytes).digest("hex"))
    expect(typeof result.curseforgeFingerprint).toBe("number")
    expect((await readContentMetadataFromPath(file)).name).toBe("First")
    await writeFile(file, make("Second name"))
    expect((await inspectJar(file, { metadata: true })).metadata?.name).toBe("Second name")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("индекс Modrinth читается через XNLC и сохраняет идентификаторы", async () => {
  const zip = new TestZip(), hash = "a".repeat(40)
  zip.addFile("modrinth.index.json", Buffer.from(JSON.stringify({ game: "minecraft", dependencies: { minecraft: "1.21" }, files: [{ path: "mods/demo.jar", hashes: { sha1: hash } }] })))
  const data = zip.toBuffer(), previousFetch = globalThis.fetch
  const mods = {
    modrinthGetDetails: async () => ({ id: "pack", name: "Pack" }),
    modrinthGetVersions: async () => [{ id: "version", files: [{ filename: "pack.mrpack", url: "https://cdn.modrinth.com/pack.mrpack", size: data.length }] }],
    modrinthGetFilesByHash: async () => ({ [hash]: { projectId: "demo" } }),
  }
  try {
    globalThis.fetch = (async () => new Response(data)) as typeof fetch
    const result = await readModrinthPackContents(mods as never, "pack", "version")
    expect(result.dependencies.minecraft).toBe("1.21")
    expect(result.files[0]).toMatchObject({ path: "mods/demo.jar", sha1: hash, projectId: "demo" })
  } finally { globalThis.fetch = previousFetch }
})

test("повреждённый JAR возвращает диагностику XNLC и сохраняет хеш", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-broken-"))
  try {
    const file = join(dir, "broken.jar")
    await writeFile(file, "not a zip")
    const result = await inspectJar(file, { metadata: true, sha1: true })
    expect(result.sha1).toMatch(/^[a-f0-9]{40}$/)
    expect(result.metadata).toBeUndefined()
    expect(result.diagnostics).toMatchObject([{ code: "INVALID_ARCHIVE" }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
