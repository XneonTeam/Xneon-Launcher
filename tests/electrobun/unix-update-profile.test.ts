import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import Database from "../../electrobun/platform/sqlite"
import { backupUnixUpdateDatabase, restoreUnixUpdateDatabase } from "../../electrobun/main/unix-update-profile"

async function fixture(action: (database: string, snapshot: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-profile-test-")), snapshot = path.join(root, "snapshot")
  await mkdir(snapshot, { mode: 0o700 })
  try { await action(path.join(root, "data.db"), snapshot, root) } finally { await rm(root, { recursive: true, force: true }) }
}
test("rollback БД сохраняет committed WAL и возвращает настройки/схему A после миграции B", () => fixture(async (file, snapshot, directory) => {
  let db = new Database(file)
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('theme','A'); PRAGMA user_version=1")
  await backupUnixUpdateDatabase(file, snapshot)
  db.close()
  db = new Database(file)
  db.exec("UPDATE settings SET value='B'; ALTER TABLE settings ADD COLUMN changed TEXT; PRAGMA user_version=2"); db.close()
  const unrelated = path.join(directory, "user-file.txt"); await writeFile(unrelated, "preserve me")
  await restoreUnixUpdateDatabase(file, snapshot)
  db = new Database(file)
  try {
    expect(db.query<{ value: string }, []>("SELECT value FROM settings").get()?.value).toBe("A")
    expect(db.pragma("user_version", { simple: true })).toBe(1)
    expect(db.query("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" })
  } finally { db.close() }
  expect(await readFile(unrelated, "utf8")).toBe("preserve me")
}))
test("подменённый snapshot отвергается до изменения актуальной БД", () => fixture(async (file, snapshot) => {
  let db = new Database(file); db.exec("CREATE TABLE settings(value TEXT); INSERT INTO settings VALUES ('A')"); db.close()
  await backupUnixUpdateDatabase(file, snapshot)
  db = new Database(file); db.exec("UPDATE settings SET value='B'"); db.close()
  await writeFile(path.join(snapshot, "previous-data.db"), "corrupt")
  await expect(restoreUnixUpdateDatabase(file, snapshot)).rejects.toThrow()
  db = new Database(file)
  try { expect(db.query<{ value: string }, []>("SELECT value FROM settings").get()?.value).toBe("B") } finally { db.close() }
}))
test("symlink вместо БД не читается как snapshot и не заменяется", () => fixture(async (file, snapshot, directory) => {
  const outside = path.join(directory, "outside.db")
  const db = new Database(outside); db.exec("CREATE TABLE sentinel(value TEXT)"); db.close()
  await symlink(outside, file)
  await expect(backupUnixUpdateDatabase(file, snapshot)).rejects.toThrow()
}))
