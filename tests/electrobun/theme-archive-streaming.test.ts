import { expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { createThemeBundle, restoreThemeBundle } from "../../electrobun/main/cloud/theme-bundle"
import { archiveService } from "../../electrobun/main/archives/service"
import { packArchiveSync } from "../../packages/xnlc-archives/src/index"

test("тема экспортируется прямо в файл через архивный фасад", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-theme-stream-"))
  const pack = spyOn(archiveService, "pack")
  try {
    const bytes = Buffer.from("theme background fixture")
    const name = `${createHash("sha256").update(bytes).digest("hex")}.png`
    await writeFile(path.join(root, name), bytes)
    const output = path.join(root, "theme.xntheme")
    const theme = { id: "fixture", name: "Fixture", primary: "#112233", accent: "#445566", background: { kind: "image", source: `xnl-theme://asset/${name}` } }
    await createThemeBundle(theme, root, output)
    expect(pack).toHaveBeenCalledTimes(1)
    expect((await readFile(output)).length).toBeGreaterThan(0)
    const restored = await restoreThemeBundle(output, path.join(root, "restored"))
    expect(restored.id).toBe("fixture")
    expect(await readFile(path.join(root, "restored", name))).toEqual(bytes)
  } finally {
    pack.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

test("импорт темы распаковывает медиа через фасад и не устанавливает повреждённые файлы", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-theme-checksum-"))
  const extract = spyOn(archiveService, "extract")
  try {
    const name = `${"a".repeat(64)}.png`
    const destination = path.join(root, "media")
    await mkdir(destination)
    const theme = { id: "fixture", name: "Fixture", primary: "#112233", accent: "#445566" }
    const bytes = packArchiveSync({ "theme.json": Buffer.from(JSON.stringify({ format: "xneon-theme", version: 1, theme })), [`assets/${name}`]: Buffer.from("invalid checksum") })
    await expect(restoreThemeBundle(bytes, destination)).rejects.toThrow("checksum mismatch")
    expect(extract).toHaveBeenCalledTimes(1)
    await expect(readFile(path.join(destination, name))).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    extract.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
