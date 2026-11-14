import { expect, test } from "bun:test"

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
