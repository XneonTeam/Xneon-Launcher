import { expect, test } from "bun:test"

test("закрытие SQLite инвалидирует удерживаемые statements, освобождает файл и позволяет новую запись после reopen", () => {
  const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { tmpdir } from "node:os"
    import { EventEmitter } from "node:events"
    const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-close-reopen-"))
    mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => root }))
    mock.module("./electrobun/platform/desktop.ts", () => ({ app: new EventEmitter() }))
    mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime() {} }))
    const database = await import("./electrobun/db/index.ts")
    const core = await import("./electrobun/db/core.ts")
    const build = id => ({ id, name: id, description: "", version: "1.21.1", modLoader: "vanilla", icon: "", mods: [], createdAt: "2026-11-15", source: "local", playtime: 0 })
    await database.initDatabase()
    await database.dbHelpers.insertBuild(build("first"))
    const retained = core.prepare("SELECT 1 AS value")
    core.closeDatabase()
    assert.throws(() => retained.get(), /closed|finalized/i)
    await database.initDatabase()
    await database.dbHelpers.insertBuild(build("second"))
    assert.equal((await database.dbHelpers.loadBuildsLight()).length, 2)
    core.closeDatabase()
    await fs.rm(root, { recursive: true, force: true })
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
