import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"
import Database from "better-sqlite3"
import { stripTypeScriptTypes } from "./transpile.mjs"

const helperSource = await fs.readFile(new URL("../../lib/build-content-patch.ts", import.meta.url), "utf8")
const { beginContentMutationGuard, buildContentPatch, createContentRefreshQueue, filterStaleContentPatch } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(helperSource)).toString("base64"))
const empty = () => ({ mods: [], resourcepacks: [], shaders: [], installedMods: {} })

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
