import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import LegacyDatabase from "better-sqlite3"

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
  const backup = new Database(dbPath + ".electrobun-v11-to-v12.bak", { readonly: true })
  try {
    assert.equal(backup.query("PRAGMA user_version").get().user_version, 11)
    assert.equal(backup.query("SELECT value FROM settings WHERE key='profile-marker'").get().value, "saved in WAL")
    assert.equal(writer.prepare("PRAGMA user_version").get().user_version, 12)
    assert.equal(writer.prepare("SELECT value FROM settings WHERE key='profile-marker'").get().value, "saved in WAL")
  } finally {
    backup.close()
  }
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
