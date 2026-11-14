import { expect, mock, test } from "bun:test"
import AdmZip from "adm-zip"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("датапаки одиночного мира: ZIP, папка, список и проверка установки", async () => {
  const root = await mkdtemp(join(tmpdir(), "xnlc-world-datapack-"))
  try {
    const saves = join(root, "saves", "world", "datapacks")
    await mkdir(saves, { recursive: true })
    const archive = new AdmZip()
    archive.addFile("pack.mcmeta", Buffer.from('{"pack":{"pack_format":48,"description":"Example"}}'))
    archive.addFile("data/demo/function/main.mcfunction", Buffer.from("say hi"))
    const source = join(root, "source.zip")
    await writeFile(source, archive.toBuffer())
    const folder = join(root, "folder")
    await mkdir(join(folder, "data", "folder"), { recursive: true })
    await writeFile(join(folder, "pack.mcmeta"), '{"pack":{"pack_format":61,"description":"Folder"}}')
    const invalid = join(root, "invalid.zip")
    await writeFile(invalid, "broken")
    const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import path from "node:path"
      const handlers = new Map()
      const root = process.env.WORLD_TEST_ROOT
      mock.module("./electrobun/platform/desktop.ts", () => ({ rpcRegistry: { handle: (name, fn) => handlers.set(name, fn) }, nativeImage: {} }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({
        ensureBuildIntentDir: async () => root,
        sanitizeFileName: value => path.basename(value),
        downloadBuffer: async () => new Uint8Array(await Bun.file(path.join(root, "source.zip")).arrayBuffer()),
      }))
      const { registerWorldsHandlers } = await import("./electrobun/main/worlds.ts")
      registerWorldsHandlers()
      const local = handlers.get("worlds:install-datapack-local")
      const remote = handlers.get("worlds:install-datapack-remote")
      const list = handlers.get("worlds:list-datapacks")
      assert.equal((await local(null, "build", "world", path.join(root, "source.zip"))).success, true)
      assert.equal((await local(null, "build", "world", path.join(root, "folder"))).success, true)
      assert.equal((await local(null, "build", "world", path.join(root, "invalid.zip"))).success, false)
      assert.equal((await remote(null, "build", "world", "https://example.invalid/pack", "remote.zip")).success, true)
      const result = await list(null, "build", "world")
      assert.equal(result.length, 3)
      assert.deepEqual(result.find(item => item.name === "source.zip").namespaces, ["demo"])
      assert.equal(result.find(item => item.name === "source.zip").description, "Example")
      assert.equal(result.find(item => item.name === "folder").description, "Folder")
    `
    const result = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, WORLD_TEST_ROOT: root }, stdout: "pipe", stderr: "pipe" })
    expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" })
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
