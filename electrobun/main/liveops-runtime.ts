import type { LiveopsStatus, LiveopsThemeRef, Theme } from "@xnlc/types"
import { createEventThemeController } from "../../infrastructure/xnlc-liveops/client/controller.mjs"
import { EVENT_THEME_SETTING, SELECTED_THEME_SETTING, LIVEOPS_AUTO_APPLY_SETTING, refFromThemeId, themeIdFromRef } from "../../lib/liveops-theme-refs"

interface LiveopsPorts {
  baseURL?: string
  storage: Parameters<typeof createEventThemeController>[0]["storage"]
  getSetting: (key: string) => Promise<string | undefined>
  setSettings: (values: Record<string, string>) => void | Promise<void>
  notify: (key: string, value: string) => void
  exists: (ref: LiveopsThemeRef) => boolean
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  now?: () => number
}

/** Адаптер лаунчера: единственный владелец выбора, событийная тема не попадает в customThemes. */
export async function createLauncherLiveops(ports: LiveopsPorts) {
  let selected = refFromThemeId(await ports.getSetting(SELECTED_THEME_SETTING)) ?? { kind: "preset" as const, id: "orange" }
  let stopped = false
  let error: string | undefined
  let controller: Awaited<ReturnType<typeof createEventThemeController>> | undefined
  const enabled = !!ports.baseURL
  const publish = async (ref: LiveopsThemeRef, theme: Theme | null) => {
    if (stopped) return
    const updates = {
      [EVENT_THEME_SETTING]: theme ? JSON.stringify(theme) : "",
      [SELECTED_THEME_SETTING]: themeIdFromRef(ref),
    }
    // Обе настройки записываются атомарно до push-событий renderer.
    await ports.setSettings(updates)
    selected = ref
    for (const [key, value] of Object.entries(updates)) ports.notify(key, value)
  }
  if (enabled) {
    // Холодный старт сначала восстанавливает проверенный диск-кэш без ожидания сети.
    // Обычный tick ниже уже обращается к серверу и обновляет этот снимок.
    let hydrating = true
    try {
      controller = await createEventThemeController({
        baseURL: ports.baseURL!, storage: ports.storage, selected,
        exists: ref => !stopped && ports.exists(ref),
        apply: publish,
        autoApply: async () => !stopped && (await ports.getSetting(LIVEOPS_AUTO_APPLY_SETTING)) !== "false",
        fetcher: async (input, init) => {
          if (hydrating) throw new Error("Cache restore")
          const response = await (ports.fetcher ?? fetch)(input, init)
          if (response.ok && String(input).endsWith("/v1/events/current")) error = undefined
          return response
        },
        now: ports.now ?? Date.now,
        onError: cause => { if (!hydrating) error = cause instanceof Error ? cause.message : String(cause) },
      })
      await controller.tick()
    } catch (cause) {
      // Сломанный origin или файловый кэш не должны блокировать обычные темы.
      error = cause instanceof Error ? cause.message : String(cause)
      controller?.stop()
      controller = undefined
    } finally { hydrating = false }
  }
  if (!controller) {
    if (selected.kind === "event") selected = { kind: "preset", id: "orange" }
    await publish(selected, null)
  }
  const status = (): LiveopsStatus => ({ enabled, selected: themeIdFromRef(selected), ...(error ? { error } : {}) })
  return {
    status,
    async tick() { if (controller && !stopped) { error = undefined; await controller.tick() } },
    async select(ref: LiveopsThemeRef): Promise<LiveopsStatus> {
      const parsed = ref && refFromThemeId(themeIdFromRef(ref))
      if (!parsed || parsed.kind !== ref.kind || parsed.id !== ref.id) throw new Error("Invalid theme reference")
      if (stopped) throw new Error("LiveOps is stopped")
      if (controller) await controller.select(ref)
      else {
        if (ref.kind === "event") throw new Error("Event theme is unavailable")
        await publish(ref, null)
      }
      return status()
    },
    stop() { stopped = true; controller?.stop() },
  }
}
