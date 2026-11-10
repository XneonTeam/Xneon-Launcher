import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { test } from "bun:test"
import { PNG } from "pngjs"
import { createThemeBundle, restoreThemeBundle } from "../../electrobun/main/cloud/theme-bundle.ts"

test("a theme transfers its background bytes between profiles", async () => {
  const temp = path.resolve(".tmp")
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(path.join(temp, "theme-background-"))
  try {
    const png = new PNG({ width: 640, height: 480 })
    let state = 1
    for (let i = 0; i < png.data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      png.data[i] = state >>> 24
    }
    const image = PNG.sync.write(png)
    const inline = "data:image/png;base64," + image.toString("base64")
    assert.ok(inline.length > 1024 * 1024)
    const name = createHash("sha256").update(image).digest("hex") + ".png"
    const managed = "xnl-theme://asset/" + name
    const sender = path.join(root, "sender")
    const legacy = path.join(root, "Фон.png")
    await mkdir(sender)
    await writeFile(path.join(sender, name), image)
    await writeFile(legacy, image)
    for (const [index, source] of [inline, managed, legacy].entries()) {
      const receiver = path.join(root, "receiver-" + index)
      const theme = { id: "custom-fixture", name: "Fixture", primary: "#112233", accent: "#445566", background: { kind: "image", source, dim: 0.2 } }
      const imported = await restoreThemeBundle(await createThemeBundle(theme, sender), receiver)
      assert.deepEqual(imported.background, { ...theme.background, source: managed })
      assert.deepEqual(await readFile(path.join(receiver, name)), image)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
