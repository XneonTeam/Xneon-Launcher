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
}

type Entry<T> = {
  value: T
  fetchedAt: number
  inflight?: Promise<T>
}

class SwrCache {
  private store = new Map<string, Entry<unknown>>()

  getOrFetch<T>(key: string, fetcher: () => T | Promise<T>, options: SwrOptions = {}): Promise<T> {
    const ttl = options.immutable ? Infinity : (options.ttl ?? 30_000)
    const existing = this.store.get(key) as Entry<T> | undefined
    const now = Date.now()

    if (existing) {
      const fresh = now - existing.fetchedAt < ttl
      if (fresh) {
        return Promise.resolve(existing.value)
      }
      // Устаревшие данные: отдаём немедленно и обновляем фоном.
      if (!existing.inflight) {
        existing.inflight = Promise.resolve(fetcher())
          .then(value => {
            if (value != null) existing.value = value
            existing.fetchedAt = Date.now()
            return value ?? existing.value
          })
          .finally(() => {
            existing.inflight = undefined
          })
          .catch(() => existing.value)
        void existing.inflight
      }
      return Promise.resolve(existing.value)
    }

    const inflight = Promise.resolve(fetcher())
      .then(value => {
        if (value != null) {
          this.store.set(key, { value, fetchedAt: Date.now() })
        }
        return value
      })
      .catch(error => {
        this.store.delete(key)
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
  }

  clear(): void {
    this.store.clear()
  }
}

/** Глобальный кэш для данных, получаемых через IPC. */
export const dataCache = new SwrCache()

/** Максимальное время жизни «свежести» для данных, которые могут меняться. */
export const STALE_SEARCH_MS = 30_000
