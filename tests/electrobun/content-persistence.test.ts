// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import test, { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import fs, { mkdtemp, mkdir, writeFile, rename, unlink, rm, stat } from "node:fs/promises"
import vm from "node:vm"
import Database from "better-sqlite3"
import { stripTypeScriptTypes } from "./transpile.mjs"
import os, { tmpdir } from "node:os"
import path, { join } from "node:path"
import { createRequire } from "node:module"
import { describe, expect, test as bunTest } from "bun:test"
import { acknowledgeBuildEdits, BuildWriteQueue, filterStaleBuildPatch } from "../../lib/build-write-queue.ts"
import http from "node:http"
import downloads from "../../dist-electrobun-tests/main/content-downloads.js"

{
  const helperSource = await fs.readFile(new URL("../../lib/build-content-patch.ts", import.meta.url), "utf8")
  const { beginContentMutationGuard, buildContentPatch, createContentRefreshQueue, filterStaleContentPatch } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(helperSource)).toString("base64"))
  const empty = () => ({ mods: [], resourcepacks: [], shaders: [], installedMods: {} })
  describe("build-content-persistence", () => {
    test("незагруженные заглушки не попадают в патч даже без сохранённого снимка", () => {
      assert.equal(Object.keys(buildContentPatch(empty(), undefined, false)).length, 0)
    })
    test("повторное открытие сохранённого контента не порождает запись", () => {
      const content = { ...empty(), mods: [{ id: "a", slug: "a.jar" }] }
      assert.equal(Object.keys(buildContentPatch(content, content, true)).length, 0)
    })
    test("удаление последнего мода передаёт явный ноль и пустой список", () => {
      const content = empty()
      const patch = buildContentPatch(content, { ...content, mods: [{ id: "a" }] }, true)
      assert.equal(patch.modsCount, 0)
      assert.equal(patch.mods.length, 0)
      assert.equal("shaders" in patch, false)
    })
    test("устаревшее сохранение не возвращает контент после удаления или установки", () => {
      const old = { name: "Build", mods: [{ slug: "old.jar" }], modsCount: 1, installedMods: { "old.jar": "path" } }
      assert.deepEqual(filterStaleContentPatch(old, 4, 5, false), { name: "Build" })
      assert.deepEqual(filterStaleContentPatch(old, 4, 4, true), { name: "Build" })
      assert.equal(filterStaleContentPatch(old, 4, 4, false), old)
    })
    test("пакет операций откладывает перескан и отклоняет предыдущие результаты", () => {
      const active = new Map(), revisions = new Map([["build", 3]])
      let refreshes = 0
      const finishBatch = beginContentMutationGuard(active, revisions, "build", () => refreshes++)
      const finishDelete = beginContentMutationGuard(active, revisions, "build", () => refreshes++)
      assert.equal(active.get("build"), 2)
      assert.deepEqual(filterStaleContentPatch({ mods: ["old"], name: "Build" }, 3, revisions.get("build"), true), { name: "Build" })
      finishDelete()
      assert.equal(refreshes, 0)
      finishBatch()
      finishBatch()
      assert.equal(refreshes, 1)
      assert.equal(active.has("build"), false)
    })

    test("удаление во время скана отбрасывает старый снимок и объединяет запросы перескана", async () => {
      const queue = createContentRefreshQueue()
      const active = new Map(), revisions = new Map()
      const first = Promise.withResolvers()
      const started = Promise.withResolvers()
      const snapshots = []
      let passes = 0
      const refresh = async () => {
        const revision = revisions.get("build") ?? 0
        const files = ++passes === 1 ? ["old.jar"] : ["new.jar"]
        if (passes === 1) {
          started.resolve()
          await first.promise
        }
        if (revision === (revisions.get("build") ?? 0)) snapshots.push(files)
      }
      const task = queue("build", false, refresh)
      await started.promise
      assert.equal(queue("build", false, refresh), task)
      const finish = beginContentMutationGuard(active, revisions, "build", () => queue("build", true, refresh))
      finish()
      assert.equal(queue("build", true, refresh), task)
      first.resolve()
      await task
      assert.deepEqual(snapshots, [["new.jar"]])
      assert.equal(passes, 2)
    })

    async function database(t) {
      const db = new Database(":memory:")
      t.after(() => db.close())
      db.exec("CREATE TABLE builds (id TEXT PRIMARY KEY, name TEXT, mods TEXT, resourcepacks TEXT, shaders TEXT, installedMods TEXT, modsCount INTEGER, resourcepacksCount INTEGER, shadersCount INTEGER)")
      db.prepare("INSERT INTO builds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("build", "Test", '[{"slug":"a.jar"}]', '[{"slug":"p.zip"}]', '[]', '{"a.jar":"1"}', 1, 1, 0)
      const code = await fs.readFile(new URL("../../dist-electrobun-tests/db/builds.js", import.meta.url), "utf8")
      const module = { exports: {} }
      const logs = []
      vm.runInNewContext(code, { module, exports: module.exports, console, require: name => {
        if (name === "./core") return { isDbAvailable: () => true, queryAll: (sql, params) => db.prepare(sql).all(...params), run: (sql, params) => db.prepare(sql).run(...params) }
        if (name === "../main/runtime") return { logRuntime: message => logs.push(message) }
        throw new Error("Unexpected dependency: " + name)
      } })
      return { db, api: module.exports, logs }
    }

    test("SQLite: изменение названия не трогает незагруженные списки", async t => {
      const { api, db, logs } = await database(t)
      await api.updateBuildFields("build", { name: "Renamed", ...buildContentPatch(empty(), undefined, false) })
      const row = db.prepare("SELECT * FROM builds").get()
      assert.equal(row.name, "Renamed")
      assert.equal(row.modsCount, 1)
      assert.equal(JSON.parse(row.mods).length, 1)
      assert.equal(logs.length, 0)
    })
    test("SQLite: явное удаление последнего мода сохраняет нулевой счётчик и пустые списки", async t => {
      const { api, db, logs } = await database(t)
      const patch = buildContentPatch(empty(), undefined, true)
      await api.updateBuildFields("build", patch)
      const row = db.prepare("SELECT * FROM builds").get()
      assert.equal(row.mods, "[]")
      assert.equal(row.resourcepacks, "[]")
      assert.equal(row.installedMods, "{}")
      assert.equal(row.modsCount, 0)
      assert.equal(row.resourcepacksCount, 0)
      assert.equal(logs.length, 0)
    })
    test("SQLite: прежняя защита от неявного пустого патча сохраняется", async t => {
      const { api, db } = await database(t)
      await api.updateBuildFields("build", { mods: [], installedMods: {} })
      const row = db.prepare("SELECT * FROM builds").get()
      assert.equal(row.modsCount, 1)
      assert.equal(JSON.parse(row.mods).length, 1)
      assert.equal(Object.keys(JSON.parse(row.installedMods)).length, 1)
    })
  })
}

