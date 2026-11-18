const STORAGE_KEY = "xnlc:avatar-version:v1"

/** Перезапуск UI не означает смену скина: ключ живёт столько же, сколько кэш. */
export function readAvatarCacheVersion(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

/** Вызывается только при явном обновлении скина/аватарки. */
export function advanceAvatarCacheVersion(previous: number): number {
  const next = Math.max(Date.now(), previous + 1, readAvatarCacheVersion() + 1)
  try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
  return next
}
