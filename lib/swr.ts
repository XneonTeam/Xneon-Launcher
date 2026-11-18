import { estimateCacheBytes } from "./bounded-cache"

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
  bytes?: number
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

  // Бюджет только повторно получаемых данных, не пользовательского состояния.
  // immutable запрещает revalidation, но не вытеснение из памяти.
  private trim(): void {
    let bytes = 0
    let settled = 0
    for (const [key, entry] of this.store) {
      if (!entry.inflight && (entry.bytes ?? 0) > 32 * 1024 * 1024) {
        this.store.delete(key)
        continue
      }
      bytes += entry.bytes ?? 0
      if (!entry.inflight) settled++
    }
    for (const [key, entry] of this.store) {
      if (settled <= 128 && bytes <= 32 * 1024 * 1024) break
      // Не обрываем deduplication активных запросов; их finally повторит trim.
      if (entry.inflight) continue
      this.store.delete(key)
      bytes -= entry.bytes ?? 0
      settled--
    }
  }

  private weigh(entry: Entry<unknown>): void {
    entry.bytes = estimateCacheBytes(entry.value)
  }

  getOrFetch<T>(key: string, fetcher: () => T | Promise<T>, options: SwrOptions = {}): Promise<T> {
    const ttl = options.immutable ? Infinity : (options.ttl ?? 30_000)
    const now = Date.now()

    // Попытка загрузить из localStorage если есть persist и нет в памяти
    let existing = this.store.get(key) as Entry<T> | undefined
    if (!existing && options.persist) {
      const persisted = loadPersisted<T>(key)
      if (persisted) {
        this.weigh(persisted)
        this.store.set(key, persisted as Entry<unknown>)
        this.trim()
        existing = persisted
      }
    }

    if (existing) {
      // Обращение продлевает приоритет LRU, но не свежесть данных.
      if (this.store.has(key)) {
        this.store.delete(key)
        this.store.set(key, existing)
      }
      // На холодном ключе value ещё нет: все потребители ждут тот же запрос.
      if (existing.value === undefined && existing.inflight) return existing.inflight
      const fresh = now - existing.fetchedAt < ttl
      if (fresh) {
        return Promise.resolve(existing.value)
      }
      // Устаревшие данные: отдаём немедленно и обновляем фоном.
      if (!existing.inflight) {
        existing.inflight = Promise.resolve().then(fetcher)
          .then(value => {
            if (this.store.get(key) !== existing) return value ?? existing!.value
            if (value != null) existing!.value = value
            this.weigh(existing!)
            existing!.fetchedAt = Date.now()
            if (options.persist) savePersisted(key, existing!)
            return value ?? existing!.value
          })
          .finally(() => {
            existing!.inflight = undefined
            this.trim()
          })
          .catch(() => existing!.value)
        void existing.inflight
      }
      return Promise.resolve(existing.value)
    }

    const entry: Entry<T> = { value: undefined as T, fetchedAt: 0 }
    const inflight = Promise.resolve().then(fetcher)
      .then(value => {
        if (value != null && this.store.get(key) === entry) {
          entry.value = value
          this.weigh(entry)
          entry.fetchedAt = Date.now()
          if (options.persist) savePersisted(key, entry)
        } else if (value == null && this.store.get(key) === entry) {
          this.store.delete(key)
        }
        return value
      })
      .catch(error => {
        if (this.store.get(key) === entry) {
          this.store.delete(key)
          if (options.persist) removePersisted(key)
        }
        throw error
      })
      .finally(() => {
        const current = this.store.get(key)
        if (current === entry) current.inflight = undefined
        this.trim()
      })

    entry.inflight = inflight
    this.store.set(key, entry as Entry<unknown>)
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
