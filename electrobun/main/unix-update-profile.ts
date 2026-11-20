import assert from "node:assert/strict"
import { constants } from "node:fs"
import { chmod, copyFile, lstat, open, readFile, realpath, rename, rm } from "node:fs/promises"
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
async function verify(file: string, record: Snapshot) {
  const info = await regular(file)
  assert.ok(info && info.size === record.size && await digest(file) === record.sha256, "Update database snapshot integrity mismatch")
  quickCheck(file)
}

/** Вызывается helper после выхода A; VACUUM INTO учитывает committed WAL, как штатные миграционные backup. */
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

/** Только после остановки B и до restart A. Все файлы неудачной БД сохраняются отдельно. */
export async function restoreUnixUpdateDatabase(database: string, directory: string) {
  const files = await paths(database, directory)
  const metadata = await regular(files.metadata)
  assert.ok(metadata && metadata.size > 0 && metadata.size <= 16 * 1024, "Invalid database snapshot metadata")
  const record = JSON.parse(await readFile(files.metadata, "utf8")) as Snapshot
  assert.ok(record?.schemaVersion === 1 && record.database === files.database && typeof record.existed === "boolean", "Database snapshot belongs to another profile")
  if (record.existed) {
    assert.ok(Number.isSafeInteger(record.size) && record.size! > 0 && typeof record.sha256 === "string" && /^[a-f0-9]{64}$/.test(record.sha256), "Invalid database snapshot integrity metadata")
    await verify(files.data, record)
  }
  const current: Array<{ file: string; suffix: string; size: number }> = []
  for (const suffix of ["", "-wal", "-shm"]) {
    const info = await regular(files.database + suffix)
    if (info) current.push({ file: files.database + suffix, suffix, size: info.size })
  }
  await assertUpdateFreeSpace(files.root, Math.max(1, current.reduce((sum, file) => sum + file.size, 0)))
  const failed = path.join(files.root, `failed-${randomBytes(16).toString("hex")}-data.db`)
  for (const entry of current) {
    await copyFile(entry.file, failed + entry.suffix, constants.COPYFILE_EXCL)
    await chmod(failed + entry.suffix, 0o600)
    await sync(failed + entry.suffix)
  }
  await syncUnixUpdateDirectory(files.root)
  const temporary = files.database + `.restore-${randomBytes(16).toString("hex")}.tmp`
  try {
    if (record.existed) {
      await assertUpdateFreeSpace(path.dirname(files.database), record.size! + 1024 ** 2)
      await copyFile(files.data, temporary, constants.COPYFILE_EXCL)
      await chmod(temporary, 0o600)
      await verify(temporary, record)
      await sync(temporary)
    }
    // WAL/SHM относятся к уже остановленной B; не переносим их в восстановленную A.
    for (const entry of current.filter(file => file.suffix)) await rm(entry.file)
    if (record.existed) await rename(temporary, files.database)
    else if (current.some(file => !file.suffix)) await rm(files.database)
    await syncUnixUpdateDirectory(path.dirname(files.database))
  } finally { await rm(temporary, { force: true }) }
}
