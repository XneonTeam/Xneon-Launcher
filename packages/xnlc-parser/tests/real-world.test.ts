import { expect, test } from "bun:test"
import { analyze, ArchiveContext, curseforgeFingerprint, curseforgeFingerprintFile, forgeModAnnotations, scanArchiveClasses, sha1 } from "../src"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectArchive } from "../src"

// Сеть включается явно: хеш фиксирует вход и не зависит от последнего релиза.
const live = process.env.XNLC_PARSER_LIVE_TESTS === "1" ? test : test.skip
const cases = [
  { hash: "8c147ef2606e01778a61cacb447861e1d9b1f0fe", loader: "fabric", id: "fabric-api", version: "0.166.2+26.4" },
  { hash: "a9a7fbcb6715e3d68c91b4fe566af508f2f2c282", loader: "forge", id: "jei", version: "4.24.0.1042" },
  { hash: "1ae408badfe8b57417f465a06fc4d03215dba993", loader: "forge", id: "jei", version: "15.74.0.234" },
  { hash: "7b482e84affac21875d5f04ac71f481e8c7e5850", loader: "neoforge", id: "jei", version: "31.17.0.113" },
  { hash: "fa2868388b175e32e4d3310a5bf065593837bc5c", loader: "quilt", id: "quilted_fabric_api", version: "7.7.0+0.92.2-1.20.1" },
] as const

live("CurseForge fingerprint совпадает с независимым тестовым вектором Aternos", async () => {
  // Точный исходник и ожидаемое значение зафиксированы в тесте upstream.
  const url = "https://raw.githubusercontent.com/aternosorg/php-curseforge-api/25b57ad1ee35b554c44ed0ae0f43d460b28124c1/tests/Unit/Client/Fixtures/test.txt"
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(curseforgeFingerprint(bytes)).toBe(3069266640)
  const dir = await mkdtemp(join(tmpdir(), "xnlc-reference-"))
  try {
    const path = join(dir, "reference.bin")
    await writeFile(path, bytes)
    expect(await curseforgeFingerprintFile(path)).toBe(3069266640)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)

live("внешний LiteLoader fixture: metadata и SHA-1", async () => {
  const url = "https://raw.githubusercontent.com/Voxelum/x-minecraft-launcher/cca4b9a905664e2942e62f3a1b4cf341a82de966/mock/mods/sample-mod.litemod"
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(sha1(bytes)).toBe("9dbd2d690ba2dd7c60469124f3bc1bae972c33ef")
  const result = await analyze(bytes)
  expect(result.formats).toContain("liteloader")
  expect(result.mods[0]).toMatchObject({ name: "ArmorsHUDRevived", version: "1.2.0", authors: ["Shadow_Hawk"], minecraftVersions: ["1.12.r2"] })
}, 30000)

for (const item of cases) live(`реальный ${item.loader}: metadata и SHA-1`, async () => {
  const response = await fetch(`https://api.modrinth.com/v2/version_file/${item.hash}`, { headers: { "User-Agent": "XneonLauncher-parser-tests/0.1" } })
  expect(response.ok).toBe(true)
  const version = await response.json() as { files: { url: string; hashes: { sha1: string } }[] }
  const file = version.files.find(f => f.hashes.sha1 === item.hash)
  expect(file).toBeDefined()
  const download = await fetch(file!.url)
  expect(download.ok).toBe(true)
  const data = new Uint8Array(await download.arrayBuffer())
  expect(sha1(data)).toBe(item.hash)
  const result = await analyze(data, { nested: item.loader === "quilt", limits: { maxNestedArchives: 128 } })
  expect(result.mods).toContainEqual(expect.objectContaining({ loader: item.loader, id: item.id, version: item.version }))
  expect(result.diagnostics).toEqual([])
  if (item.hash === "a9a7fbcb6715e3d68c91b4fe566af508f2f2c282") {
    const archive = await ArchiveContext.open(data)
    try {
      const classes = await scanArchiveClasses(archive)
      expect(classes.complete).toBe(true)
      expect(classes.classes.length).toBeGreaterThan(100)
      expect(classes.classes.flatMap(forgeModAnnotations).some(annotation => annotation.values.modid === "jei")).toBe(true)
    } finally { archive.close() }
  }
  const inspection = await inspectArchive(data, { metadata: true, dependencies: true, loaderRequirements: true })
  if (item.loader === "fabric" || item.loader === "quilt") expect(inspection.dependencies?.modId).toBe(item.id)
  if (item.loader === "quilt") {
    expect(result.embeddedJars.length).toBe(87)
    expect(result.embeddedJars.every(jar => jar.result)).toBe(true)
  }
}, 60000)

live("реальный Paper-плагин: YAML metadata и SHA-1", async () => {
  const hash = "b9b1a547cade490d1f8ddd2246c7ec8f4204a3f6"
  const response = await fetch(`https://api.modrinth.com/v2/version_file/${hash}`, { headers: { "User-Agent": "XneonLauncher-parser-tests/0.1" } })
  expect(response.ok).toBe(true)
  const version = await response.json() as { files: { url: string; hashes: { sha1: string } }[] }
  const file = version.files.find(f => f.hashes.sha1 === hash)
  expect(file).toBeDefined()
  const download = await fetch(file!.url)
  expect(download.ok).toBe(true)
  const data = new Uint8Array(await download.arrayBuffer())
  expect(sha1(data)).toBe(hash)
  const result = await analyze(data)
  expect(result.mods).toContainEqual(expect.objectContaining({ loader: "paper", name: "Veinminer", version: "2.13.1" }))
  expect(result.diagnostics).toEqual([])
}, 60000)

for (const item of [
  { hash: "96932a034fff4cd0cad08ba12db730450c4772da", format: "resourcepack" },
  { hash: "838139b54cddb56b2e83cd260d8efd960ac536d6", format: "shaderpack" },
] as const) live(`реальный ${item.format}: обнаружение и SHA-1`, async () => {
  const response = await fetch(`https://api.modrinth.com/v2/version_file/${item.hash}`, { headers: { "User-Agent": "XneonLauncher-parser-tests/0.1" } })
  expect(response.ok).toBe(true)
  const version = await response.json() as { files: { url: string; hashes: { sha1: string } }[] }
  const file = version.files.find(f => f.hashes.sha1 === item.hash)
  expect(file).toBeDefined()
  const download = await fetch(file!.url)
  expect(download.ok).toBe(true)
  const bytes = new Uint8Array(await download.arrayBuffer())
  expect(sha1(bytes)).toBe(item.hash)
  const result = await analyze(bytes)
  expect(result.formats).toContain(item.format)
  if (item.format === "resourcepack") expect(result.mods).toContainEqual(expect.objectContaining({ loader: "resourcepack", version: "15", iconPath: "pack.png" }))
  expect(result.diagnostics).toEqual([])
}, 60000)

