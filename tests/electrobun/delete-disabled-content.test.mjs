import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import vm from "node:vm"
import { createRequire } from "node:module"

const require = createRequire(new URL("../../dist-electrobun-tests/main/builds/helpers.js", import.meta.url))
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-delete-disabled-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const module = { exports: {} }
  const code = await fs.readFile(new URL("../../dist-electrobun-tests/main/builds/helpers.js", import.meta.url), "utf8")
  const mocks = {
    "../../db": { dbHelpers: {} },
    "../paths": { getLauncherDataRoot: () => root },
    "../shared-game-cache": {},
    "../jar-cache": {},
    "@xnlc/core/retry": {},
    "../errors": { opFailure: error => ({ success: false, error: String(error) }) },
  }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), console, setTimeout, Buffer, process })
  const api = module.exports
  const intent = await api.ensureBuildIntentDir("test")
  return { api, intent }
}

for (const [kind, folder, name] of [["mod", "mods", "example.jar"], ["mod", "mods", "legacy.litemod"], ["resourcepack", "resourcepacks", "pack.zip"], ["shader", "shaderpacks", "shader.zip"]]) {
  test(`удаление выключенного ${kind}: ${name} не остаётся для повторного сканирования`, async t => {
    const { api, intent } = await fixture(t)
    const file = path.join(intent, folder, name + ".disabled")
    await fs.writeFile(file, "disabled content")
    assert.equal((await api.deleteContentFromIntent("test", kind, name)).success, true)
    await assert.rejects(fs.stat(file), { code: "ENOENT" })
    assert.deepEqual(await fs.readdir(path.join(intent, folder)), [])
  })
}

test("выключение → удаление и повторное удаление; посторонние файлы сохраняются", async t => {
  const { api, intent } = await fixture(t)
  const directory = path.join(intent, "mods")
  await fs.writeFile(path.join(directory, "a.jar"), "a")
  await fs.writeFile(path.join(directory, "keep.jar.disabled"), "keep")
  assert.equal((await api.setContentEnabledInIntent("test", "mod", "a.jar", false)).success, true)
  assert.equal((await api.deleteContentFromIntent("test", "mod", "a.jar")).success, true)
  assert.equal((await api.deleteContentFromIntent("test", "mod", "a.jar")).success, true)
  assert.deepEqual(await fs.readdir(directory), ["keep.jar.disabled"])
})

test("вложенный выключенный мод удаляется по относительному slug", async t => {
  const { api, intent } = await fixture(t)
  const directory = path.join(intent, "mods", "nested")
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, "a.jar.disabled"), "a")
  assert.equal((await api.deleteContentFromIntent("test", "mod", "nested/a.jar")).success, true)
  assert.deepEqual(await fs.readdir(directory), [])
})

test("одновременно оставшиеся включённая и выключенная копии удаляются вместе", async t => {
  const { api, intent } = await fixture(t)
  const directory = path.join(intent, "mods")
  for (const name of ["a.jar", "a.jar.disabled", "other.jar"]) await fs.writeFile(path.join(directory, name), name)
  assert.equal((await api.deleteContentFromIntent("test", "mod", "a.jar.disabled")).success, true)
  assert.deepEqual(await fs.readdir(directory), ["other.jar"])
})

test("включённый мод по-прежнему удаляется", async t => {
  const { api, intent } = await fixture(t)
  await fs.writeFile(path.join(intent, "mods", "enabled.jar"), "enabled")
  assert.equal((await api.deleteContentFromIntent("test", "mod", "enabled.jar")).success, true)
  assert.deepEqual(await fs.readdir(path.join(intent, "mods")), [])
})
