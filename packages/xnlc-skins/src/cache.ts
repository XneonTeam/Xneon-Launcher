// ============================================================
// @xnlc/skins — кэш
// ============================================================
//
// Один кэш вместо трёх прежних (память + дисковые JSON + отдельный индекс
// тегов): у них была одна задача — не ходить в сеть повторно, — а жили они
// порознь и с разными правилами.
//
// Два уровня, каждый со своей ролью:
//   • память — TTL, чтобы один и тот же запрос не уходил дважды за сессию;
//   • диск   — последнее удачное значение, чтобы каталог открывался офлайн.
//
// Память ограничена по числу записей: ключ страницы включает `order`, `size` и
// `offset`, и без предела кэш рос бы всю сессию. Вытесняется самый старый.

import type { SkinDiskCache } from "./ports.js"

/** Сколько записей держим в памяти. 25-страничный каталог укладывается с запасом. */
const MAX_MEMORY_ENTRIES = 256

type MemoryEntry = { at: number; data: unknown }

export type CachePolicy = {
  /** Через сколько миллисекунд запись считается устаревшей. */
  ttl: number
  /** Дублировать удачный результат на диск (офлайн-режим). */
  disk?: boolean
}

export class SkinCache {
  private readonly memory = new Map<string, MemoryEntry>()

  constructor(private readonly disk?: SkinDiskCache) {}

  /**
   * Значение из кэша, иначе `load()`.
   *
   * Ошибку загрузки не глотаем: вызывающая сторона сама решает, показать
   * ошибку или вернуться к `stale()`.
   */
  async json<T>(key: string, policy: CachePolicy, load: () => Promise<T>): Promise<T> {
    const hit = this.memory.get(key)
    if (hit && Date.now() - hit.at < policy.ttl) return hit.data as T

    const data = await load()
    this.remember(key, data)
    if (policy.disk) void this.writeJson(key, data)
    return data
  }

  /** Последнее удачное значение, даже просроченное. Для офлайн-режима. */
  async stale<T>(key: string): Promise<T | null> {
    const hit = this.memory.get(key)
    if (hit) return hit.data as T
    if (!this.disk) return null
    const raw = await this.disk.read(`${key}.json`).catch(() => null)
    if (!raw) return null
    try {
      const data = JSON.parse(new TextDecoder().decode(raw)) as T
      this.remember(key, data)
      return data
    } catch {
      return null
    }
  }

  /**
   * Двоичные данные по неизменяемому ключу (текстуры: `image_hash` — это хэш
   * содержимого, одна и та же текстура не меняется никогда).
   *
   * Держим и в памяти: размер записи ограничен 256 значениями, а текстура
   * скина — единицы килобайт, зато повторный импорт того же скина не читает
   * файл с диска.
   */
  async binary(key: string, load: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    const inMemory = this.memory.get(key)
    if (inMemory) return inMemory.data as Uint8Array

    const cached = await this.disk?.read(key).catch(() => null)
    if (cached && cached.byteLength > 0) {
      this.remember(key, cached)
      return cached
    }

    const data = await load()
    if (data) {
      this.remember(key, data)
      void this.disk?.write(key, data).catch(() => {})
    }
    return data
  }

  clear(): void {
    this.memory.clear()
  }

  private remember(key: string, data: unknown): void {
    this.memory.delete(key)
    this.memory.set(key, { at: Date.now(), data })
    while (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next()
      if (oldest.done) break
      this.memory.delete(oldest.value)
    }
  }

  private async writeJson(key: string, data: unknown): Promise<void> {
    if (!this.disk) return
    try {
      await this.disk.write(`${key}.json`, new TextEncoder().encode(JSON.stringify(data)))
    } catch {
      // Кэш вспомогательный: не смогли записать — работаем дальше.
    }
  }
}

/**
 * Именованный набор записей с ограничением по количеству и вытеснением
 * самого старого. Нужен пулам каталога: каждый тег заводит свой пул на 500
 * скинов, и без предела они копились бы, пока открыт лаунчер.
 */
export class BoundedMap<V> {
  private readonly items = new Map<string, V>()

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.items.get(key)
    // Обращение делает запись «свежей»: вытесняем то, чем давно не пользовались.
    if (value !== undefined) {
      this.items.delete(key)
      this.items.set(key, value)
    }
    return value
  }

  set(key: string, value: V): void {
    this.items.delete(key)
    this.items.set(key, value)
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next()
      if (oldest.done) break
      this.items.delete(oldest.value)
    }
  }

  values(): V[] {
    return [...this.items.values()]
  }

  get size(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }
}