import { expect, test } from "bun:test"
import AdmZip from "adm-zip"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeDatapack } from "@xnlc/parser"
import { installServerDatapack } from "../../electrobun/main/server-datapacks"

test("сервер устанавливает датапак после проверки XNLC", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xnlc-server-datapack-"))
  try {
    const zip = new AdmZip()
    zip.addFile("pack.mcmeta", Buffer.from('{"pack":{"pack_format":48,"description":"Example"}}'))
    zip.addFile("data/example/test.json", Buffer.from("{}"))
    await installServerDatapack(dir, "example.zip", zip.toBuffer())
    expect((await analyzeDatapack(join(dir, "example.zip"))).format).toBe("datapack")
    await expect(installServerDatapack(dir, "bad.zip", Buffer.from("broken"))).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
