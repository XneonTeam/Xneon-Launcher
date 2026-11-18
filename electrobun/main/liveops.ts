import path from "node:path"
import type { LiveopsThemeRef } from "@xnlc/types"
import { app, rpcRegistry } from "../platform/desktop"
import { dbHelpers } from "../db"
import { queryAll } from "../db/core"
import { setSettings } from "../db/settings"
import { registerShutdownTask, SHUTDOWN_PRIORITY } from "../platform/shutdown"
import { createFileStorage } from "../../infrastructure/xnlc-liveops/client/file-storage.mjs"
import { createLauncherLiveops } from "./liveops-runtime"
import { sendToRenderer } from "./runtime"
import { SERVICE_URLS } from "@xnlc/urls"

let runtime: Awaited<ReturnType<typeof createLauncherLiveops>> | undefined
let initialization: Promise<void> | undefined
let stopped = false

/** Вызывается после открытия БД; первая сетевая проверка не задерживает splash. */
export function startLiveops(): Promise<void> {
  return initialization ??= (async () => {
    runtime = await createLauncherLiveops({
      baseURL: (process.env.XNLC_LIVEOPS_URL ?? SERVICE_URLS.liveops).trim(),
      storage: createFileStorage(path.join(app.getPath("userData"), "event-theme-cache")),
      getSetting: dbHelpers.getSetting,
      setSettings: values => { if (!stopped) setSettings(values) },
      notify(key, value) {
        if (!stopped) sendToRenderer("settings:updated", { key, value })
      },
      exists(ref) {
        if (stopped) return false
        if (ref.kind !== "custom") return ref.kind === "preset"
        // Синхронный порт модели: читаем актуальные темы, включая удалённые во время ивента.
        const raw = queryAll<{ value: string }>("SELECT value FROM settings WHERE key = ?", ["customThemes"])[0]?.value
        try { return JSON.parse(raw ?? "[]").some((theme: { id?: string }) => theme.id === ref.id) } catch { return false }
      },
    })
    if (stopped) runtime.stop()
    else void runtime.tick().catch(error => console.error("[LiveOps] Synchronization failed", error))
  })()
}

export function selectLiveopsTheme(ref: LiveopsThemeRef) {
  // Не откладываем регистрацию ручного намерения даже на microtask, если main уже готов.
  if (runtime) return runtime.select(ref)
  return startLiveops().then(() => runtime!.select(ref))
}

export function registerLiveopsHandlers(): void {
  rpcRegistry.handle("liveops:status", async () => { await startLiveops(); return runtime!.status() })
  rpcRegistry.handle("liveops:select", (_event, ref) => selectLiveopsTheme(ref))
  registerShutdownTask("liveops", () => { stopped = true; runtime?.stop() }, { priority: SHUTDOWN_PRIORITY.network })
}
