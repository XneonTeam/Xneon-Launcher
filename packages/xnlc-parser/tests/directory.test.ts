import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeDirectory } from "../src"

test("читает распакованные ресурспак и шейдеры, ограничивая metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-pack-"))
  try {
    await writeFile(join(dir, "pack.mcmeta"), '{"pack":{"pack_format":15,"description":"Example"}}')
    await writeFile(join(dir, "pack.png"), "image")
    await mkdir(join(dir, "shaders"))
    await mkdir(join(dir, "assets"))
    const result = await analyzeDirectory(dir)
    expect(result.formats).toEqual(["resourcepack", "shaderpack"])
    expect(result.mods[0]).toMatchObject({ version: "15", description: "Example", iconPath: "pack.png" })
    const limited = await analyzeDirectory(dir, { limits: { maxMetadataSize: 5 } })
    expect(limited.diagnostics).toMatchObject([{ code: "LIMIT_EXCEEDED", source: "pack.mcmeta" }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
