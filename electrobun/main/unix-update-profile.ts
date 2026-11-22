import assert from "node:assert/strict"
import { chmod, lstat, open, realpath, rename, rm } from "node:fs/promises"
import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import Database from "../platform/sqlite"
import { assertUpdateFreeSpace } from "./unix-update-download"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"

type Snapshot = { schemaVersion: 1; database: string; existed: boolean; size?: number; sha256?: string }
async function regular(file: string) {
  try { const info = await lstat(file); assert.ok(info.isFile(), "Unsafe update database file"); return info }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
}
async function paths(database: string, directory: string) {
  assert.equal(path.basename(database), "data.db", "Unexpected managed database name")
  assert.ok((await lstat(directory)).isDirectory(), "Unsafe database backup directory")
  const root = await realpath(directory), parent = await realpath(path.dirname(database))
  if (process.platform !== "win32") {
    const info = await lstat(root)
    assert.ok(info.uid === process.getuid!() && !(info.mode & 0o077), "Database backup directory is not private")
  }
  return { database: path.join(parent, "data.db"), root, data: path.join(root, "previous-data.db"), metadata: path.join(root, "database-snapshot.json") }
}
async function digest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk)
  return hash.digest("hex")
}
function quickCheck(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = db.query<{ quick_check: string }, []>("PRAGMA quick_check").all()
    assert.ok(rows.length === 1 && rows[0].quick_check === "ok", "Update database snapshot is corrupt")
  } finally { db.close() }
}
async function sync(file: string) {
  const handle = await open(file, "r+")
  try { await handle.sync() } finally { await handle.close() }
}

/**
 * Вызывается helper после выхода A; VACUUM INTO учитывает committed WAL, как штатные миграционные backup.
 * Это снимок для ручного восстановления: helper больше не применяет его автоматически.
 */
export async function backupUnixUpdateDatabase(database: string, directory: string) {
  const files = await paths(database, directory)
  assert.ok(!await regular(files.metadata) && !await regular(files.data), "Database snapshot already exists")
  const info = await regular(files.database)
  const record: Snapshot = { schemaVersion: 1, database: files.database, existed: !!info }
  if (info) {
    const wal = await regular(files.database + "-wal")
    await assertUpdateFreeSpace(files.root, info.size + (wal?.size ?? 0) + 16 * 1024 ** 2)
    const temporary = path.join(files.root, `database-${randomBytes(16).toString("hex")}.tmp`)
    try {
      const db = new Database(files.database, { readonly: true, fileMustExist: true })
      try { db.query("VACUUM INTO ?").run(temporary) } finally { db.close() }
      await chmod(temporary, 0o600)
      quickCheck(temporary)
      await sync(temporary)
      record.size = (await lstat(temporary)).size; record.sha256 = await digest(temporary)
      await rename(temporary, files.data)
    } finally { await rm(temporary, { force: true }) }
  }
  const handle = await open(files.metadata, "wx", 0o600)
  try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
  await syncUnixUpdateDirectory(files.root); await syncUnixUpdateDirectory(path.dirname(files.root))
  return record
}