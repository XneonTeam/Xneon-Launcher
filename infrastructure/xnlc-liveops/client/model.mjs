const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const fallback = { kind: "preset", id: "orange" }

export function validRef(ref) {
  return !!ref && ["preset", "custom", "event"].includes(ref.kind) && typeof ref.id === "string" && ref.id.length > 0 && ref.id.length <= 160
}

export function validateEvent(event) {
  if (!event || !idPattern.test(event.event_id) || !/^[a-f0-9]{64}$/.test(event.sha256) ||
      !Number.isSafeInteger(event.size) || event.size <= 0 || event.size > 4_000_000 ||
      typeof event.name !== "string" || typeof event.package_url !== "string" ||
      !Number.isFinite(Date.parse(event.start_date)) || !Number.isFinite(Date.parse(event.end_date)) ||
      Date.parse(event.end_date) <= Date.parse(event.start_date)) throw new Error("Invalid event metadata")
  return event
}

export function initialState(selected = fallback) {
  if (!validRef(selected) || selected.kind === "event") selected = fallback
  return { version: 1, selected: { ...selected }, previous: null, active_event: null, events: {}, last_now: 0, clock_offset_ms: 0 }
}

export function restoreState(raw, selected = fallback) {
  if (!raw || raw.version !== 1 || !validRef(raw.selected) || !Number.isFinite(raw.last_now) || !Number.isFinite(raw.clock_offset_ms) ||
      !raw.events || typeof raw.events !== "object" || Array.isArray(raw.events) || Object.keys(raw.events).length > 256) return initialState(selected)
  try {
    if (raw.active_event) validateEvent(raw.active_event)
    if (raw.previous && (!validRef(raw.previous) || raw.previous.kind === "event")) throw new Error("Invalid previous theme")
    for (const [id, record] of Object.entries(raw.events)) {
      if (!idPattern.test(id) || !record || typeof record.is_auto_apply_blocked !== "boolean" || typeof record.auto_considered !== "boolean" ||
          typeof record.was_auto_applied !== "boolean" || !Number.isFinite(Date.parse(record.end_date))) throw new Error("Invalid event state")
    }
    if (raw.selected.kind === "event" && raw.selected.id !== raw.active_event?.event_id) throw new Error("Missing active event")
    return structuredClone(raw)
  } catch { return initialState(selected) }
}

function alive(event, now) { return event && now >= Date.parse(event.start_date) && now < Date.parse(event.end_date) }

/** offered=undefined — offline, null — подтверждённый ответ сервера «ивента нет». */
export function reconcile(input, offered, now, ready, { exists = () => true, defaultTheme = fallback, autoApply = true, deferAutoApply = false } = {}) {
  const state = structuredClone(input)
  now = Math.max(now, state.last_now)
  if (state.active_event || offered !== undefined) state.last_now = now
  const current = state.active_event
  if (current && (!alive(current, now) || offered === null || (offered && offered.event_id !== current.event_id))) {
    if (state.selected.kind === "event" && state.selected.id === current.event_id) {
      state.selected = state.previous && exists(state.previous) ? state.previous : { ...defaultTheme }
    }
    state.previous = null
    state.active_event = null
  }
  if (offered) {
    validateEvent(offered)
    if (alive(offered, now) && ready) {
      state.active_event = structuredClone(offered)
      let record = Object.hasOwn(state.events, offered.event_id) ? state.events[offered.event_id] : undefined
      if (!record) record = state.events[offered.event_id] = { is_auto_apply_blocked: false, auto_considered: false, was_auto_applied: false, end_date: offered.end_date }
      // Ожидающий ручной выбор должен завершиться до оценки автоматики.
      // Это отсрочка, а не отказ и не обработанная попытка применения.
      if (!record.auto_considered && !deferAutoApply) {
        record.auto_considered = true
        if (autoApply && !record.is_auto_apply_blocked && state.selected.kind === "preset") {
          state.previous = { ...state.selected }
          state.selected = { kind: "event", id: offered.event_id }
          record.was_auto_applied = true
        }
      }
    }
  }
  // ID не переиспользуется сервером; после окончания блокировку можно удалить с задержкой.
  for (const [id, record] of Object.entries(state.events)) {
    if (Date.parse(record.end_date) + 30 * 86400_000 < now && id !== state.active_event?.event_id) delete state.events[id]
  }
  return state
}

export function manualSelect(input, ref, now) {
  if (!validRef(ref)) throw new Error("Invalid theme reference")
  const state = structuredClone(input)
  if (ref.kind === "event" && (!alive(state.active_event, now) || ref.id !== state.active_event.event_id)) throw new Error("Event theme is unavailable")
  const same = state.selected.kind === ref.kind && state.selected.id === ref.id
  if (same) return state
  if (state.selected.kind === "event") {
    const record = state.events[state.selected.id]
    if (record?.was_auto_applied) record.is_auto_apply_blocked = true
  }
  if (ref.kind === "event") {
    state.previous = state.selected.kind === "event" ? state.previous : { ...state.selected }
  } else state.previous = null
  state.selected = { ...ref }
  return state
}

export function visibleThemes(presets, customThemes, state, preparedTheme) {
  const standard = presets.map(theme => ({ ...theme, kind: "preset" }))
  if (state.active_event && preparedTheme) standard.push({ ...preparedTheme, id: `event:${state.active_event.event_id}`, kind: "event", event_id: state.active_event.event_id, custom: false })
  return { standard, custom: customThemes.map(theme => ({ ...theme, kind: "custom" })) }
}

export const launcherThemeId = ref => ref.kind === "event" ? `event:${ref.id}` : ref.id
