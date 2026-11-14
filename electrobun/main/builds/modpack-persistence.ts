import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { queryAll, run, transactionImmediate } from "../../db/core"
import { getBuildIntentPath, getInstancesRoot } from "./helpers"
import { isModpackInstalling, recoverModpackInstall, setModpackPersistence, type ModpackPersistencePort } from "./modpack-install"
import { PACK_METADATA_FIELDS } from "../../../lib/build-content-patch"

/** Только поля, которыми владеет обновление пака; настройки пользователя не откатываются. */
const OWNED_FIELDS = PACK_METADATA_FIELDS
const owned = new Set<string>(OWNED_FIELDS)
const locked = new Set<string>([...OWNED_FIELDS, "name", "intentPath"])
const lists = new Set(["mods", "resourcepacks", "shaders"])
const numbers = new Set(["modId", "fileId", "modsCount", "resourcepacksCount", "shadersCount"])
const rootKey = (root: string) => process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root)
type Backup = { token: string; build_id: string; root: string; state: "prepared" | "applied" | "rolled-back" }
const snapshotJson = `json_object(${OWNED_FIELDS.map(field => `'${field}',[${field}]`).join(",")})`

export function assertBuildMetadataIdle(buildId: string, fields: Record<string, unknown>): void {
  if (!Object.keys(fields).some(field => locked.has(field))) return
  const row = queryAll<{ name: string; intentPath: string | null }>("SELECT name,intentPath FROM builds WHERE id=?", [buildId])[0]
  const roots: string[] = []
  if (row) roots.push(row.intentPath && path.isAbsolute(row.intentPath) ? row.intentPath : getBuildIntentPath(row.name))
  if (typeof fields.intentPath === "string" && path.isAbsolute(fields.intentPath)) roots.push(fields.intentPath)
  if (typeof fields.name === "string") roots.push(getBuildIntentPath(fields.name))
  if (roots.some(isModpackInstalling)) throw Object.assign(new Error("MODPACK_BUSY"), { code: "MODPACK_BUSY" })
}

function backup(root: string, token: string, allowMissing = false): Backup | undefined {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)) throw new Error("Invalid metadata backup token")
  const row = queryAll<Backup>("SELECT token,build_id,root,state FROM modpack_metadata_backups WHERE token=?", [token])[0]
  if (!row) { if (allowMissing) return undefined; throw new Error("Modpack metadata backup is missing; recovery stopped") }
  if (rootKey(row.root) !== rootKey(root)) throw new Error("Modpack metadata backup belongs to another directory")
  return row
}

function binding(field: string, value: unknown): string | number | null {
  if (lists.has(field)) {
    if (value !== undefined && !Array.isArray(value)) throw new Error("Invalid modpack content metadata")
    return JSON.stringify(value ?? [])
  }
  if (field === "installedMods") {
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("Invalid installed mod metadata")
    return JSON.stringify(value ?? {})
  }
  if (value == null) return null
  if (numbers.has(field)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid modpack metadata number")
    return value
  }
  if (typeof value !== "string" || value.length > 1024 * 1024) throw new Error("Invalid modpack metadata string")
  return value
}

