import { createHash } from "node:crypto"
import { validRef, restoreState, reconcile, manualSelect, validateEvent, visibleThemes } from "./model.mjs"
import { prepareTheme } from "./package.mjs"

const hash = bytes => createHash("sha256").update(bytes).digest("hex")

export async function limitedResponse(response, limit) {
  const length = response.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error("Response exceeds size limit")
  if (!response.body) throw new Error("Response has no body")
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new Error("Response exceeds size limit")
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, total)
  } finally { await reader.cancel().catch(() => {}) }
}

/** Выполняется в main Bun/Node, не в renderer. storage — отдельный event-cache, не customThemes. */
export async function createEventThemeController({ baseURL, storage, selected, apply, exists = () => true,
  fetcher = fetch, now = Date.now, onError = () => {}, defaultTheme = { kind: "preset", id: "orange" } }) {
  const origin = new URL(baseURL)
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("Use HTTPS for live-ops themes")
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Expected a trusted service origin")
  let state = restoreState(await storage.loadState(), selected)
  let prepared = null
  let cachedDigest = null
  let queue = Promise.resolve()
  let timer
  let stopped = false
  let generation = 0
  const clock = () => Math.max(state.last_now, now() + state.clock_offset_ms)
  const serial = operation => {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }
  async function save(next) {
    // Сначала надёжное сохранение состояния, затем применение: отказ переживает перезапуск.
    await storage.saveState(next)
    state = next
    await apply({ ...state.selected }, prepared)
  }
  async function loadPackage(event, online) {
    const url = new URL(event.package_url)
    if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash || url.pathname !== `/v1/packages/${event.sha256}.json`) throw new Error("Untrusted package URL")
    let bytes = await storage.readPackage(event.sha256)
    if (!bytes || bytes.length !== event.size || hash(bytes) !== event.sha256) {
      bytes = null
      if (!online) return false
      const response = await fetcher(url.href, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`Event download failed: ${response.status}`)
      bytes = await limitedResponse(response, event.size)
      if (bytes.length !== event.size || hash(bytes) !== event.sha256) throw new Error("Event SHA-256/size mismatch")
      const theme = prepareTheme(JSON.parse(bytes.toString("utf8")), event.event_id)
      await storage.writePackage(event.sha256, bytes)
      prepared = theme
    } else prepared = prepareTheme(JSON.parse(bytes.toString("utf8")), event.event_id)
    cachedDigest = event.sha256
    return true
  }
  async function synchronize() {
    if (stopped) return
    const expired = reconcile(state, undefined, clock(), false, { exists, defaultTheme })
    if (!expired.active_event && state.active_event) {
      prepared = null
      cachedDigest = null
      await save(expired) // Снимаем истёкшую тему до сетевого ожидания, в том числе офлайн.
      await storage.prunePackages(null)
    }
    let offered
    let nextCheck = clock() + 300_000
    try {
      const response = await fetcher(new URL("/v1/events/current", origin).href, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`Event config failed: ${response.status}`)
      const data = JSON.parse((await limitedResponse(response, 16_000)).toString("utf8"))
      const serverTime = Date.parse(data.server_time)
      nextCheck = Date.parse(data.next_check_at)
      if (data.version !== 1 || !Number.isFinite(serverTime) || !Number.isFinite(nextCheck) || !("active_event" in data)) throw new Error("Invalid event config")
      if (data.active_event !== null) validateEvent(data.active_event)
      state.clock_offset_ms = serverTime - now()
      offered = data.active_event
    } catch (error) { onError(error) } // Offline не равен отзыву ивента.
    const time = clock()
    const candidate = offered === undefined ? state.active_event : offered
    if (candidate?.sha256 !== cachedDigest) prepared = null
    let ready = false
    if (candidate && time >= Date.parse(candidate.start_date) && time < Date.parse(candidate.end_date)) {
      try { ready = await loadPackage(candidate, offered !== undefined) }
      catch (error) { onError(error) }
    }
    let next = reconcile(state, offered, time, ready, { exists, defaultTheme })
    if (candidate && !ready && next.selected.kind === "event") {
      next.selected = next.previous && exists(next.previous) ? { ...next.previous } : { ...defaultTheme }
      next.previous = null
    }
    if (!next.active_event) { prepared = null; cachedDigest = null }
    await save(next)
    await storage.prunePackages(cachedDigest)
    const currentGeneration = ++generation
    clearTimeout(timer)
    if (!stopped) {
      const end = state.active_event ? Date.parse(state.active_event.end_date) : Infinity
      // Таймер end_date работает и без сети; проверка повторяется также при wake/start.
      const delay = Math.max(250, Math.min(300_000, nextCheck - time, end - time))
      timer = setTimeout(() => { if (currentGeneration === generation) void api.tick().catch(onError) }, delay)
      timer.unref?.()
    }
  }
  const api = {
    tick: () => serial(synchronize),
    select: ref => serial(async () => {
      if (!validRef(ref)) throw new Error("Invalid selection")
      if (ref.kind === "event" && !prepared) throw new Error("Event package is unavailable")
      await save(manualSelect(state, ref, clock()))
    }),
    snapshot: () => structuredClone(state),
    themes: (presets, custom) => visibleThemes(presets, custom, state, prepared),
    stop() { stopped = true; generation++; clearTimeout(timer) },
  }
  return api
}
