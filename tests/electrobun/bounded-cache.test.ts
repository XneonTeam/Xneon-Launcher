import { expect, test } from "bun:test"
import { BoundedCache, estimateCacheBytes } from "../../lib/bounded-cache"

test("LRU ограничен числом и весом; повторный set и delete не искажают бюджет", () => {
  const cache = new BoundedCache<string, string>({ capacity: 3, maxWeight: 6, weight: value => value.length })
  cache.set("a", "aa").set("b", "bb").set("c", "cc")
  cache.get("a")
  cache.set("d", "dd")
  expect(cache.has("b")).toBe(false)
  expect(cache.weight).toBe(6)
  cache.set("a", "aaaa")
  expect(cache.size).toBe(2)
  cache.delete("a")
  expect(cache.weight).toBe(2)
  cache.set("huge", "x".repeat(100))
  expect(cache.has("huge")).toBe(false)
})

test("отрицательные результаты истекают и могут быть запрошены повторно", () => {
  let now = 0
  const cache = new BoundedCache<string, undefined>({ capacity: 10, ttlMs: 30, now: () => now })
  cache.set("negative", undefined)
  expect(cache.has("negative")).toBe(true)
  now = 31
  expect(cache.has("negative")).toBe(false)
  cache.set("negative", undefined)
  expect(cache.has("negative")).toBe(true)
})

test("оценка учитывает большие иконки без создания сериализованного снимка", () => {
  expect(estimateCacheBytes({ icon: "x".repeat(10000) })).toBeGreaterThan(20000)
  const cycle: { self?: object } = {}
  cycle.self = cycle
  expect(estimateCacheBytes(cycle)).toBeLessThan(100)
})
