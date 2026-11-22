import type { InstalledUpdateIdentity, UpdateStateStore } from "./update-state"

/**
 * Только явно отложенное обновление; проверка и применение до открытия БД и окна.
 * Windows-сборка применяет единственный вид pending — подписанный NSIS-установщик.
 */
export async function resumeDeferredUpdate(options: {
  local: InstalledUpdateIdentity
  store: Pick<UpdateStateStore, "peek" | "clearPending">
  launchInstaller: (file: string) => Promise<void>
  quit: () => Promise<void>; onError: (error: unknown) => void
}): Promise<boolean> {
  let consumed = false
  try {
    const pending = await options.store.peek(options.local)
    if (!pending?.deferred) return false
    // Однократная попытка: сбой установщика не должен зациклить старт приложения.
    await options.store.clearPending()
    consumed = true
    await options.launchInstaller(pending.path)
    await options.quit()
    return true
  } catch (error) {
    options.onError(error)
    if (!consumed) { try { await options.store.clearPending() } catch {} }
    return false
  }
}