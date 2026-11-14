import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { packArchiveSync } from "../../packages/xnlc-archives/src/index"
import { analyzeServerJar } from "../../packages/xnlc-servers/src/jar-analyzer"
import { analyze } from "../../packages/xnlc-parser/src/index"

for (const loader of ["fabric", "forge", "neoforge"] as const) {
  test(`общие ${loader} metadata одинаково читаются server analyzer и content parser`, async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-metadata-parity-"))
    try {
      const name = loader === "fabric" ? "fabric.mod.json" : loader === "forge" ? "META-INF/mods.toml" : "META-INF/neoforge.mods.toml"
      const data = loader === "fabric" ? JSON.stringify({ id: "demo", version: "1", depends: { minecraft: ">=1.20.1" } })
        : `modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="demo"\nversion="1"\n[[dependencies.demo]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20.1,1.21)"\n`
      const bytes = packArchiveSync({ [name]: Buffer.from(data) })
      const file = path.join(root, "server.jar")
      await fs.writeFile(file, bytes)
      const server = await analyzeServerJar(file), content = await analyze(bytes)
      expect(server.loaderId).toBe(loader)
      expect(server.modId).toBe(content.mods.find(mod => mod.loader === loader)?.id ?? null)
      expect(server.minecraftVersion).toBe("1.20.1")
      expect(content.mods.find(mod => mod.loader === loader)?.minecraftVersions?.some(value => value.includes("1.20.1"))).toBe(true)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
}

test("нестроковый Fabric modId не превращается в валидную серверную идентичность", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-invalid-metadata-"))
  try {
    const bytes = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":42,"version":"1"}') })
    const file = path.join(root, "server.jar")
    await fs.writeFile(file, bytes)
    const content = await analyze(bytes), server = await analyzeServerJar(file)
    expect(server.modId).toBe(content.mods[0]?.id ?? null)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
