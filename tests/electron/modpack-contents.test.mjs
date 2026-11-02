import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"

const require = createRequire(import.meta.url)
const AdmZip = require("adm-zip")
const { readModrinthPackContents } = require("../../dist-electron/main/mods-pack-contents.js")

test("чтение состава сборки без установки", async t => {
  const zip = new AdmZip()
  const sha1 = "a".repeat(40)
  zip.addFile("modrinth.index.json", Buffer.from(JSON.stringify({ game: "minecraft", dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.0" }, files: [
    { path: "mods/example.jar", hashes: { sha1 }, env: { client: "required", server: "unsupported" } },
    { path: "resourcepacks/example.zip", hashes: {} },
  ] })))
  const archive = zip.toBuffer()
  let file = { filename: "test.mrpack", url: "https://cdn.modrinth.com/data/test.mrpack", size: archive.length, hashes: { sha512: createHash("sha512").update(archive).digest("hex") } }
  const mods = {
    modrinthGetDetails: async () => ({ id: "pack", name: "Test pack" }),
    modrinthGetVersions: async () => [{ id: "version", files: [file] }],
    modrinthGetFilesByHash: async hashes => { assert.deepEqual(hashes, [sha1]); return { [sha1]: { projectId: "mod", versionId: "mod-version" } } },
  }
  const originalFetch = globalThis.fetch
  let downloads = 0
  globalThis.fetch = async () => { downloads++; return new Response(archive) }
  try {
    await t.test("полный список сохраняет ID, окружение и неразрешённые файлы", async () => {
      const result = await readModrinthPackContents(mods, "pack", "version")
      assert.equal(result.totalFiles, 2)
      assert.equal(result.dependencies.minecraft, "1.21.1")
      assert.equal(result.files[0].projectId, "mod")
      assert.equal(result.files[0].versionId, "mod-version")
      assert.equal(result.files[0].environment.server, "unsupported")
      assert.equal(result.files[1].path, "resourcepacks/example.zip")
      assert.equal(result.files[1].projectId, undefined)
    })
    await t.test("не подменяет отсутствующую версию другой", async () => {
      const before = downloads
      await assert.rejects(readModrinthPackContents(mods, "pack", "missing"), /archive not found/)
      assert.equal(downloads, before)
    })
    await t.test("не загружает архив с постороннего хоста", async () => {
      const before = downloads
      file = { ...file, url: "https://example.com/test.mrpack" }
      await assert.rejects(readModrinthPackContents(mods, "pack", "version"), /archive host/)
      assert.equal(downloads, before)
      file = { ...file, url: "https://cdn.modrinth.com/data/test.mrpack" }
    })
    await t.test("проверяет целостность до чтения индекса", async () => {
      file = { ...file, hashes: { sha512: "0".repeat(128) } }
      await assert.rejects(readModrinthPackContents(mods, "pack", "version"), /hash mismatch/)
    })
    await t.test("отклоняет слишком большой архив до загрузки", async () => {
      const before = downloads
      file = { ...file, size: 33 * 1024 * 1024 }
      await assert.rejects(readModrinthPackContents(mods, "pack", "version"), /too large/)
      assert.equal(downloads, before)
    })
  } finally { globalThis.fetch = originalFetch }
})
