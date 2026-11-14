import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import vm from "node:vm"
import { createRequire } from "node:module"

const require = createRequire(new URL("../../dist-electrobun-tests/main/builds/helpers.js", import.meta.url))
async function fixture(t, custom = false, cachedJar) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-delete-disabled-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const module = { exports: {} }
  const code = await fs.readFile(new URL("../../dist-electrobun-tests/main/builds/helpers.js", import.meta.url), "utf8")
  const mocks = {
    "../../db": { dbHelpers: custom ? {
      findBuildByName: async name => name === "test" ? { id: "build", name } : null,
      findBuildById: async () => ({ intentPath: path.join(root, "custom") }),
    } : {} },
    "../paths": { getLauncherDataRoot: () => root },
    "../shared-game-cache": {},
    "../jar-cache": { getCachedJarPath: cachedJar ?? (async () => path.join(root, "cached.jar")) },
    "@xnlc/core/retry": {},
    "../errors": { opFailure: error => ({ success: false, error: String(error) }) },
  }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), console, setTimeout, Buffer, process })
  const api = module.exports
  const intent = await api.ensureBuildIntentDir("test")
  return { api, intent, custom: path.join(root, "custom") }
}

test("удаление во время установки не ждёт скачивание и отменяет публикацию файла", async t => {
  const waiting = Promise.withResolvers()
  const cached = Promise.withResolvers()
  const { api, intent } = await fixture(t, false, () => {
    waiting.resolve()
    return cached.promise
  })
  const target = path.join(intent, "mods", "a.jar")
  const cacheFile = path.join(intent, "cached.jar")
  await fs.writeFile(target, "old content")
  await fs.writeFile(cacheFile, "new content")
  const install = api.saveRemoteContentToIntent("test", "mod", "https://example.invalid/a.jar", "a.jar")
  await waiting.promise
  try {
    assert.equal((await api.deleteContentFromIntent("test", "mod", "a.jar")).success, true)
    await assert.rejects(fs.stat(target), { code: "ENOENT" })
  } finally { cached.resolve(cacheFile) }
  assert.equal(await install, null)
  await assert.rejects(fs.stat(target), { code: "ENOENT" })
  assert.equal(await api.saveRemoteContentToIntent("test", "mod", "https://example.invalid/a.jar", "a.jar"), target)
})

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

test("точный путь не удаляет одноимённый файл в другой папке", async t => {
  const { api, intent } = await fixture(t)
  const directory = path.join(intent, "mods")
  await fs.mkdir(path.join(directory, "nested"))
  await fs.writeFile(path.join(directory, "same.jar"), "root")
  await fs.writeFile(path.join(directory, "nested", "same.jar"), "nested")
  assert.equal((await api.deleteContentFromIntent("test", "mod", "nested/same.jar")).success, true)
  assert.equal(await fs.readFile(path.join(directory, "same.jar"), "utf8"), "root")
  await assert.rejects(fs.stat(path.join(directory, "nested", "same.jar")), { code: "ENOENT" })
})

test("удаление и установка используют сохранённый каталог сборки", async t => {
  const { api, intent, custom } = await fixture(t, true)
  const target = path.join(custom, "mods")
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, "old.jar"), "old")
  await fs.writeFile(path.join(intent, "mods", "old.jar"), "unrelated")
  assert.equal((await api.deleteContentFromIntent("test", "mod", "old.jar")).success, true)
  await assert.rejects(fs.stat(path.join(target, "old.jar")), { code: "ENOENT" })
  assert.equal(await fs.readFile(path.join(intent, "mods", "old.jar"), "utf8"), "unrelated")
  const source = path.join(custom, "new.jar")
  await fs.writeFile(source, "new")
  assert.equal(await api.saveLocalContentToIntent("test", "mod", source), path.join(target, "new.jar"))
  assert.equal(await fs.readFile(path.join(target, "new.jar"), "utf8"), "new")
  await fs.writeFile(path.join(path.dirname(custom), "cached.jar"), "download")
  assert.equal(await api.saveRemoteContentToIntent("test", "mod", "https://example.invalid/mod.jar", "remote.jar"), path.join(target, "remote.jar"))
  assert.equal(await fs.readFile(path.join(target, "remote.jar"), "utf8"), "download")
  await fs.writeFile(path.join(path.dirname(custom), "cached.jar"), "updated")
  assert.equal(await api.saveRemoteContentToIntent("test", "mod", "https://example.invalid/mod.jar", "remote.jar"), path.join(target, "remote.jar"))
  assert.equal(await fs.readFile(path.join(target, "remote.jar"), "utf8"), "updated")
  assert.equal((await fs.readdir(custom)).some(name => name.startsWith(".xneon-content-")), false)
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
