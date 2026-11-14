import { expect, test } from "bun:test"
import TestZip from "../../../tests/helpers/zip"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeDatapack } from "../src"

test("читает ZIP датапак с современным диапазоном и пространствами имён", async () => {
  const zip = new TestZip()
  zip.addFile("pack.mcmeta", Buffer.from(JSON.stringify({ pack: { description: { text: "Example" }, min_format: [88, 0], max_format: [90, 2] }, overlays: { entries: [{ directory: "extra", min_format: 88, max_format: 90 }] }, features: { enabled: ["minecraft:trade_rebalance"] } })))
  zip.addFile("data/example/function/main.mcfunction", Buffer.from("say hello"))
  zip.addFile("data/minecraft/tags/function/load.json", Buffer.from("{}"))
  const result = await analyzeDatapack(zip.toBuffer())
  expect(result.format).toBe("datapack")
  expect(result.namespaces).toEqual(["example", "minecraft"])
  expect(result.minFormat).toEqual([88, 0])
  expect(result.maxFormat).toEqual([90, 2])
  expect(result.overlays).toBeDefined()
  expect(result.features).toBeDefined()
  expect(result.description).toEqual({ text: "Example" })
})

test("разбирает распакованный и гибридный пак", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-datapack-"))
  try {
    const folder = join(dir, "pack")
    await mkdir(join(folder, "data", "example"), { recursive: true })
    await mkdir(join(folder, "assets", "example"), { recursive: true })
    await writeFile(join(folder, "pack.mcmeta"), '{"pack":{"pack_format":48,"supported_formats":[48,61],"description":"Example"}}')
    const result = await analyzeDatapack(folder)
    expect(result.format).toBe("hybridpack")
    expect(result.namespaces).toEqual(["example"])
    expect(result.supportedFormats).toEqual([48, 61])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("отклоняет отсутствующий или некорректный pack.mcmeta и учитывает отмену", async () => {
  for (const value of ['{}', '{"pack":[]}', '{broken']) {
    const zip = new TestZip()
    zip.addFile("pack.mcmeta", Buffer.from(value))
    await expect(analyzeDatapack(zip.toBuffer())).rejects.toThrow()
  }
  const zip = new TestZip()
  zip.addFile("nested/pack.mcmeta", Buffer.from('{"pack":{}}'))
  await expect(analyzeDatapack(zip.toBuffer())).rejects.toThrow()
  const controller = new AbortController()
  controller.abort()
  await expect(analyzeDatapack(zip.toBuffer(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
})
