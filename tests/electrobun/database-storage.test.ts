// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test } from "bun:test"
import assert from "node:assert/strict"
import fsp, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import nodeTest from "node:test"
import { Database } from "bun:sqlite"
import LegacyDatabase from "better-sqlite3"
import fs from "node:fs"
import os from "node:os"
import vm from "node:vm"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { stripTypeScriptTypes } from "./transpile.mjs"
import storage from "../../dist-electrobun-tests/main/data-location.js"

{
  describe("db-storage-boundary", () => {
    test("без инициализации БД аккаунты, сборки и настройки не делают вид, что сохранены", () => {
      const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => process.cwd() }))
    mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime() {} }))
    const core = await import("./electrobun/db/core.ts")
    const accounts = await import("./electrobun/db/accounts.ts")
    const builds = await import("./electrobun/db/builds.ts")
    const settings = await import("./electrobun/db/settings.ts")
    assert.equal(core.isDbAvailable(), false)
    assert.equal(core.isDbFallbackMode(), false)
    assert.throws(() => core.enableDatabaseTestStorage(), /only available/)
    await assert.rejects(accounts.saveAccount({ id: "test", type: "offline", username: "Test", isActive: true }), /not initialized/)
    await assert.rejects(builds.loadBuilds(), /not initialized/)
    await assert.rejects(settings.setSetting("test", "value"), /not initialized/)
    await assert.rejects(settings.getSetting("test"), /not initialized/)
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { env: { ...process.env, NODE_ENV: "production" }, stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })

    test("ошибка SQLite не публикует несохранённую настройку в кэш", () => {
      const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    mock.module("./electrobun/db/migrations.ts", () => ({ DEFAULT_SETTINGS: {} }))
    mock.module("./electrobun/db/core.ts", () => ({ isDbAvailable: () => true,
      queryAll: () => [{ value: "old" }], run: () => { throw new Error("disk full") }, transaction: callback => callback(),
      inMemorySettings: new Map(), requireTestDatabaseStorage() { throw new Error("disabled") }
    }))
    const settings = await import("./electrobun/db/settings.ts")
    assert.equal(await settings.getSetting("name"), "old")
    await assert.rejects(settings.setSetting("name", "new"), /disk full/)
    assert.equal(await settings.getSetting("name"), "old")
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })
  })
}

{
  describe("db-close-reopen", () => {
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
  })
}

