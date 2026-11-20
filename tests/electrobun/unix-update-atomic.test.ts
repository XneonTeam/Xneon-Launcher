import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { exchangeUnixUpdatePaths, probeUnixUpdateExchange } from "../../electrobun/main/unix-update-atomic"

const nativeTest = process.platform === "win32" ? test.skip : test
nativeTest("native exchange меняет две directory entries и сохраняет обе версии", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-exchange-test-")), a = path.join(root, "A.app"), b = path.join(root, "B.app")
  try {
    await mkdir(a); await mkdir(b); await writeFile(path.join(a, "version"), "A"); await writeFile(path.join(b, "version"), "B")
    await probeUnixUpdateExchange(root)
    exchangeUnixUpdatePaths(a, b)
    expect(await readFile(path.join(a, "version"), "utf8")).toBe("B")
    expect(await readFile(path.join(b, "version"), "utf8")).toBe("A")
  } finally { await rm(root, { recursive: true, force: true }) }
})