export function createModpackSqlPersistence(): ModpackPersistencePort {
  return {
    async verify(root, token, committed) {
      const row = backup(root, token, committed)
      if (committed && row && row.state !== "applied") throw new Error("Committed modpack metadata state is inconsistent")
    },
    async begin(root, buildId) {
      if (typeof buildId !== "string" || !buildId || buildId.length > 512) throw new Error("Invalid target build")
      const row = queryAll<{ id: string; name: string; intentPath: string | null }>("SELECT id,name,intentPath FROM builds WHERE id=?", [buildId])[0]
      if (!row) throw new Error("Target build no longer exists")
      const expected = row.intentPath && path.isAbsolute(row.intentPath) ? row.intentPath : getBuildIntentPath(row.name)
      if (rootKey(await fs.realpath(expected)) !== rootKey(root)) throw new Error("Target build directory changed during import")
      const token = randomUUID()
      transactionImmediate(() => {
        // Большие JSON списки копирует SQLite: filesystem journal хранит лишь token.
        const result = run(`INSERT INTO modpack_metadata_backups(token,build_id,root,state,data) SELECT ?,id,?,'prepared',${snapshotJson} FROM builds WHERE id=?`, [token, root, buildId])
        if (result.changes !== 1) throw new Error("Could not prepare metadata backup")
      })
      return token
    },
    async write(root, token, fields) {
      const row = backup(root, token)!
      if (row.state !== "prepared") throw new Error("Modpack metadata transaction is not pending")
      const entries = Object.entries(fields)
      if (entries.some(([field]) => !owned.has(field))) throw new Error("Modpack metadata cannot overwrite user settings")
      const values = entries.map(([field, value]) => binding(field, value))
      transactionImmediate(() => {
        if (entries.length) {
          const result = run(`UPDATE builds SET ${entries.map(([field]) => `[${field}]=?`).join(",")} WHERE id=?`, [...values, row.build_id])
          if (result.changes !== 1) throw new Error("Target build disappeared during metadata commit")
        }
        run("UPDATE modpack_metadata_backups SET state='applied' WHERE token=?", [token])
      })
    },
    async rollback(root, token) {
      const row = backup(root, token)!
      if (row.state === "rolled-back") return
      transactionImmediate(() => {
        const result = run(`UPDATE builds SET (${OWNED_FIELDS.map(field => `[${field}]`).join(",")})=(SELECT ${OWNED_FIELDS.map(field => `json_extract(data,'$.${field}')`).join(",")} FROM modpack_metadata_backups WHERE token=?) WHERE id=?`, [token, row.build_id])
        if (result.changes !== 1) throw new Error("Target build is missing; metadata snapshot retained")
        // Tombstone остаётся до удаления file journal: повторная recovery идемпотентна.
        run("UPDATE modpack_metadata_backups SET state='rolled-back' WHERE token=?", [token])
      })
    },
    async finalize(root, token) {
      const row = backup(root, token, true)
      if (!row) return
      if (row.state === "prepared") throw new Error("Unapplied metadata backup cannot be finalized")
      run("DELETE FROM modpack_metadata_backups WHERE token=?", [token])
    },
  }
}

/** Вызывается после открытия SQLite/instances root, ДО startup:ready и rename migration. */
export async function recoverManagedModpackInstalls(): Promise<void> {
  const port = createModpackSqlPersistence()
  setModpackPersistence(port)
  const pending = queryAll<Backup>("SELECT token,build_id,root,state FROM modpack_metadata_backups")
  const roots = new Set(pending.map(row => row.root))
  for (const row of queryAll<{ name: string; intentPath: string | null }>("SELECT name,intentPath FROM builds")) {
    roots.add(row.intentPath && path.isAbsolute(row.intentPath) ? row.intentPath : getBuildIntentPath(row.name))
  }
  const intents = path.join(getInstancesRoot(), "intents")
  const entries = await fs.readdir(intents, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error })
  for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")) roots.add(path.join(intents, entry.name))
  for (const root of roots) {
    const stat = await fs.lstat(root).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue
    const journal = path.join(root, ".xnlc-modpack/transaction/journal.json")
    if (await fs.lstat(journal).then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error })) await recoverModpackInstall(root)
  }
  // Begin мог завершиться до записи file journal. Prepared не менял metadata;
  // rolled-back уже восстановлен. Applied без journal — конфликт, не повод терять backup.
  for (const row of queryAll<Backup>("SELECT token,build_id,root,state FROM modpack_metadata_backups")) {
    const exists = await fs.lstat(path.join(row.root, ".xnlc-modpack/transaction/journal.json"))
      .then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error })
    if (exists) throw new Error("Modpack journal could not be recovered; metadata snapshot retained")
    if (row.state === "applied") throw new Error("Applied modpack metadata has no file journal; snapshot retained")
    run("DELETE FROM modpack_metadata_backups WHERE token=? AND state IN ('prepared','rolled-back')", [row.token])
  }
}
