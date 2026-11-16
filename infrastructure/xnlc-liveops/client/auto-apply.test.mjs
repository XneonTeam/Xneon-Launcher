import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createEventThemeController } from "./controller.mjs"
import { createFileStorage } from "./file-storage.mjs"

const preset = id => ({ kind: "preset", id })
const custom = { kind: "custom", id: "custom-user" }
const eventRef = id => ({ kind: "event", id })
const start = Date.parse("2026-12-20T00:00:00Z")

function campaign(id, name = id, starts = start, ends = start + 86400_000) {
  const bytes = Buffer.from(JSON.stringify({ format: "xneon-event-theme", version: 1, theme: { name, primary: "#123456", accent: "#abcdef" }, assets: [] }))
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  return { bytes, metadata: { event_id: id, name, start_date: new Date(starts).toISOString(), end_date: new Date(ends).toISOString(), sha256, size: bytes.length, package_url: `https://themes.example/v1/packages/${sha256}.json` } }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(t, selected = preset("orange")) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "liveops-auto-"))
  const storage = createFileStorage(directory)
  const winter = campaign("new-year")
  const context = { time: start, offered: winter.metadata, packages: new Map([[winter.metadata.sha256, winter.bytes]]), online: true, autoApply: true, delay: null, saveDelay: null, applications: [] }
  const controllers = []
  const create = async () => {
    const controller = await createEventThemeController({
      baseURL: "https://themes.example", selected, now: () => context.time,
      storage: { ...storage, saveState: async next => {
        if (context.saveDelay && next.selected.kind === "event") { context.saveDelay.started.resolve(); await context.saveDelay.release.promise }
        await storage.saveState(next)
      } },
      autoApply: () => context.autoApply,
      apply: async (ref, theme) => { context.applications.push({ ref, theme }) },
      fetcher: async url => {
        if (!context.online) throw new Error("Offline")
        if (url.includes("/packages/")) return new Response(context.packages.get(url.split("/").at(-1).slice(0, -5)))
        if (context.delay) { context.delay.started.resolve(); await context.delay.release.promise }
        return Response.json({ version: 1, server_time: new Date(context.time).toISOString(), next_check_at: new Date(context.time + 300_000).toISOString(), active_event: context.offered })
      },
    })
    controllers.push(controller)
    return controller
  }
  t.after(async () => { for (const c of controllers) c.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  return { controller: await create(), context, create, storage, offer(value) { context.offered = value.metadata; context.packages.set(value.metadata.sha256, value.bytes) } }
}

for (const target of [preset("orange"), preset("neon"), preset("fire"), preset("ocean"), custom]) {
  test(`A/D: авто-ивент → ${target.kind}:${target.id}; отказ сохраняется после restart/update/manual event`, async t => {
    const f = await fixture(t)
    await f.controller.tick()
    assert.deepEqual(f.controller.snapshot().selected, eventRef("new-year"))
    await f.controller.select(target)
    const record = f.controller.snapshot().events["new-year"]
    assert.equal(record.was_auto_applied, true)
    assert.equal(record.is_auto_apply_blocked, true)
    assert.equal(record.auto_considered, true)
    f.controller.stop()
    const restarted = await f.create()
    assert.equal(restarted.snapshot().events["new-year"].is_auto_apply_blocked, true)
    f.offer(campaign("new-year", "New Year v2"))
    await restarted.tick()
    assert.deepEqual(restarted.snapshot().selected, target)
    assert.equal(restarted.themes([], []).standard[0].name, "New Year v2")
    await restarted.select(eventRef("new-year"))
    assert.deepEqual(restarted.snapshot().selected, eventRef("new-year"))
    assert.equal(restarted.snapshot().events["new-year"].is_auto_apply_blocked, true)
    await restarted.select(target)
    await restarted.tick()
    assert.deepEqual(restarted.snapshot().selected, target)
    assert.equal(restarted.snapshot().events["new-year"].is_auto_apply_blocked, true)
    f.context.time += 86400_000
    f.context.offered = null
    await restarted.tick()
    assert.deepEqual(restarted.snapshot().selected, target)
  })
}

test("B: Blaze → Core до получения кампании не блокирует автоактивацию", async t => {
  const f = await fixture(t, preset("fire"))
  await f.controller.select(preset("orange"))
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, eventRef("new-year"))
  assert.deepEqual(f.controller.snapshot().previous, preset("orange"))
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
})

test("B: ручной выбор во время запроса до автоактивации не становится отказом", async t => {
  const f = await fixture(t, preset("fire"))
  f.context.delay = { started: deferred(), release: deferred() }
  const polling = f.controller.tick()
  await f.context.delay.started.promise
  const manual = f.controller.select(preset("orange"))
  f.context.delay.release.resolve()
  await Promise.all([polling, manual])
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, eventRef("new-year"))
  assert.deepEqual(f.controller.snapshot().previous, preset("orange"))
})

