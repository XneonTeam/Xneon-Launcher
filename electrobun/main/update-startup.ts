import type { InstalledUpdateIdentity, SdkUpdateRoot, UpdateStateStore } from "./update-state"

/** Только явно отложенное обновление; проверка и применение до открытия БД и окна. */
export async function resumeDeferredUpdate(options: {
  local: InstalledUpdateIdentity; sdkRoot: SdkUpdateRoot
  store: Pick<UpdateStateStore, "peek" | "clearPending">
  launchInstaller: (file: string) => Promise<void>
  applySdk: () => Promise<void>; quit: () => Promise<void>; onError: (error: unknown) => void
}): Promise<boolean> {
  let consumed = false
  try {
    const pending = await options.store.peek(options.local, options.sdkRoot)
    if (!pending?.deferred) return false
    // Однократная попытка: сбой установщика не должен зациклить старт приложения.
    await options.store.clearPending()
    consumed = true
    if (pending.kind === "installer") await options.launchInstaller(pending.path!)
    else await options.applySdk()
    await options.quit()
    return true
  } catch (error) {
    options.onError(error)
    if (!consumed) { try { await options.store.clearPending() } catch {} }
    return false
  }
}
