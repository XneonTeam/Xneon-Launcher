import { expect, test } from "bun:test"
import { analyze, curseforgeFingerprint, sha1 } from "../src"

const live = process.env.XNLC_PARSER_LIVE_TESTS === "1" ? test : test.skip
const cases = [
  { hash: "8c147ef2606e01778a61cacb447861e1d9b1f0fe", loader: "fabric", id: "fabric-api", version: "0.166.2+26.4" },
  { hash: "a9a7fbcb6715e3d68c91b4fe566af508f2f2c282", loader: "forge", id: "jei", version: "4.24.0.1042" },
  { hash: "1ae408badfe8b57417f465a06fc4d03215dba993", loader: "forge", id: "jei", version: "15.74.0.234" },
  { hash: "7b482e84affac21875d5f04ac71f481e8c7e5850", loader: "neoforge", id: "jei", version: "31.17.0.113" },
  { hash: "fa2868388b175e32e4d3310a5bf065593837bc5c", loader: "quilt", id: "quilted_fabric_api", version: "7.7.0+0.92.2-1.20.1" },
] as const
for (const item of cases) live(`реальный ${item.loader}: SHA-1 и metadata`, async () => {
  const response = await fetch(`https://api.modrinth.com/v2/version_file/${item.hash}`, { headers: { "User-Agent": "XneonLauncher-parser-tests/0.1" } })
  expect(response.ok).toBe(true)
  const version = await response.json() as { files: { url: string; hashes: { sha1: string } }[] }
  const file = version.files.find(entry => entry.hashes.sha1 === item.hash)
  expect(file).toBeDefined()
  const download = await fetch(file!.url)
  expect(download.ok).toBe(true)
  const bytes = new Uint8Array(await download.arrayBuffer())
  expect(sha1(bytes)).toBe(item.hash)
  const result = await analyze(bytes, { nested: item.loader === "quilt", limits: { maxNestedArchives: 128 } })
  expect(result.mods).toContainEqual(expect.objectContaining({ loader: item.loader, id: item.id, version: item.version }))
  expect(result.diagnostics).toEqual([])
  if (item.loader === "quilt") expect(result.embeddedJars.length).toBe(87)
}, 60000)

for (const item of [
  { hash: "96932a034fff4cd0cad08ba12db730450c4772da", format: "resourcepack" },
  { hash: "838139b54cddb56b2e83cd260d8efd960ac536d6", format: "shaderpack" },
] as const) live(`реальный ${item.format}`, async () => {
  const response = await fetch(`https://api.modrinth.com/v2/version_file/${item.hash}`, { headers: { "User-Agent": "XneonLauncher-parser-tests/0.1" } })
  expect(response.ok).toBe(true)
  const version = await response.json() as { files: { url: string; hashes: { sha1: string } }[] }
  const file = version.files.find(entry => entry.hashes.sha1 === item.hash)
  expect(file).toBeDefined()
  const download = await fetch(file!.url)
  expect(download.ok).toBe(true)
  const bytes = new Uint8Array(await download.arrayBuffer())
  expect(sha1(bytes)).toBe(item.hash)
  expect((await analyze(bytes)).formats).toContain(item.format)
}, 60000)

live("независимый вектор fingerprint Aternos", async () => {
  const response = await fetch("https://raw.githubusercontent.com/aternosorg/php-curseforge-api/25b57ad1ee35b554c44ed0ae0f43d460b28124c1/tests/Unit/Client/Fixtures/test.txt")
  expect(response.ok).toBe(true)
  expect(curseforgeFingerprint(new Uint8Array(await response.arrayBuffer()))).toBe(3069266640)
}, 30000)

live("зафиксированный внешний LiteLoader fixture", async () => {
  const response = await fetch("https://raw.githubusercontent.com/Voxelum/x-minecraft-launcher/cca4b9a905664e2942e62f3a1b4cf341a82de966/mock/mods/sample-mod.litemod")
  expect(response.ok).toBe(true)
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(sha1(bytes)).toBe("9dbd2d690ba2dd7c60469124f3bc1bae972c33ef")
  expect((await analyze(bytes)).mods).toContainEqual(expect.objectContaining({ loader: "liteloader", name: "ArmorsHUDRevived", version: "1.2.0" }))
}, 30000)

live("реальный Paper-плагин", async () => {
  const hash = "b9b1a547cade490d1f8ddd2246c7ec8f4204a3f6"
  const response = await fetch(`https://api.modrinth.com/v2/version_file/${hash}`, { headers: { "User-Agent": "XneonLauncher-parser-tests/0.1" } })
  expect(response.ok).toBe(true)
  const version = await response.json() as { files: { url: string; hashes: { sha1: string } }[] }
  const file = version.files.find(entry => entry.hashes.sha1 === hash)
  expect(file).toBeDefined()
  const download = await fetch(file!.url)
  expect(download.ok).toBe(true)
  const bytes = new Uint8Array(await download.arrayBuffer())
  expect(sha1(bytes)).toBe(hash)
  expect((await analyze(bytes)).mods).toContainEqual(expect.objectContaining({ loader: "paper", name: "Veinminer", version: "2.13.1" }))
}, 60000)