{
  const test = nodeTest
  async function fixture(t) {
    await mkdir(".tmp", { recursive: true })
    const root = await mkdtemp(path.resolve(".tmp/profile-test-"))
    let writer
    t.after(async () => {
      writer?.close()
      await rm(root, { recursive: true, force: true })
    })
    const dbPath = path.join(root, "data.db")
    const run = (code) => {
      const result = Bun.spawnSync([process.execPath, "-e", `
      import { mock } from "bun:test"
      mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => process.env.XNEON_TEST_ROOT }))
      const core = await import("./electrobun/db/core.ts")
      const migrations = await import("./electrobun/db/migrations.ts")
      ${code}
    `], { env: { ...process.env, XNEON_TEST_ROOT: root } })
      assert.equal(result.exitCode, 0, result.stderr.toString())
    }
    return { root, dbPath, run, openWriter: () => (writer = new LegacyDatabase(dbPath)) }
  }
  describe("profile-startup", () => {
    test("снимок сохраняет данные из активного WAL до транзакционной миграции", async t => {
      const { dbPath, run, openWriter } = await fixture(t)
      const writer = openWriter()
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)")
      writer.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA user_version=11; INSERT INTO settings VALUES ('profile-marker', 'saved in WAL')")
      assert.ok((await readFile(dbPath + "-wal")).length > 0)
      run(`
    await core.initDatabaseCore(migrations.SCHEMA_VERSION)
    migrations.initializeSchema()
    core.closeDatabase()
  `)
      const backup = new Database(dbPath + ".electrobun-v11-to-v14.bak", { readonly: true })
      try {
        assert.equal(backup.query("PRAGMA user_version").get().user_version, 11)
        assert.equal(backup.query("SELECT value FROM settings WHERE key='profile-marker'").get().value, "saved in WAL")
        assert.equal(writer.prepare("PRAGMA user_version").get().user_version, 14)
        assert.equal(writer.prepare("SELECT value FROM settings WHERE key='profile-marker'").get().value, "saved in WAL")
      } finally {
        backup.close()
      }
    })

    test("миграция версии parser сохраняет ресурсы и внешние идентификаторы", async t => {
      const { run, openWriter } = await fixture(t)
      const writer = openWriter()
      writer.exec(`CREATE TABLE resources (sha1 TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'local', projectId TEXT, versionId TEXT, modId INTEGER, fileId INTEGER, cfChecked INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL DEFAULT 0);
    INSERT INTO resources (sha1,name,source,projectId,versionId,modId,fileId,cfChecked) VALUES ('abc','Existing','local','project','version',42,43,1); PRAGMA user_version=12;`)
      run(`
    import assert from "node:assert/strict"
    const resources = await import("./electrobun/db/resources.ts")
    await core.initDatabaseCore(migrations.SCHEMA_VERSION)
    migrations.initializeSchema()
    const before = (await resources.getResources(["abc"]))[0]
    assert.equal(before.parserVersion, "")
    await resources.upsertResource({ ...before, parserVersion: "parser-test" })
    const current = (await resources.getResources(["abc"]))[0]
    const { parserVersion, updatedAt, ...withoutVersion } = current
    await resources.upsertResource(withoutVersion)
    await resources.upsertResources([withoutVersion])
    const after = (await resources.getResources(["abc"]))[0]
    assert.equal(after.parserVersion, "parser-test")
    assert.equal(after.projectId, "project")
    assert.equal(after.versionId, "version")
    assert.equal(after.modId, 42)
    assert.equal(after.fileId, 43)
    assert.equal(after.cfChecked, 1)
    core.closeDatabase()
  `)
    })

    test("повреждённая база остаётся на месте, запуск завершается ошибкой", async t => {
      const { root, dbPath, run } = await fixture(t)
      await writeFile(dbPath, "not a database")
      run(`
    import assert from "node:assert/strict"
    await assert.rejects(core.initDatabaseCore(migrations.SCHEMA_VERSION), /Invalid SQLite database header/)
    assert.equal(core.isDbAvailable(), false)
  `)
      assert.equal(await readFile(dbPath, "utf8"), "not a database")
      assert.deepEqual(await readdir(root), ["data.db"])
    })

    test("перед обновлением SQLite checkpoint и закрытие сохраняют записи при повторном открытии", async t => {
      const { run } = await fixture(t)
      run(`
    import assert from "node:assert/strict"
    await core.initDatabaseCore(migrations.SCHEMA_VERSION)
    migrations.initializeSchema()
    core.run("INSERT INTO settings VALUES (?,?)", ["update-marker", "saved"])
    core.closeDatabaseForUpdate()
    assert.equal(core.isDbAvailable(), false)
    assert.throws(() => core.getDatabase(), /not initialized/)
    await core.initDatabaseCore(migrations.SCHEMA_VERSION)
    assert.equal(core.queryAll("SELECT value FROM settings WHERE key = ?", ["update-marker"])[0].value, "saved")
    core.closeDatabase()
  `)
    })
  })
}

