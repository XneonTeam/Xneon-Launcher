import { expect, test } from "bun:test"

test("missing-mods config не может писать вне staging; отмена не превращается в частичный успех", () => {
  // Подменяем только сеть/системные зависимости в отдельном процессе.
  const scenario = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { tmpdir } from "node:os"
    mock.module("./electrobun/platform/desktop.ts", () => ({ app: { getPath: () => process.cwd(), on() {} } }))
    mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: {} }))
    mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime() {}, getMainWindow() {} }))
    mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => process.cwd() }))
    const { collectMissingFiles, downloadMissingModFiles } = await import("./electrobun/main/builds/missing-mods.ts")
    const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-missing-mods-"))
    const entry = { pattern: "../../outside.jar", url: "https://curseforge.invalid/download/42" }
    try {
      assert.throws(() => collectMissingFiles(root, [entry]), /Invalid missing mod path/)
      await assert.rejects(downloadMissingModFiles(root, [entry]), /Invalid missing mod path/)
      const controller = new AbortController()
      controller.abort(new Error("cancelled"))
      await assert.rejects(downloadMissingModFiles(root, [{ ...entry, pattern: "valid.jar" }], { signal: controller.signal }), /cancelled/)
      assert.deepEqual(await fs.readdir(root), [])
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", scenario], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