test("B/C: Custom выбирается во время запроса и не вытесняется LiveOps", async t => {
  const f = await fixture(t)
  f.context.delay = { started: deferred(), release: deferred() }
  const polling = f.controller.tick()
  await f.context.delay.started.promise
  const manual = f.controller.select(custom)
  f.context.delay.release.resolve()
  await Promise.all([polling, manual])
  assert.deepEqual(f.controller.snapshot().selected, custom)
  assert.equal(f.controller.snapshot().events["new-year"].was_auto_applied, false)
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, custom)
  assert.equal(f.controller.themes([], [custom]).standard[0].id, "event:new-year")
})

test("B: ручной выбор до публикации авто-темы учитывается даже во время записи state.json", async t => {
  const f = await fixture(t, preset("fire"))
  f.context.saveDelay = { started: deferred(), release: deferred() }
  const polling = f.controller.tick()
  await f.context.saveDelay.started.promise
  const manual = f.controller.select(preset("orange"))
  f.context.saveDelay.release.resolve()
  await Promise.all([polling, manual])
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
  assert.equal(f.context.applications.some(item => item.ref.kind === "event"), false)
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, eventRef("new-year"))
  assert.deepEqual(f.controller.snapshot().previous, preset("orange"))
})

test("глобальное отключение во время записи auto-state не допускает публикацию авто-темы", async t => {
  const f = await fixture(t, preset("fire"))
  f.context.saveDelay = { started: deferred(), release: deferred() }
  const polling = f.controller.tick()
  await f.context.saveDelay.started.promise
  f.context.autoApply = false
  f.context.saveDelay.release.resolve()
  await polling
  assert.deepEqual(f.controller.snapshot().selected, preset("fire"))
  assert.equal(f.context.applications.some(item => item.ref.kind === "event"), false)
})

test("C: исходная Custom не заменяется, доступен ручной ивент и возврат", async t => {
  const f = await fixture(t, custom)
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, custom)
  await f.controller.select(eventRef("new-year"))
  assert.deepEqual(f.controller.snapshot().previous, custom)
  f.context.time += 86400_000
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, custom)
})

test("E: отказ от New Year не блокирует следующую независимую кампанию", async t => {
  const f = await fixture(t)
  await f.controller.tick()
  await f.controller.select(preset("orange"))
  f.context.time += 86400_000
  f.offer(campaign("valentines", "Valentine", f.context.time, f.context.time + 86400_000))
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, eventRef("valentines"))
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, true)
  assert.equal(f.controller.snapshot().events.valentines.is_auto_apply_blocked, false)
})

test("глобальное отключение запрещает автоматику, но не ручной выбор и не сбрасывает отказ", async t => {
  const f = await fixture(t, preset("fire"))
  f.context.autoApply = false
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, preset("fire"))
  assert.equal(f.controller.snapshot().events["new-year"].was_auto_applied, false)
  assert.equal(f.controller.themes([], []).standard[0].id, "event:new-year")
  await f.controller.select(eventRef("new-year"))
  await f.controller.select(preset("orange"))
  f.context.autoApply = true
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, preset("orange"))
})

test("обновление активной темы не является ручным выбором; отзыв и expiry не создают отказ", async t => {
  const f = await fixture(t, preset("fire"))
  await f.controller.tick()
  f.offer(campaign("new-year", "New Year v2"))
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, eventRef("new-year"))
  assert.deepEqual(f.controller.snapshot().previous, preset("fire"))
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
  assert.equal(f.context.applications.at(-1).theme.name, "New Year v2")
  f.context.offered = null
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, preset("fire"))
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
})

test("ручной отказ во время polling уже активной темы фиксируется, ошибка выбора не блокирует очередь", async t => {
  const f = await fixture(t)
  await f.controller.tick()
  f.context.delay = { started: deferred(), release: deferred() }
  const polling = f.controller.tick()
  await f.context.delay.started.promise
  const manual = f.controller.select(preset("neon"))
  f.context.delay.release.resolve()
  await Promise.all([polling, manual])
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, true)
  await assert.rejects(f.controller.select(eventRef("unknown")), /unavailable/)
  await assert.rejects(f.controller.select({ kind: "invalid", id: "x" }), /Invalid selection/)
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, preset("neon"))
  f.context.time += 86400_000
  f.offer(campaign("valentines", "Valentine", f.context.time, f.context.time + 86400_000))
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, eventRef("valentines"))
})

test("истечение автоматически выбранного ивента возвращает исходный пресет без записи отказа", async t => {
  const f = await fixture(t, preset("fire"))
  await f.controller.tick()
  f.context.time += 86400_000
  f.context.online = false
  await f.controller.tick()
  assert.deepEqual(f.controller.snapshot().selected, preset("fire"))
  assert.equal(f.controller.snapshot().events["new-year"].is_auto_apply_blocked, false)
})
