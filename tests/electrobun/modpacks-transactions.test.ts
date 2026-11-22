// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test } from "bun:test"
import nodeTest from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import * as sharedUrls from "../../packages/xnlc-urls/src/index.ts"

{
  describe("modpack-metadata-transaction", () => {
    for (const mode of ["success", "write-failure", "marker-failure", "crash-before-marker", "committed-recovery", "finalize-retry"]) {
      test(`файловый журнал согласует SQLite metadata (${mode})`, () => {
        const code = `
      import assert from "node:assert/strict"
      import { Database } from "bun:sqlite"
      import fs from "node:fs/promises"
      import path from "node:path"
      import { tmpdir } from "node:os"
      import * as installation from "./electrobun/main/builds/modpack-install.ts"
      const mode = ${JSON.stringify(mode)}
      const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-metadata-transaction-"))
      const dbPath = path.join(root, "metadata.db")
      const db = new Database(dbPath)
      db.exec("CREATE TABLE builds(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE backups(token TEXT PRIMARY KEY,data TEXT)")
      db.query("INSERT INTO builds VALUES (?,?)").run("build", JSON.stringify({ version: "old", modLoader: "forge" }))
      let finalizeFails = mode === "finalize-retry"
      const makePort = connection => ({
        async begin(directory, buildId) {
          assert.equal(await fs.realpath(directory), await fs.realpath(root))
          assert.equal(buildId, "build")
          const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          connection.query("INSERT INTO backups VALUES (?,?)").run(token, connection.query("SELECT data FROM builds WHERE id='build'").get().data)
          return token
        },
        async write(directory, token, fields) {
          assert.ok(connection.query("SELECT data FROM backups WHERE token=?").get(token))
          if (mode === "write-failure") throw new Error("metadata disk full")
          connection.query("UPDATE builds SET data=? WHERE id='build'").run(JSON.stringify(fields))
          if (mode === "crash-before-marker") process.exit(23)
        },
        async rollback(directory, token) {
          const row = connection.query("SELECT data FROM backups WHERE token=?").get(token)
          assert.ok(row, "Metadata backup must remain recoverable")
          connection.query("UPDATE builds SET data=? WHERE id='build'").run(row.data)
          connection.query("DELETE FROM backups WHERE token=?").run(token)
        },
        async finalize(directory, token) {
          if (finalizeFails) throw new Error("cleanup unavailable")
          connection.query("DELETE FROM backups WHERE token=?").run(token)
        },
      })
      const old = await installation.stageModpackInstall(root)
      await fs.mkdir(path.join(old.directory, "mods"))
      await fs.writeFile(path.join(old.directory, "mods/old.jar"), "old")
      await old.apply(async () => {})
      await old.close()
      const port = makePort(db)
      if (typeof installation.setModpackPersistence === "function") installation.setModpackPersistence(port)
      try {
        if (mode === "crash-before-marker" || mode === "committed-recovery") {
          const childCode = ${JSON.stringify(`
            import { Database } from "bun:sqlite"
            import fs from "node:fs/promises"
            import path from "node:path"
            import * as installation from "./electrobun/main/builds/modpack-install.ts"
            const db = new Database(process.env.METADATA_DB)
            const mode = process.env.METADATA_MODE, root = process.env.METADATA_ROOT
            if (typeof installation.setModpackPersistence === "function") installation.setModpackPersistence({
              begin: async () => { db.query("INSERT INTO backups VALUES (?,?)").run("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", db.query("SELECT data FROM builds WHERE id='build'").get().data); return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
              write: async (_root, _token, fields) => { db.query("UPDATE builds SET data=? WHERE id='build'").run(JSON.stringify(fields)); if (mode === "crash-before-marker") process.exit(23) },
              rollback: async () => { throw new Error("Child rollback should not run") },
              finalize: async (_root, token) => { db.query("DELETE FROM backups WHERE token=?").run(token) },
            })
            const operation = await installation.stageModpackInstall(root)
            await fs.mkdir(path.join(operation.directory, "mods"))
            await fs.writeFile(path.join(operation.directory, "mods/new.jar"), "new")
            await operation.apply(async () => {}, { buildId: "build", fields: () => ({ version: "new", modLoader: "fabric" }) })
            process.exit(23)
          `)}
          const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", childCode], { env: { ...process.env, METADATA_DB: dbPath, METADATA_MODE: mode, METADATA_ROOT: root }, stdout: "pipe", stderr: "pipe" })
          assert.equal(child.exitCode, 23, child.stderr.toString())
          await installation.recoverModpackInstall(root)
          const expected = mode === "crash-before-marker" ? "old" : "new"
          assert.equal(JSON.parse(db.query("SELECT data FROM builds WHERE id='build'").get().data).version, expected)
          assert.equal(await fs.readFile(path.join(root, "mods/" + expected + ".jar"), "utf8"), expected)
        } else {
          const operation = await installation.stageModpackInstall(root)
          const rename = fs.rename
          let journalWrites = 0
          try {
            await fs.mkdir(path.join(operation.directory, "mods"))
            await fs.writeFile(path.join(operation.directory, "mods/new.jar"), "new")
            if (mode === "marker-failure") fs.rename = async (from, to) => {
              if (path.basename(to) === "journal.json" && ++journalWrites === 2) throw Object.assign(new Error("marker disk full"), { code: "ENOSPC" })
              return rename(from, to)
            }
            const applying = operation.apply(async () => {}, { buildId: "build", fields: () => ({ version: "new", modLoader: "fabric" }) })
            if (mode === "write-failure" || mode === "marker-failure") {
              await assert.rejects(applying, /disk full/)
              assert.equal(JSON.parse(db.query("SELECT data FROM builds WHERE id='build'").get().data).version, "old")
              assert.equal(await fs.readFile(path.join(root, "mods/old.jar"), "utf8"), "old")
              await assert.rejects(fs.access(path.join(root, "mods/new.jar")), { code: "ENOENT" })
            } else {
              await applying
              assert.equal(JSON.parse(db.query("SELECT data FROM builds WHERE id='build'").get().data).version, "new")
              assert.equal(await fs.readFile(path.join(root, "mods/new.jar"), "utf8"), "new")
            }
          } finally { fs.rename = rename; await operation.close() }
          if (mode === "finalize-retry") {
            await fs.access(path.join(root, ".xnlc-modpack/transaction/journal.json"))
            finalizeFails = false
            await installation.recoverModpackInstall(root)
            await assert.rejects(fs.access(path.join(root, ".xnlc-modpack/transaction")), { code: "ENOENT" })
          }
        }
        assert.equal(db.query("SELECT count(*) AS n FROM backups").get().n, 0)
      } finally { db.close(); await fs.rm(root, { recursive: true, force: true }) }
    `
        const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
        expect(result.exitCode, result.stderr.toString()).toBe(0)
      })
    }
  })
}

{
  const setup = `
  import { mock } from "bun:test"
  import assert from "node:assert/strict"
  import fs from "node:fs/promises"
  import path from "node:path"
  import { tmpdir } from "node:os"
  import { EventEmitter } from "node:events"
  const root = process.env.MODPACK_SQL_ROOT || await fs.mkdtemp(path.join(tmpdir(), "xnlc-modpack-sql-"))
  mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => root }))
  mock.module("./electrobun/platform/desktop.ts", () => ({ app: Object.assign(new EventEmitter(), { getPath: () => root }) }))
  mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime() {}, sendToRenderer() {}, getMainWindow: () => null }))
  mock.module("./electrobun/main/shared-game-cache.ts", () => ({ prepareInstanceStorageSync() {} }))
  const database = await import("./electrobun/db/index.ts")
  const core = await import("./electrobun/db/core.ts")
  await database.initDatabase()
  const sql = await import("./electrobun/main/builds/modpack-persistence.ts")
  const installation = await import("./electrobun/main/builds/modpack-install.ts")
  const port = sql.createModpackSqlPersistence()
  installation.setModpackPersistence(port)
  const directory = path.join(root, "intents/Pack")
  const oldMods = [{ id: "old", slug: "old.jar", name: "Old", description: "User metadata", version: "1", icon_url: "", author: "User" }]
  const newMods = [{ id: "new", slug: "new.jar", name: "New", description: "New metadata", version: "2", icon_url: "" }]
  const fields = { version: "1.21.1", modLoader: "fabric", loaderVersion: "0.16", customVersionPath: undefined,
    mods: newMods, resourcepacks: [], shaders: [], installedMods: { "new.jar": "2" }, modsCount: 1, resourcepacksCount: 0, shadersCount: 0 }
`
  describe("modpack-sql-persistence", () => {
    for (const mode of ["success", "marker-error", "crash", "committed-crash", "prepared-orphan", "reject-user-fields", "root-mismatch"]) test(`SQLite port восстанавливает metadata и не трогает пользовательские настройки (${mode})`, () => {
      const code = setup + `
    const mode = ${JSON.stringify(mode)}
    await database.dbHelpers.insertBuild({ id: "build", name: "Pack", description: "Original", version: "1.20.1", modLoader: "forge", loaderVersion: "47",
      customVersionPath: "versions/import.json", icon: "", mods: oldMods, resourcepacks: [], shaders: [], installedMods: { "old.jar": "1" },
      createdAt: "2026-11-15", playtime: 123, source: "modrinth", projectSlug: "pack", intentPath: directory, memoryMax: "8G" })
    const first = await installation.stageModpackInstall(directory)
    await fs.mkdir(path.join(first.directory, "mods"))
    await fs.writeFile(path.join(first.directory, "mods/old.jar"), "old")
    await first.apply(async () => {})
    await first.close()
    try {
      if (mode === "root-mismatch") {
        const token = await port.begin(await fs.realpath(directory), "build")
        await assert.rejects(port.write(root, token, fields), /another directory/)
        await assert.rejects(port.rollback(root, token), /another directory/)
        assert.equal((await database.dbHelpers.findBuildById("build")).modLoader, "forge")
        assert.equal(core.queryAll("SELECT count(*) AS n FROM modpack_metadata_backups")[0].n, 1)
        await sql.recoverManagedModpackInstalls()
      } else if (mode === "prepared-orphan") {
        await port.begin(await fs.realpath(directory), "build")
        await database.dbHelpers.updateBuildFields("build", { version: "user-later", memoryMax: "16G" })
        await sql.recoverManagedModpackInstalls()
        assert.equal((await database.dbHelpers.findBuildById("build")).version, "user-later")
      } else if (mode === "crash" || mode === "committed-crash") {
        const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", ${JSON.stringify(setup)} + ${JSON.stringify(`
          installation.setModpackPersistence(process.env.MODPACK_COMMITTED === "1"
            ? { ...port, finalize: async () => process.exit(23) }
            : { ...port, write: async (...args) => { await port.write(...args); process.exit(23) } })
          const next = await installation.stageModpackInstall(directory)
          await fs.mkdir(path.join(next.directory, "mods"))
          await fs.writeFile(path.join(next.directory, "mods/new.jar"), "new")
          await next.apply(async () => {}, { buildId: "build", fields: () => fields })
        `)}], { env: { ...process.env, MODPACK_SQL_ROOT: root, MODPACK_COMMITTED: mode === "committed-crash" ? "1" : "0" }, stdout: "pipe", stderr: "pipe" })
        assert.equal(child.exitCode, 23, child.stderr.toString())
        assert.equal((await database.dbHelpers.findBuildById("build")).modLoader, "fabric")
        await sql.recoverManagedModpackInstalls()
        const restored = await database.dbHelpers.findBuildById("build")
        const committed = mode === "committed-crash"
        assert.equal(restored.modLoader, committed ? "fabric" : "forge")
        assert.equal(restored.version, committed ? "1.21.1" : "1.20.1")
        assert.equal(restored.customVersionPath, committed ? undefined : "versions/import.json")
        const restoredContent = await database.dbHelpers.loadBuildContent("build")
        assert.deepEqual(restoredContent.mods, committed ? newMods : oldMods)
        assert.deepEqual(restoredContent.installedMods, committed ? { "new.jar": "2" } : { "old.jar": "1" })
        assert.deepEqual(await fs.readdir(path.join(directory, "mods")), [committed ? "new.jar" : "old.jar"])
      } else {
        const next = await installation.stageModpackInstall(directory)
        const rename = fs.rename
        let journalWrites = 0
        try {
          assert.throws(() => sql.assertBuildMetadataIdle("build", { version: "racing" }), { code: "MODPACK_BUSY" })
          assert.throws(() => sql.assertBuildMetadataIdle("build", { name: "Renamed" }), { code: "MODPACK_BUSY" })
          assert.throws(() => sql.assertBuildMetadataIdle("build", { intentPath: path.join(root, "other") }), { code: "MODPACK_BUSY" })
          assert.throws(() => sql.assertBuildMetadataIdle("another-id", { name: "Pack", intentPath: directory, version: "racing" }), { code: "MODPACK_BUSY" })
          assert.doesNotThrow(() => sql.assertBuildMetadataIdle("build", { memoryMax: "16G" }))
          await fs.mkdir(path.join(next.directory, "mods"))
          await fs.writeFile(path.join(next.directory, "mods/new.jar"), "new")
          if (mode === "marker-error") fs.rename = async (from, to) => {
            if (path.basename(to) === "journal.json" && ++journalWrites === 2) throw Object.assign(new Error("marker disk full"), { code: "ENOSPC" })
            return rename(from, to)
          }
          const operation = next.apply(async () => {
            await database.dbHelpers.updateBuildFields("build", { memoryMax: "16G", description: "User changed" })
          }, { buildId: "build", fields: () => mode === "reject-user-fields" ? { ...fields, memoryMax: "BAD" } : fields })
          if (mode === "success") {
            await operation
            const saved = await database.dbHelpers.findBuildById("build")
            assert.equal(saved.modLoader, "fabric")
            assert.equal(saved.version, "1.21.1")
            assert.equal(saved.customVersionPath, undefined)
            const content = await database.dbHelpers.loadBuildContent("build")
            assert.deepEqual(content.mods, newMods)
            assert.deepEqual(content.installedMods, { "new.jar": "2" })
          } else {
            await assert.rejects(operation, mode === "marker-error" ? /disk full/ : /user settings/)
            const saved = await database.dbHelpers.findBuildById("build")
            assert.equal(saved.modLoader, "forge")
            assert.deepEqual((await database.dbHelpers.loadBuildContent("build")).mods, oldMods)
            assert.deepEqual(await fs.readdir(path.join(directory, "mods")), ["old.jar"])
          }
          const user = await database.dbHelpers.findBuildById("build")
          assert.equal(user.memoryMax, "16G")
          assert.equal(user.description, "User changed")
          assert.equal(user.playtime, 123)
        } finally { fs.rename = rename; await next.close() }
      }
      assert.equal(core.queryAll("SELECT count(*) AS n FROM modpack_metadata_backups")[0].n, 0)
    } finally { core.closeDatabase(); await fs.rm(root, { recursive: true, force: true }) }
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })
  })
}

{
  describe("modpack-startup-recovery", () => {
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
    mock.module("./electrobun/main/runtime.ts", () => ({ setMainWindow() {}, getMainWindow: () => ({ viewSession: { id: 1 } }), logRuntime() {}, sendToRenderer() {}, initRuntimePaths: async () => calls.push("paths") }))
    mock.module("./electrobun/db/index.ts", () => ({ initDatabase: async () => calls.push("db") }))
    mock.module("./electrobun/main/paths.ts", () => ({ applyPendingInstancesMove: () => { calls.push("move"); moved = true } }))
    mock.module("./electrobun/db/settings.ts", () => ({ clearSettingsCache: () => { cachedRoot = undefined; calls.push("invalidate") } }))
    mock.module("./electrobun/main/builds/helpers.ts", () => ({ loadInstancesRoot: async () => {
      calls.push("root"); cachedRoot ??= moved ? "new" : "old"; loadedRoots.push(cachedRoot)
    } }))
    mock.module("./electrobun/main/builds/modpack-persistence.ts", () => ({ recoverManagedModpackInstalls: async () => { calls.push("recovery"); if (failure) throw new Error("metadata unavailable") } }))
    mock.module("./electrobun/main/builds/dir-migration.ts", () => ({ migrateIntentDirNames: async () => { calls.push("rename"); return 0 } }))
    mock.module("./electrobun/main/updater.ts", () => ({ registerUpdater: () => calls.push("updater") }))
    mock.module("./electrobun/main/unix-updater.ts", () => ({ registerUnixUpdater: () => calls.push("updater") }))
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
      assert.equal(calls.includes("updater"), false)
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
  })
}

{
  const test = nodeTest
  const require = createRequire(import.meta.url)
  describe("build-owner-race", () => {
    for (const channel of ['db:update-build-fields', 'db:save-builds']) test(`${channel}: импорт, начавшийся во время await, не пропускает старую запись`, async () => {
      const handlers = new Map(), writes = []
      let busy = false
      const module = { exports: {} }
      const dependencies = {
        '@xnlc/urls': sharedUrls,
        './settings-handlers': { registerSettingsHandlers() {} },
        './account-service': { registerAccountHandlers() {} },
        './builds/content-icon': { normalizeBuildContentIcons: content => content },
        './builds/content-icon-assets': { publicContentIcons: async content => content, storedContentIcons: async content => content },
        './builds/modpack-persistence': { assertBuildMetadataIdle: () => { if (busy) throw new Error('MODPACK_BUSY') } },
        './external-links': {}, './errors': {}, './runtime': {}, './import': {}, './java-discovery': {}, '@xnlc/core/retry': {},
        '../platform/desktop': { rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) } },
        './builds/helpers': { isLoaderSelectionFieldChange: () => true, cleanupReplacedLoaderArtifacts: async () => {}, cleanupReplacedLoaderArtifactsForBuilds: async () => {} },
        '../db': { dbHelpers: {
          findBuildById: async () => { busy = true; return { id: 'build', name: 'Pack' } },
          loadBuildsLight: async () => { busy = true; return [] },
          updateBuildFields: async (...args) => writes.push(args), saveAllBuilds: async (...args) => writes.push(args),
        } },
      }
      const source = fs.readFileSync(new URL('../../electrobun/main/system.ts', import.meta.url), 'utf8')
      vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports,
        require: name => {
          if (Object.hasOwn(dependencies, name)) return dependencies[name]
          assert.ok(['os', 'path', 'fs/promises', 'url'].includes(name), name)
          return require(name)
        },
      })
      module.exports.registerSystemHandlers()
      const handler = handlers.get(channel)
      const operation = channel === 'db:save-builds' ? handler(null, [{ id: 'build', version: 'old' }]) : handler(null, 'build', { version: 'old' })
      await assert.rejects(operation, /MODPACK_BUSY/)
      assert.deepEqual(writes, [])
    })
  })
}
