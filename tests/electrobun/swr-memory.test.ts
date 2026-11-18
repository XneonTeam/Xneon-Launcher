import { describe, expect, test } from "bun:test"
import { dataCache } from "../../lib/swr"

// Экземпляр изолирован этим файлом; внутреннее хранилище читается только в тесте.
const store = (dataCache as unknown as { store: Map<string, unknown> }).store

describe("SWR: ограниченное удержание результатов", () => {
  test("после 600 поисков старые записи вытесняются, горячие остаются", async () => {
    for (let i = 0; i < 600; i++) {
      await dataCache.getOrFetch(`unique:${i}`, () => ({ id: i }), { immutable: true })
      await dataCache.getOrFetch("hot", () => "hot", { immutable: true })
    }
    expect(store.size).toBeLessThanOrEqual(128)
    expect(store.has("unique:0")).toBe(false)
    expect(store.has("hot")).toBe(true)
  })

  test("один большой ответ не остаётся в кеше, но возвращается потребителю", async () => {
    const big = "x".repeat(17 * 1024 * 1024)
    expect(await dataCache.getOrFetch("oversize", () => big)).toBe(big)
    expect(store.has("oversize")).toBe(false)
    expect(store.has("hot")).toBe(true)
  })

  test("устаревшее значение доступно офлайн; revalidation разделяется", async () => {
    await dataCache.getOrFetch("stale", () => "saved", { ttl: 0 })
    let calls = 0
    const offline = () => { calls++; throw new Error("offline") }
    const a = dataCache.getOrFetch("stale", offline, { ttl: 0 })
    const b = dataCache.getOrFetch("stale", offline, { ttl: 0 })
    expect(await a).toBe("saved")
    expect(await b).toBe("saved")
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    expect(store.has("stale")).toBe(true)
  })

  test("параллельные потребители ждут один запрос, в том числе под давлением кеша", async () => {
    const gate = Promise.withResolvers<number>()
    let calls = 0
    const fetcher = () => { calls++; return gate.promise }
    const first = dataCache.getOrFetch("pending", fetcher)
    for (let i = 0; i < 160; i++) await dataCache.getOrFetch(`pressure:${i}`, () => i)
    const second = dataCache.getOrFetch("pending", fetcher)
    gate.resolve(42)
    expect(await first).toBe(42)
    expect(await second).toBe(42)
    expect(calls).toBe(1)
    expect(store.size).toBeLessThanOrEqual(128)
  })

  test("invalidate во время запроса не воскрешает старый ответ", async () => {
    const gate = Promise.withResolvers<string>()
    const first = dataCache.getOrFetch("race", () => gate.promise)
    dataCache.invalidate("race")
    await dataCache.getOrFetch("race", () => "new")
    gate.resolve("old")
    expect(await first).toBe("old")
    expect(await dataCache.getOrFetch("race", () => "wrong")).toBe("new")
  })
})
