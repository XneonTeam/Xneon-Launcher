import { expect, test } from "bun:test"
import { acknowledgeBuildEdits, BuildWriteQueue, filterStaleBuildPatch } from "../../lib/build-write-queue"

test("подтверждение старого патча не очищает новую правку того же поля", () => {
  expect(acknowledgeBuildEdits({ name: "new", locked: false }, { name: "old", locked: false })).toEqual({ name: "new" })
  expect(acknowledgeBuildEdits({ name: undefined }, { name: undefined })).toEqual({})
})

test("старый debounce не откатывает более новую команду light fields", () => {
  expect(filterStaleBuildPatch({ name: "old", locked: false, mods: [] }, { name: "new", locked: false })).toEqual({ locked: false, mods: [] })
  expect(filterStaleBuildPatch({ name: "old" }, undefined)).toEqual({})
})

test("после main commit устаревший снимок не возвращает loader, сохраняя пользовательские правки", () => {
  const fields = { version: "old", loaderVersion: "47", mods: ["old"], memoryMax: "16G" }
  expect(filterStaleBuildPatch(fields, fields, true)).toEqual({ memoryMax: "16G" })
})

test("семантический MODPACK_BUSY не повторяет отвергнутую версию после обновления", async () => {
  let busy = true
  const writes: Record<string, unknown>[] = []
  const queue = new BuildWriteQueue(async (_id, fields) => {
    if (busy) throw new Error("MODPACK_BUSY")
    writes.push(fields)
  })
  await expect(queue.write("build", { version: "stale" })).rejects.toThrow("MODPACK_BUSY")
  expect(queue.getPending("build")).toEqual({})
  busy = false
  await queue.flush()
  expect(writes).toEqual([])
  await queue.write("build", { version: "explicit-new-intent" })
  expect(writes).toEqual([{ version: "explicit-new-intent" }])
})

test("отказ metadata owner сохраняет пользовательские поля смешанного патча для retry", async () => {
  let busy = true
  const writes: Record<string, unknown>[] = []
  const queue = new BuildWriteQueue(async (_id, fields) => {
    if (busy && "version" in fields) throw new Error("MODPACK_BUSY")
    writes.push(fields)
  })
  await expect(queue.write("build", { version: "stale", memoryMax: "16G", group: "My group" })).rejects.toThrow("MODPACK_BUSY")
  expect(queue.getPending("build")).toEqual({ memoryMax: "16G", group: "My group" })
  busy = false
  await queue.flush()
  expect(writes).toEqual([{ memoryMax: "16G", group: "My group" }])
})

test("подтверждённая main установка инвалидирует отложенные metadata, но сохраняет пользовательские поля", async () => {
  const gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  const writes: Record<string, unknown>[] = []
  const queue = new BuildWriteQueue(async (_id, fields) => {
    writes.push(fields)
    if (writes.length === 1) { started.resolve(); await gate.promise }
  })
  const first = queue.write("build", { description: "User" })
  await started.promise
  const stale = queue.write("build", { version: "old", mods: ["old"], memoryMax: "16G" })
  queue.discardPackMetadata("build")
  gate.resolve()
  await Promise.all([first, stale])
  expect(writes).toEqual([{ description: "User" }, { memoryMax: "16G" }])
})

test("одновременные записи одной сборки сериализованы; более новая побеждает", async () => {
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const writes: Record<string, unknown>[] = []
  const queue = new BuildWriteQueue(async (_id, fields) => {
    writes.push(fields)
    if (writes.length === 1) { started.resolve(); await gate.promise }
  })
  const first = queue.write("a", { name: "old" })
  await started.promise
  const second = queue.write("a", { name: "new" })
  expect(writes).toEqual([{ name: "old" }])
  gate.resolve()
  await Promise.all([first, second])
  expect(writes).toEqual([{ name: "old" }, { name: "new" }])
  expect(queue.getPending("a")).toEqual({})
})

test("сбой persistence не теряет патч; flush повторяет запись без старого значения", async () => {
  let failed = true
  const writes: Record<string, unknown>[] = []
  const queue = new BuildWriteQueue(async (_id, fields) => { if (failed) throw new Error("disk full"); writes.push(fields) })
  await expect(queue.write("a", { name: "old", locked: false })).rejects.toThrow("disk full")
  failed = false
  await queue.write("a", { name: "new" })
  await queue.flush()
  expect(writes).toEqual([{ name: "new", locked: false }])
})

test("сборки не блокируют друг друга; flush после ошибки сохраняет все оставшиеся поля", async () => {
  const gate = Promise.withResolvers<void>()
  const calls: string[] = []
  const queue = new BuildWriteQueue(async id => { if (id === "slow") await gate.promise; calls.push(id) })
  const slow = queue.write("slow", { name: "slow" })
  await queue.write("fast", { name: "fast" })
  expect(calls).toEqual(["fast"])
  gate.resolve()
  await slow
  await queue.flush()
  expect(calls).toEqual(["fast", "slow"])
})

test("stale content отбрасывается перед фактической записью, не при постановке в очередь", async () => {
  const gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>()
  const writes: Record<string, unknown>[] = []
  let valid = true
  const queue = new BuildWriteQueue(async (_id, fields) => { writes.push(fields); started.resolve(); await gate.promise })
  const first = queue.write("a", { name: "Name" })
  await started.promise
  const stale = queue.write("a", { mods: ["removed"] }, () => valid)
  valid = false
  gate.resolve()
  await Promise.all([first, stale])
  expect(writes).toEqual([{ name: "Name" }])
  expect(queue.getPending("a")).toEqual({})
})