{
  const test = nodeTest
  const require = createRequire(import.meta.url)
  const { watchBuildContent } = require('../../dist-electrobun-tests/main/builds/content-watcher.js')
  const { contentMetadataEvents } = require('../../dist-electrobun-tests/main/builds/content-metadata-events.js')
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  describe("build-content-watcher", () => {
    test('Изменения контента отслеживаются, посторонние файлы игнорируются, подписка закрывается', async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'xnlc-content-watch-'))
      let changes = 0
      let close = () => {}
      const changed = async action => {
        const before = changes
        await action()
        for (let n = 0; n < 40 && changes === before; n++) await wait(50)
        assert.ok(changes > before)
      }
      try {
        await mkdir(path.join(root, 'mods'))
        close = watchBuildContent(root, () => changes++, 80)
        await changed(() => writeFile(path.join(root, 'mods', 'example.jar'), 'mod'))
        await changed(() => rename(path.join(root, 'mods', 'example.jar'), path.join(root, 'mods', 'example.jar.disabled')))
        await changed(() => unlink(path.join(root, 'mods', 'example.jar.disabled')))
        await wait(150)
        const before = changes
        await writeFile(path.join(root, 'latest.log'), 'log')
        await wait(200)
        assert.equal(changes, before)
        await changed(async () => {
          await mkdir(path.join(root, 'resourcepacks'))
          await writeFile(path.join(root, 'resourcepacks', 'pack.zip'), 'pack')
        })
        await changed(async () => {
          contentMetadataEvents.emit('updated', [path.join(root, 'mods', 'example.jar')])
        })
        await wait(150)
        const last = changes
        close()
        await writeFile(path.join(root, 'mods', 'other.jar'), 'mod')
        await wait(200)
        assert.equal(changes, last)
      } finally {
        close()
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}

{
  const test = bunTest
  describe("build-write-queue", () => {
    test("подтверждение старого патча не очищает новую правку того же поля", () => {
      expect(acknowledgeBuildEdits({ name: "new", locked: false }, { name: "old", locked: false })).toEqual({ name: "new" })
      expect(acknowledgeBuildEdits({ name: undefined }, { name: undefined })).toEqual({})
    })

    test("старый debounce не откатывает более новую команду light fields", () => {
      expect(filterStaleBuildPatch({ name: "old", locked: false, mods: [] }, { name: "new", locked: false })).toEqual({ locked: false, mods: [] })
      expect(filterStaleBuildPatch({ name: "old" }, undefined)).toEqual({})
    })

    test("после main commit устаревший снимок не возвращает loader, сохраняя пользовательские правки", () => {
      const fields = { version: "old", loaderVersion: "47", mods: ["old"], memoryMax: "16G" }
      expect(filterStaleBuildPatch(fields, fields, true)).toEqual({ memoryMax: "16G" })
    })

    test("семантический MODPACK_BUSY не повторяет отвергнутую версию после обновления", async () => {
      let busy = true
      const writes: Record<string, unknown>[] = []
      const queue = new BuildWriteQueue(async (_id, fields) => {
        if (busy) throw new Error("MODPACK_BUSY")
        writes.push(fields)
      })
      await expect(queue.write("build", { version: "stale" })).rejects.toThrow("MODPACK_BUSY")
      expect(queue.getPending("build")).toEqual({})
      busy = false
      await queue.flush()
      expect(writes).toEqual([])
      await queue.write("build", { version: "explicit-new-intent" })
      expect(writes).toEqual([{ version: "explicit-new-intent" }])
    })

    test("отказ metadata owner сохраняет пользовательские поля смешанного патча для retry", async () => {
      let busy = true
      const writes: Record<string, unknown>[] = []
      const queue = new BuildWriteQueue(async (_id, fields) => {
        if (busy && "version" in fields) throw new Error("MODPACK_BUSY")
        writes.push(fields)
      })
      await expect(queue.write("build", { version: "stale", memoryMax: "16G", group: "My group" })).rejects.toThrow("MODPACK_BUSY")
      expect(queue.getPending("build")).toEqual({ memoryMax: "16G", group: "My group" })
      busy = false
      await queue.flush()
      expect(writes).toEqual([{ memoryMax: "16G", group: "My group" }])
    })

    test("подтверждённая main установка инвалидирует отложенные metadata, но сохраняет пользовательские поля", async () => {
      const gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
      const writes: Record<string, unknown>[] = []
      const queue = new BuildWriteQueue(async (_id, fields) => {
        writes.push(fields)
        if (writes.length === 1) { started.resolve(); await gate.promise }
      })
      const first = queue.write("build", { description: "User" })
      await started.promise
      const stale = queue.write("build", { version: "old", mods: ["old"], memoryMax: "16G" })
      queue.discardPackMetadata("build")
      gate.resolve()
      await Promise.all([first, stale])
      expect(writes).toEqual([{ description: "User" }, { memoryMax: "16G" }])
    })

    test("одновременные записи одной сборки сериализованы; более новая побеждает", async () => {
      const gate = Promise.withResolvers<void>()
      const started = Promise.withResolvers<void>()
      const writes: Record<string, unknown>[] = []
      const queue = new BuildWriteQueue(async (_id, fields) => {
        writes.push(fields)
        if (writes.length === 1) { started.resolve(); await gate.promise }
      })
      const first = queue.write("a", { name: "old" })
      await started.promise
      const second = queue.write("a", { name: "new" })
      expect(writes).toEqual([{ name: "old" }])
      gate.resolve()
      await Promise.all([first, second])
      expect(writes).toEqual([{ name: "old" }, { name: "new" }])
      expect(queue.getPending("a")).toEqual({})
    })

    test("сбой persistence не теряет патч; flush повторяет запись без старого значения", async () => {
      let failed = true
      const writes: Record<string, unknown>[] = []
      const queue = new BuildWriteQueue(async (_id, fields) => { if (failed) throw new Error("disk full"); writes.push(fields) })
      await expect(queue.write("a", { name: "old", locked: false })).rejects.toThrow("disk full")
      failed = false
      await queue.write("a", { name: "new" })
      await queue.flush()
      expect(writes).toEqual([{ name: "new", locked: false }])
    })

    test("сборки не блокируют друг друга; flush после ошибки сохраняет все оставшиеся поля", async () => {
      const gate = Promise.withResolvers<void>()
      const calls: string[] = []
      const queue = new BuildWriteQueue(async id => { if (id === "slow") await gate.promise; calls.push(id) })
      const slow = queue.write("slow", { name: "slow" })
      await queue.write("fast", { name: "fast" })
      expect(calls).toEqual(["fast"])
      gate.resolve()
      await slow
      await queue.flush()
      expect(calls).toEqual(["fast", "slow"])
    })

    test("stale content отбрасывается перед фактической записью, не при постановке в очередь", async () => {
      const gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
      const writes: Record<string, unknown>[] = []
      let valid = true
      const queue = new BuildWriteQueue(async (_id, fields) => { writes.push(fields); started.resolve(); await gate.promise })
      const first = queue.write("a", { name: "Name" })
      await started.promise
      const stale = queue.write("a", { mods: ["removed"] }, () => valid)
      valid = false
      gate.resolve()
      await Promise.all([first, stale])
      expect(writes).toEqual([{ name: "Name" }])
      expect(queue.getPending("a")).toEqual({})
    })
  })
}

{
  const test = bunTest
  describe("content-refresh-loop", () => {
    test("скан не возвращает удалённый JAR и видит установленный во время прохода", async () => {
      const dir = await mkdtemp(join(tmpdir(), "xnlc-scan-race-"))
      try {
        const mods = join(dir, "mods")
        await mkdir(mods)
        await writeFile(join(mods, "old.jar"), "old")
        const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import { rm, writeFile } from "node:fs/promises"
      import { join } from "node:path"
      const dir = process.env.CONTENT_TEST_DIR
      const oldPath = join(dir, "mods", "old.jar")
      const newPath = join(dir, "mods", "new.jar.disabled")
      const started = Promise.withResolvers()
      const release = Promise.withResolvers()
      const calls = []
      mock.module("./electrobun/main/builds/content-resolver.ts", () => ({
        resolveContentEntries: async files => {
          calls.push(files)
          if (calls.length === 1) {
            started.resolve()
            await release.promise
          }
          return {}
        }
      }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({ formatDisplayNameFromFileName: name => name }))
      const { scanIntentDir } = await import("./electrobun/main/builds/scanner.ts")
      const scan = scanIntentDir(dir)
      await started.promise
      assert.equal(scanIntentDir(dir), scan)
      await rm(oldPath)
      await writeFile(newPath, "new")
      release.resolve()
      const result = await scan
      assert.deepEqual(calls, [[oldPath], [newPath]])
      assert.deepEqual(result.mods.map(({ slug, enabled }) => [slug, enabled]), [["new.jar", false]])
      assert.deepEqual(result.installedMods, { "new.jar": newPath })
    `
        const result = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, CONTENT_TEST_DIR: dir }, stdout: "pipe", stderr: "pipe" })
        expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" })
      } finally { await rm(dir, { recursive: true, force: true }) }
    }, 10000)

    test("ресурс без имени из Modrinth не запускает повторное сетевое обогащение", async () => {
      const dir = await mkdtemp(join(tmpdir(), "xnlc-refresh-loop-"))
      try {
        const file = join(dir, "pack.zip")
        await writeFile(file, "fixture")
        const info = await stat(file)
        const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      const file = process.env.CONTENT_TEST_FILE, sha1 = "a".repeat(40)
      let networkCalls = 0, writes = 0, events = 0
      mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: {
        getFileSnapshots: async () => [{ path: file, size: Number(process.env.CONTENT_TEST_SIZE), mtime: Number(process.env.CONTENT_TEST_MTIME), sha1 }],
        getResources: async () => [{ sha1, name: "", version: "", description: "", icon: "https://example.invalid/icon.png", author: "", source: "modrinth", projectId: "project", versionId: "version", modId: null, fileId: null, cfChecked: 1 }],
        upsertResources: async values => { if (values.length) writes++ }, upsertFileSnapshots: async () => {},
      } }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({ loadModsModule: async () => { networkCalls++; throw new Error("unexpected") } }))
      const { contentMetadataEvents } = await import("./electrobun/main/builds/content-metadata-events.ts")
      contentMetadataEvents.on("updated", () => { events++ })
      const { resolveContentEntries } = await import("./electrobun/main/builds/content-resolver.ts")
      const first = await resolveContentEntries([file])
      const second = await resolveContentEntries([file])
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(first[file].source, "modrinth")
      assert.equal(second[file].source, "modrinth")
      assert.equal(networkCalls, 0)
      assert.equal(writes, 0)
      assert.equal(events, 0)
    `
        const result = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, CONTENT_TEST_FILE: file, CONTENT_TEST_SIZE: String(info.size), CONTENT_TEST_MTIME: String(Math.round(info.mtimeMs)) }, stdout: "pipe", stderr: "pipe" })
        expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" })
      } finally { await rm(dir, { recursive: true, force: true }) }
    }, 30000)
  })
}