{
  const test = nodeTest
  const Database = LegacyDatabase
  async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'xnlc-data-move-'))
    t.after(() => fsp.rm(root, { recursive: true, force: true }))
    const source = path.join(root, 'old'), target = path.join(root, 'new'), profile = path.join(root, 'launcher-profile'), cache = path.join(root, 'legacy-cache'), config = path.join(root, 'location.json')
    for (const directory of [source, profile, cache]) fs.mkdirSync(directory)
    const put = (relative, content) => { const file = path.join(source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file }
    put('intents/Build/mods/test.jar.disabled', 'disabled mod')
    put('mc-servers/server/world/level.dat', 'world bytes')
    put('minecraft/assets/indexes/test.json', '{"objects":{}}')
    put('skins/favorite.png', 'skin bytes')
    fs.writeFileSync(path.join(profile, 'settings.txt'), 'profile data')
    fs.mkdirSync(path.join(profile, 'themes'))
    fs.writeFileSync(path.join(profile, 'themes/custom.css.json'), JSON.stringify({ fontPath: path.join(profile, 'font.ttf') }))
    fs.writeFileSync(path.join(cache, 'launcher.log'), 'log data')
    const db = new Database(path.join(source, 'data.db'))
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE builds (id TEXT PRIMARY KEY,intentPath TEXT,installedMods TEXT,javaPath TEXT); CREATE TABLE accounts (id TEXT PRIMARY KEY,token TEXT)')
    db.prepare('INSERT INTO settings VALUES (?,?)').run('instancesPath', '')
    db.prepare('INSERT INTO settings VALUES (?,?)').run('customThemes', JSON.stringify([{ fontPath: path.join(profile, 'font.ttf') }]))
    db.prepare('INSERT INTO builds VALUES (?,?,?,?)').run('build', path.join(source, 'intents/Build'), JSON.stringify({ 'test.jar': path.join(source, 'intents/Build/mods/test.jar.disabled') }), path.join(root, 'external-java/java.exe'))
    db.prepare('INSERT INTO accounts VALUES (?,?)').run('account', 'encrypted:unchanged')
    db.close()
    const state = { root: source }
    return { root, source, target, profile, cache, config, state, put,
      schedule: (destination = target, instances = source) => storage.scheduleInstancesMove(config, state, instances, destination) }
  }
  describe("data-location", () => {
    test('переносит только сборки: база, серверы, Minecraft, профиль и кэш остаются на месте', async t => {
      const f = await fixture(t)
      const planned = f.schedule()
      const next = storage.migrateInstancesLocation(f.config, planned)
      assert.equal(next.root, f.source)
      assert.equal(next.pendingInstances, undefined)
      assert.equal(fs.readFileSync(path.join(f.target, 'intents/Build/mods/test.jar.disabled'), 'utf8'), 'disabled mod')
      for (const name of ['data.db', 'mc-servers', 'minecraft', 'skins', 'profile', 'system-cache']) assert.equal(fs.existsSync(path.join(f.target, name)), false, name)
      assert.equal(fs.readFileSync(path.join(f.source, 'mc-servers/server/world/level.dat'), 'utf8'), 'world bytes')
      assert.equal(fs.readFileSync(path.join(f.profile, 'settings.txt'), 'utf8'), 'profile data')
      const db = new Database(path.join(f.source, 'data.db'))
      const row = db.prepare('SELECT * FROM builds').get()
      assert.equal(row.intentPath, path.join(f.target, 'intents/Build'))
      assert.equal(JSON.parse(row.installedMods)['test.jar'], path.join(f.target, 'intents/Build/mods/test.jar.disabled'))
      assert.equal(row.javaPath, path.join(f.root, 'external-java/java.exe'))
      assert.equal(db.prepare("SELECT value FROM settings WHERE key='instancesPath'").get().value, f.target)
      assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='customThemes'").get().value)[0].fontPath, path.join(f.profile, 'font.ttf'))
      assert.equal(db.prepare('SELECT token FROM accounts').get().token, 'encrypted:unchanged')
      db.close()
    })

    test('повторный перенос B → C берёт текущие сборки, а не старую папку по умолчанию', async t => {
      const f = await fixture(t)
      const first = storage.migrateInstancesLocation(f.config, f.schedule())
      fs.writeFileSync(path.join(f.target, 'intents/Build/mods/new.jar'), 'new mod')
      const target = path.join(f.root, 'third')
      const second = storage.scheduleInstancesMove(f.config, first, f.target, target)
      storage.migrateInstancesLocation(f.config, second)
      assert.equal(fs.readFileSync(path.join(target, 'intents/Build/mods/new.jar'), 'utf8'), 'new mod')
      const db = new Database(path.join(f.source, 'data.db'))
      assert.equal(db.prepare('SELECT intentPath FROM builds').get().intentPath, path.join(target, 'intents/Build'))
      db.close()
    })

    test('занятые intents не перезаписываются, вложенные папки отклоняются', async t => {
      const f = await fixture(t)
      fs.mkdirSync(path.join(f.target, 'intents'), { recursive: true })
      fs.writeFileSync(path.join(f.target, 'intents/keep'), 'user file')
      assert.throws(() => f.schedule(), /DATA_PATH_NOT_EMPTY/)
      assert.equal(fs.readFileSync(path.join(f.target, 'intents/keep'), 'utf8'), 'user file')
      assert.throws(() => f.schedule(path.join(f.source, 'intents/sub')), /DATA_PATH_NESTED/)
      assert.equal(fs.existsSync(f.config), false)
    })

    test('посторонние файлы в выбранной папке не мешают переносу intents и не меняются', async t => {
      const f = await fixture(t)
      fs.mkdirSync(f.target); fs.writeFileSync(path.join(f.target, 'keep.txt'), 'keep')
      storage.migrateInstancesLocation(f.config, f.schedule())
      assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'keep')
    })

    test('ошибка копирования оставляет старые пути и файлы, неполная копия убирается', async t => {
      const f = await fixture(t), planned = f.schedule()
      const require = createRequire(new URL('../../dist-electrobun-tests/main/data-location.js', import.meta.url))
      const mockedFs = { ...fs, copyFileSync: () => { throw new Error('Disk full') } }
      const module = { exports: {} }
      vm.runInNewContext(fs.readFileSync(new URL('../../dist-electrobun-tests/main/data-location.js', import.meta.url), 'utf8'), { module, exports: module.exports, process, require: name => name === 'node:fs' ? mockedFs : require(name) })
      assert.throws(() => module.exports.migrateInstancesLocation(f.config, planned), /Disk full/)
      const db = new Database(path.join(f.source, 'data.db'))
      assert.equal(db.prepare('SELECT intentPath FROM builds').get().intentPath, path.join(f.source, 'intents/Build'))
      db.close()
      assert.equal(fs.existsSync(path.join(f.target, 'intents')), false)
      assert.equal(fs.readdirSync(f.target).length, 0)
      assert.equal(fs.readFileSync(path.join(f.source, 'intents/Build/mods/test.jar.disabled'), 'utf8'), 'disabled mod')
    })

    test('повторный запуск после готовой копии завершает перенос без перезаписи файлов', async t => {
      const f = await fixture(t), planned = f.schedule()
      storage.migrateInstancesLocation(f.config, planned)
      storage.writeDataLocation(f.config, planned)
      const next = storage.migrateInstancesLocation(f.config, storage.readDataLocation(f.config, f.source))
      assert.equal(next.root, f.source)
      assert.equal(next.pendingInstances, undefined)
    })

    test('пути в снимках корзины обновляются, исходный снимок остаётся прежним', async t => {
      const f = await fixture(t)
      f.put('intents/.trash/build.json', JSON.stringify({ intentPath: path.join(f.source, 'intents/Build') }))
      storage.migrateInstancesLocation(f.config, f.schedule())
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'intents/.trash/build.json'), 'utf8')).intentPath, path.join(f.target, 'intents/Build'))
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.source, 'intents/.trash/build.json'), 'utf8')).intentPath, path.join(f.source, 'intents/Build'))
    })

    test('выбор текущей папки отменяет запланированный перенос', async t => {
      const f = await fixture(t), planned = f.schedule()
      const next = storage.scheduleInstancesMove(f.config, planned, f.source, f.source)
      assert.equal(next.pendingInstances, undefined)
    })

    test('ссылки внутри сборок указывают в новую папку', async t => {
      const f = await fixture(t)
      fs.symlinkSync(path.join(f.source, 'intents/Build/mods'), path.join(f.source, 'intents/Build/link'), 'junction')
      storage.migrateInstancesLocation(f.config, f.schedule())
      assert.equal(path.resolve(fs.readlinkSync(path.join(f.target, 'intents/Build/link'))), path.join(f.target, 'intents/Build/mods'))
    })

    test('предыдущий план переноса ВСЕХ данных отменяется до открытия базы', async t => {
      const f = await fixture(t), config = path.join(f.root, '.xneonlauncher-location.json')
      storage.writeDataLocation(config, { root: f.source, pending: { id: 'obsolete', source: f.source, target: f.target } })
      const require = createRequire(new URL('../../dist-electrobun-tests/main/paths.js', import.meta.url))
      const module = { exports: {} }
      vm.runInNewContext(fs.readFileSync(new URL('../../dist-electrobun-tests/main/paths.js', import.meta.url), 'utf8'), {
        module, exports: module.exports, process, Error, console,
        require: name => {
          if (name === './profile-path') return { launcherLocationConfig: config, getDefaultLauncherDataRoot: () => f.source }
          if (name === '../platform/desktop') return { app: { setPath: (key, value) => {
            assert.equal(key, 'userData')
            assert.equal(value, f.source)
          } } }
          return require(name)
        },
      })
      assert.equal(module.exports.getLauncherDataRoot(), f.source)
      assert.equal(storage.readDataLocation(config, f.source).pending, undefined)
      assert.equal(fs.existsSync(f.target), false)
    })
  })
}
