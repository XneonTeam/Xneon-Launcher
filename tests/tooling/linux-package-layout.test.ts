import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, symlink, readlink, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { stageRoot } from "../../scripts/package-linux"

test("упаковка Linux сохраняет относительный CEF symlink без привязки к build runner", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "xneon-package-layout-"))
  try {
    const source = path.join(work, "extracted")
    const app = "XneonLauncher"
    const payload = path.join(source, app)
    await mkdir(path.join(payload, "bin/cef"), { recursive: true })
    await mkdir(path.join(payload, "Resources"))
    for (const file of ["bin/launcher", "bin/bun", "bin/cef/libcef.so", "Resources/version.json"]) await writeFile(path.join(payload, file), "fixture")
    await symlink("cef/libcef.so", path.join(payload, "bin/libcef.so"))
    const root = await stageRoot(source, path.join(work, "stage"), app)
    const link = await readlink(path.join(root, "opt/xneon-launcher/bin/libcef.so"))
    expect(link.replaceAll("\\", "/")).toBe("cef/libcef.so")
  } finally { await rm(work, { recursive: true, force: true }) }
})