{
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
  describe("delete-disabled-content", () => {
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
  })
}

{
  const require = createRequire(new URL('../../dist-electrobun-tests/main/builds/helpers.js', import.meta.url))
  async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-cancel-content-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const module = { exports: {} }
    const mocks = {
      '../../db': { dbHelpers: {} }, '../paths': { getLauncherDataRoot: () => root },
      '../shared-game-cache': {}, '../jar-cache': { getCachedJarPath: async () => null },
      '@xnlc/core/retry': { fetchWithRetry: fetch }, '../errors': {},
    }
    const code = await fs.readFile(new URL('../../dist-electrobun-tests/main/builds/helpers.js', import.meta.url), 'utf8')
    vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), console, setTimeout, Buffer, process })
    let started, disconnected
    const receiving = new Promise(resolve => { started = resolve })
    const closed = new Promise(resolve => { disconnected = resolve })
    const server = http.createServer((request, response) => {
      if (request.url === '/ok') { response.end('complete mod'); return }
      response.writeHead(200, { 'content-length': 1024 * 1024 })
      const timer = setInterval(() => { response.write(Buffer.alloc(1024)); started() }, 10)
      response.on('close', () => { clearInterval(timer); disconnected() })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
    return { api: module.exports, receiving, closed, url: `http://127.0.0.1:${server.address().port}` }
  }
  describe("content-download-cancellation", () => {
    for (const [kind, folder, name] of [['mod', 'mods', 'test.jar'], ['resourcepack', 'resourcepacks', 'test.zip'], ['shader', 'shaderpacks', 'test.zip']]) {
      test(`отмена ${kind}: соединение закрывается, файл не устанавливается, повтор работает`, { timeout: 5000 }, async t => {
        const { api, receiving, closed, url } = await fixture(t)
        let id
        const task = downloads.runContentDownload(1, (signal, requestId) => {
          id = requestId
          return api.saveRemoteContentToIntent('test', kind, url + '/slow', name, signal, requestId)
        })
        const rejected = assert.rejects(task, /CONTENT_DOWNLOAD_CANCELLED/)
        await receiving
        assert.equal(downloads.cancelContentDownload(2, id), false)
        assert.equal(downloads.cancelContentDownload(1, id), true)
        await rejected
        await closed
        assert.equal(downloads.cancelContentDownload(1, id), false)
        const intent = await api.ensureBuildIntentDir('test')
        await assert.rejects(fs.stat(path.join(intent, folder, name)), { code: 'ENOENT' })
        const file = await downloads.runContentDownload(1, (signal, requestId) => api.saveRemoteContentToIntent('test', kind, url + '/ok', name, signal, requestId))
        assert.equal(await fs.readFile(file, 'utf8'), 'complete mod')
      })
    }

    test('отмена обновления сохраняет уже установленный мод и не останавливает другую загрузку', { timeout: 5000 }, async t => {
      const { api, receiving, url } = await fixture(t)
      const intent = await api.ensureBuildIntentDir('test')
      const directory = path.join(intent, 'mods')
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, 'test.jar'), 'installed version')
      let id
      const task = downloads.runContentDownload(7, (signal, requestId) => { id = requestId; return api.saveRemoteContentToIntent('test', 'mod', url + '/slow', 'test.jar', signal, requestId) })
      const rejected = assert.rejects(task, /CONTENT_DOWNLOAD_CANCELLED/)
      await receiving
      const parallel = downloads.runContentDownload(7, (signal, requestId) => api.saveRemoteContentToIntent('test', 'mod', url + '/ok', 'other.jar', signal, requestId))
      downloads.cancelContentDownload(7, id)
      await rejected
      assert.equal(await fs.readFile(path.join(directory, 'test.jar'), 'utf8'), 'installed version')
      assert.equal(await fs.readFile(await parallel, 'utf8'), 'complete mod')
    })
  })
}
