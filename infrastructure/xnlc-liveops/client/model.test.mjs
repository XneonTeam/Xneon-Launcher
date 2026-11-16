import test from "node:test"
import assert from "node:assert/strict"
import { initialState, reconcile, manualSelect } from "./model.mjs"

const preset = { kind: "preset", id: "orange" }
const custom = { kind: "custom", id: "custom-user" }
const event = { event_id: "winter-2026", start_date: "2026-11-20T00:00:00Z", end_date: "2027-01-15T00:00:00Z", sha256: "a".repeat(64), size: 100, package_url: "https://themes.example/v1/packages/a.json", name: "Winter" }
const start = Date.parse(event.start_date)
const end = Date.parse(event.end_date)

test("A: стандартная → ивент → предыдущая тема ровно в end_date", () => {
  let state = initialState(preset)
  state = reconcile(state, event, start, true)
  assert.deepEqual(state.selected, { kind: "event", id: "winter-2026" })
  assert.deepEqual(state.previous, preset)
  state = reconcile(state, undefined, end, false)
  assert.deepEqual(state.selected, preset)
  assert.equal(state.active_event, null)
})

test("Б: кастомная тема не меняется; ивент доступен вручную", () => {
  let state = reconcile(initialState(custom), event, start, true)
  assert.deepEqual(state.selected, custom)
  assert.equal(state.active_event.event_id, event.event_id)
  state = manualSelect(state, { kind: "event", id: event.event_id }, start)
  assert.deepEqual(state.previous, custom)
  assert.deepEqual(reconcile(state, undefined, end, false).selected, custom)
})

test("В: ручной отказ переживает перезапуск и не запрещает ручной выбор", () => {
  let state = reconcile(initialState(preset), event, start, true)
  state = manualSelect(state, preset, start + 1)
  assert.equal(state.events[event.event_id].is_auto_apply_blocked, true)
  state = reconcile(JSON.parse(JSON.stringify(state)), event, start + 2, true)
  assert.deepEqual(state.selected, preset)
  state = manualSelect(state, { kind: "event", id: event.event_id }, start + 3)
  assert.deepEqual(state.selected, { kind: "event", id: event.event_id })
})

test("не применять до start_date или до успешной загрузки; отзыв с сервера", () => {
  assert.deepEqual(reconcile(initialState(preset), event, start - 1, true).selected, preset)
  assert.deepEqual(reconcile(initialState(preset), event, start, false).selected, preset)
  let state = reconcile(initialState(preset), event, start, true)
  state = reconcile(state, null, start + 1, false)
  assert.deepEqual(state.selected, preset)
})
