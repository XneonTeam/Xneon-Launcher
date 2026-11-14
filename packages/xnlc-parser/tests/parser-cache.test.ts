import { expect, test } from "bun:test"
import TestZip from "../../../tests/helpers/zip"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ParserCache } from "../src"

test("одновременные запросы объединяются, а отмена одного подписчика изолирована", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-flight-")), path = join(dir, "mod.jar")
  try {
    const zip = new TestZip()
    zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","version":"1"}'))
    await writeFile(path, zip.toBuffer())
    const cache = new ParserCache(2, 0), controller = new AbortController()
    const canceled = cache.analyze(path, { signal: controller.signal })
    const second = cache.analyze(path)
    const third = cache.analyze(path)
    controller.abort()
    await expect(canceled).rejects.toMatchObject({ code: "ABORTED" })
    const [a, b] = await Promise.all([second, third])
    a.mods[0].id = "changed"
    expect(b.mods[0].id).toBe("demo")
    expect(cache.stats.misses).toBe(1)
    expect(cache.usage.bytes).toBe(0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("кэш ограничен, защищён от изменения результата и инвалидируется при изменении файла", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-cache-independent-")), path = join(dir, "mod.jar")
  const write = async (version: string) => { const zip = new TestZip(); zip.addFile("fabric.mod.json", Buffer.from(JSON.stringify({ id: "demo", version }))); await writeFile(path, zip.toBuffer()) }
  try {
    const cache = new ParserCache(1)
    await write("1")
    const first = await cache.analyze(path)
    first.mods[0].version = "modified by consumer"
    expect((await cache.analyze(path)).mods[0].version).toBe("1")
    expect(cache.stats).toEqual({ hits: 1, misses: 1 })
    expect(cache.size).toBe(1)
    await write("version 222")
    expect((await cache.analyze(path)).mods[0].version).toBe("version 222")
    expect(cache.stats).toEqual({ hits: 1, misses: 2 })
    cache.invalidate(path)
    expect(cache.size).toBe(0)
    await cache.analyze(path)
    cache.clear()
    expect(cache.size).toBe(0)
    const pending = cache.analyze(path)
    cache.invalidate(path)
    await pending
    expect(cache.size).toBe(0)
    const controller = new AbortController(); controller.abort()
    await expect(cache.analyze(path, { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("кэш отделяет параметры анализа и допускает полное отключение", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-cache-limits-")), path = join(dir, "mod.jar")
  try {
    const zip = new TestZip(); zip.addFile("fabric.mod.json", Buffer.from('{"id":"demo","version":"1"}')); await writeFile(path, zip.toBuffer())
    const cache = new ParserCache(2)
    await cache.analyze(path)
    const options = { limits: { maxMetadataSize: 2 } }
    const pending = cache.analyze(path, options)
    options.limits.maxMetadataSize = 1000
    const limited = await pending
    expect(limited.diagnostics[0]?.code).toBe("LIMIT_EXCEEDED")
    // Результат с диагностикой не закрепляется в кэше.
    expect(cache.size).toBe(1)
    const disabled = new ParserCache(0)
    await disabled.analyze(path)
    expect(disabled.size).toBe(0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
