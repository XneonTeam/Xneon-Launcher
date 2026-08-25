// ============================================================
// Stale-While-Revalidate cache (по образцу app-lib/state/cache.rs из Theseus)
// - fresh entry  → возвращаем сразу, без сети
// - stale entry  → возвращаем устаревшее немедленно, фоном обновляем
// - no entry     → выполняем fetcher и ждём результат
// ============================================================

export type SwrOptions = {
  /** Время жизни записи в мс. По умолчанию 30_000. */
  ttl?: number
  /** `Infinity` — запись никогда не считается устаревшей. */
  immutable?: boolean
  /** Сохранять в localStorage. Ключ — `swr:${key}`. */
  persist?: boolean
}

type Entry<T> = {
  value: T
  fetchedAt: number
  inflight?: Promise<T>
}

const STORAGE_PREFIX = "swr:"

function loadPersisted<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { value: T; fetchedAt: number }
    if (!parsed.value || typeof parsed.fetchedAt !== "number") return null
    return parsed
  } catch {
    return null
  }
}

function savePersisted<T>(key: string, entry: Entry<T>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ value: entry.value, fetchedAt: entry.fetchedAt }))
  } catch {}
}

function removePersisted(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {}
}

/** Очистка устаревших записей из localStorage (запускается разово). */
function gcPersistedStorage(): void {
  try {
    const now = Date.now()
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw) as { fetchedAt: number }
        // Удаляем записи старше 1 часа (на случай долгого хранения)
        if (now - (parsed.fetchedAt ?? 0) > 3_600_000) {
          localStorage.removeItem(k)
        }
      } catch {
        localStorage.removeItem(k)
      }
    }
  } catch {}
}

// Запускаем GC при загрузке модуля
if (typeof window !== "undefined") {
  try { gcPersistedStorage() } catch {}
}

class SwrCache {
  private store = new Map<string, Entry<unknown>>()

  getOrFetch<T>(key: string, fetcher: () => T | Promise<T>, options: SwrOptions = {}): Promise<T> {
    const ttl = options.immutable ? Infinity : (options.ttl ?? 30_000)
    const now = Date.now()

    // Попытка загрузить из localStorage если есть persist и нет в памяти
    let existing = this.store.get(key) as Entry<T> | undefined
    if (!existing && options.persist) {
      const persisted = loadPersisted<T>(key)
      if (persisted) {
        this.store.set(key, persisted as Entry<unknown>)
        existing = persisted
      }
    }

    if (existing) {
      const fresh = now - existing.fetchedAt < ttl
      if (fresh) {
        return Promise.resolve(existing.value)
      }
      // Устаревшие данные: отдаём немедленно и обновляем фоном.
      if (!existing.inflight) {
        existing.inflight = Promise.resolve(fetcher())
          .then(value => {
            if (value != null) existing!.value = value
            existing!.fetchedAt = Date.now()
            if (options.persist) savePersisted(key, existing!)
            return value ?? existing!.value
          })
          .finally(() => {
            existing!.inflight = undefined
          })
          .catch(() => existing!.value)
        void existing.inflight
      }
      return Promise.resolve(existing.value)
    }

    const inflight = Promise.resolve(fetcher())
      .then(value => {
        if (value != null) {
          const entry: Entry<T> = { value, fetchedAt: Date.now() }
          this.store.set(key, entry as Entry<unknown>)
          if (options.persist) savePersisted(key, entry)
        }
        return value
      })
      .catch(error => {
        this.store.delete(key)
        if (options.persist) removePersisted(key)
        throw error
      })
      .finally(() => {
        const current = this.store.get(key)
        if (current) current.inflight = undefined
      })

    this.store.set(key, { value: undefined as unknown, fetchedAt: 0, inflight })
    return inflight
  }

  invalidate(key: string): void {
    this.store.delete(key)
    removePersisted(key)
  }

  clear(): void {
    this.store.clear()
    // Очищаем только swr: записи из localStorage
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(STORAGE_PREFIX)) keysToRemove.push(k)
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
  }
}

/** Глобальный кэш для данных, получаемых через IPC. */
export const dataCache = new SwrCache()

/** Максимальное время жизни «свежести» для данных, которые могут меняться. */
export const STALE_SEARCH_MS = 30_000

/** TTL для кеширования поиска модов (10 минут). */
export const MOD_SEARCH_CACHE_TTL = 10 * 60 * 1000
