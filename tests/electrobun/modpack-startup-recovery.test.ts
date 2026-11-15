import { expect, test } from "bun:test"

for (const failure of [false, true]) test(`startup восстанавливает модпак до переноса каталогов и открытия UI (ошибка=${failure})`, () => {
  const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import { EventEmitter } from "node:events"
    const failure = ${failure}, calls = [], handlers = new Map()
    const loadedRoots = []
    let cachedRoot, moved = false
    const app = new EventEmitter()
    class DesktopWindow extends EventEmitter {
      viewSession = { id: 1 }
      static getAllWindows() { return [{}] }
    }
    mock.module("./electrobun/platform/desktop.ts", () => ({ app, DesktopWindow, rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) } }))
    mock.module("./electrobun/main/startup-theme.ts", () => ({ readStartupTheme: () => ({}) }))
    mock.module("./electrobun/main/runtime.ts", () => ({ setMainWindow() {}, logRuntime() {}, sendToRenderer() {}, initRuntimePaths: async () => calls.push("paths") }))
    mock.module("./electrobun/db/index.ts", () => ({ initDatabase: async () => calls.push("db") }))
    mock.module("./electrobun/main/paths.ts", () => ({ applyPendingInstancesMove: () => { calls.push("move"); moved = true } }))
    mock.module("./electrobun/db/settings.ts", () => ({ clearSettingsCache: () => { cachedRoot = undefined; calls.push("invalidate") } }))
    mock.module("./electrobun/main/builds/helpers.ts", () => ({ loadInstancesRoot: async () => {
      calls.push("root"); cachedRoot ??= moved ? "new" : "old"; loadedRoots.push(cachedRoot)
    } }))
    mock.module("./electrobun/main/builds/modpack-persistence.ts", () => ({ recoverManagedModpackInstalls: async () => { calls.push("recovery"); if (failure) throw new Error("metadata unavailable") } }))
    mock.module("./electrobun/main/builds/dir-migration.ts", () => ({ migrateIntentDirNames: async () => { calls.push("rename"); return 0 } }))
    mock.module("./electrobun/main/authlib/index.ts", () => ({ refreshAuthServersInBackground: async () => {} }))
    mock.module("./electrobun/main/stats.ts", () => ({ cleanupOrphanGameSessions: async () => 0 }))
    mock.module("./electrobun/main/cli.ts", () => ({ cli: { attach() {}, close() {} } }))
    mock.module("./electrobun/main/remote-servers/index.ts", () => ({ startRemoteServerHosts: async () => {} }))
    const { registerWindowLifecycle } = await import("./electrobun/main/window.ts")
    registerWindowLifecycle()
    const outcome = await handlers.get("startup:ready")()
    assert.equal(calls[0], "db")
    assert.ok(calls.indexOf("root") < calls.indexOf("recovery"))
    if (failure) {
      assert.match(outcome, /metadata unavailable/)
      assert.equal(calls.includes("move"), false)
      assert.equal(calls.includes("rename"), false)
    } else {
      assert.equal(outcome, null)
      assert.ok(calls.indexOf("recovery") < calls.indexOf("move"))
      assert.ok(calls.indexOf("recovery") < calls.indexOf("rename"))
      assert.deepEqual(loadedRoots, ["old", "new"], "Перенос не оставляет в кэше прежний instancesPath")
    }
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
