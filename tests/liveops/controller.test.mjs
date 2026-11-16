import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createEventThemeController, limitedResponse } from "../../electrobun/main/liveops/controller.mjs"
import { createFileStorage } from "../../electrobun/main/liveops/file-storage.mjs"
import { prepareTheme } from "../../electrobun/main/liveops/package.mjs"
import { initialState, restoreState, reconcile, manualSelect } from "../../electrobun/main/liveops/model.mjs"

const pkg = { format: "xneon-event-theme", version: 1, theme: { name: "Winter", primary: "#abcdef", accent: "#112233" }, assets: [] }
const bytes = Buffer.from(JSON.stringify(pkg))
const sha = createHash("sha256").update(bytes).digest("hex")
const start = Date.parse("2026-11-20T00:00:00Z")
const end = Date.parse("2027-01-15T00:00:00Z")
const event = { event_id: "winter", name: "Winter", start_date: new Date(start).toISOString(), end_date: new Date(end).toISOString(), sha256: sha, size: bytes.length, package_url: `https://themes.example/v1/packages/${sha}.json` }
const preset = { kind: "preset", id: "orange" }

async function fixture(t, selected = preset) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "liveops-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const storage = createFileStorage(directory)
  const context = { time: start, offered: event, offline: false, downloads: 0, applications: [], errors: [] }
  const create = () => createEventThemeController({
    baseURL: "https://themes.example", selected, storage, now: () => context.time,
    apply: async (ref, theme) => context.applications.push({ ref, theme }), onError: error => context.errors.push(error),
    fetcher: async url => {
      if (context.offline) throw new Error("offline")
      if (url.includes("/packages/")) { context.downloads++; return new Response(bytes) }
      return Response.json({ version: 1, server_time: new Date(context.time).toISOString(), next_check_at: new Date(context.time + 300_000).toISOString(), active_event: context.offered })
    },
  })
  const controller = await create()
  t.after(() => controller.stop())
  return { controller, context, create, storage, directory }
}

test("controller: download, UI separates events/custom, restart, expiry offline", async t => {
  const { controller, context, create, directory } = await fixture(t)
  await controller.tick()
  assert.equal(context.downloads, 1)
  assert.deepEqual(controller.snapshot().selected, { kind: "event", id: "winter" })
  const ui = controller.themes([{ id: "orange" }], [{ id: "custom-one" }])
  assert.equal(ui.standard[1].kind, "event")
  assert.equal(ui.standard[1].custom, false)
  assert.equal(ui.custom.length, 1)
  assert.equal(ui.custom[0].kind, "custom")
  controller.stop()
  const restarted = await create()
  t.after(() => restarted.stop())
  context.offline = true
  await restarted.tick()
  assert.equal(context.downloads, 1)
  assert.equal(restarted.snapshot().selected.kind, "event")
  context.time = end
  await restarted.tick()
  assert.deepEqual(restarted.snapshot().selected, preset)
  assert.equal(restarted.snapshot().active_event, null)
  assert.deepEqual(await fs.readdir(directory), ["state.json"])
})

test("controller: manual opt-out persists; can manually reselect event", async t => {
  const { controller, context, create } = await fixture(t)
  await controller.tick()
  await controller.select(preset)
  controller.stop()
  const restarted = await create()
  t.after(() => restarted.stop())
  await restarted.tick()
  assert.deepEqual(restarted.snapshot().selected, preset)
  assert.equal(restarted.snapshot().events.winter.is_auto_apply_blocked, true)
  await restarted.select({ kind: "event", id: "winter" })
  context.time = end
  await restarted.tick()
  assert.deepEqual(restarted.snapshot().selected, preset)
})

test("controller: custom is untouched, explicit revocation restores previous", async t => {
  const custom = { kind: "custom", id: "custom-test" }
  const { controller, context } = await fixture(t, custom)
  await controller.tick()
  assert.deepEqual(controller.snapshot().selected, custom)
  await controller.select({ kind: "event", id: "winter" })
  context.offered = null
  await controller.tick()
  assert.deepEqual(controller.snapshot().selected, custom)
  await assert.rejects(controller.select({ kind: "event", id: "winter" }), /unavailable/)
})

test("client rejects untrusted URLs, hash mismatch, oversized responses", async t => {
  const { controller, context } = await fixture(t)
  context.offered = { ...event, package_url: "https://attacker.example/file" }
  await controller.tick()
  assert.deepEqual(controller.snapshot().selected, preset)
  assert.equal(context.errors.length, 1)
  context.offered = { ...event, sha256: "0".repeat(64), package_url: `https://themes.example/v1/packages/${"0".repeat(64)}.json` }
  await controller.tick()
  assert.deepEqual(controller.snapshot().selected, preset)
  await assert.rejects(limitedResponse(new Response("12345"), 4), /size limit/)
  await assert.rejects(createEventThemeController({ baseURL: "http://remote.example", storage: {} }), /HTTPS/)
})

test("state robustness: clock rollback, deleted previous theme, no repeated auto-apply after custom", () => {
  const custom = { kind: "custom", id: "custom-deleted" }
  let state = reconcile(initialState(custom), event, start, true)
  state = manualSelect(state, { kind: "event", id: "winter" }, start)
  assert.deepEqual(reconcile(state, undefined, end, false, { exists: () => false }).selected, preset)
  state = reconcile(initialState(preset), event, start, true)
  state = reconcile(state, undefined, end, false)
  assert.deepEqual(reconcile(state, event, start, true).selected, preset)
  assert.deepEqual(restoreState({ version: 9 }, custom), initialState(custom))
  const constructorID = { ...event, event_id: "constructor" }
  assert.equal(reconcile(initialState(preset), constructorID, start, true).selected.id, "constructor")
})

test("package preserves publisher CSS/HTTPS media and rejects executable properties/unsafe URLs", () => {
  const themed = prepareTheme({ ...pkg, theme: { ...pkg.theme, css: "body{}", readerCss: "article{}", background: { kind: "image", source: "https://themes.example/bg.png" } } }, "winter")
  assert.equal(themed.css, "body{}")
  assert.equal(themed.readerCss, "article{}")
  assert.equal(themed.background.source, "https://themes.example/bg.png")
  assert.throws(() => prepareTheme({ ...pkg, theme: { ...pkg.theme, script: "alert(1)" } }, "winter"), /Unsupported/)
  assert.throws(() => prepareTheme({ ...pkg, theme: { ...pkg.theme, css: "x".repeat(1_000_001) } }, "winter"), /oversized/)
  for (const source of ["javascript:alert(1)", "http://remote.example/bg.png", "https://user:password@themes.example/bg.png", "assets/missing.png"]) {
    assert.throws(() => prepareTheme({ ...pkg, theme: { ...pkg.theme, background: { kind: "image", source } } }, "winter"))
  }
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2sAAAAASUVORK5CYII=", "base64")
  const withImage = { ...pkg, theme: { ...pkg.theme, background: { kind: "image", source: "assets/snow.png" } }, assets: [{ name: "snow.png", media_type: "image/png", data_base64: png.toString("base64") }] }
  assert.ok(prepareTheme(withImage, "winter").background.source.startsWith("data:image/png;base64,"))
})
