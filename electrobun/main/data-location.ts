import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath, pathToFileURL } from "node:url"
import Database from "../platform/sqlite"

export interface InstancesMove { id: string; source: string; target: string }
/** root/profile сохраняют совместимость с уже перенесёнными данными старой версии. */
export interface DataLocation { root: string; profile?: string; relocated?: boolean; pending?: unknown; pendingInstances?: InstancesMove; error?: string }

function pathKey(file: string) { const absolute = path.resolve(file); return process.platform === "win32" ? absolute.toLowerCase() : absolute }
function same(a: string, b: string) { return pathKey(a) === pathKey(b) }
function inside(root: string, target: string) {
  const relative = path.relative(pathKey(root), pathKey(target))
  return !relative || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function canonical(file: string): string {
  if (fs.existsSync(file)) return fs.realpathSync.native(file)
  const parent = path.dirname(file)
  return parent === file ? file : path.join(canonical(parent), path.basename(file))
}
export function validateDataMove(source: string, target: string): void {
  if (!path.isAbsolute(target)) throw new Error("DATA_PATH_ABSOLUTE")
  const from = canonical(source), to = canonical(target)
  if (same(from, to)) return
  if (inside(from, to) || inside(to, from)) throw new Error("DATA_PATH_NESTED")
  if (fs.existsSync(to) && (!fs.statSync(to).isDirectory() || fs.readdirSync(to).length)) throw new Error("DATA_PATH_NOT_EMPTY")
}
export function readDataLocation(config: string, fallback: string): DataLocation {
  try {
    const state = JSON.parse(fs.readFileSync(config, "utf8")) as DataLocation
    if (!state.root || !path.isAbsolute(state.root)) throw new Error("DATA_CONFIG_INVALID")
    return state
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { root: fallback }
    throw error
  }
}
export function writeDataLocation(config: string, state: DataLocation): void {
  fs.mkdirSync(path.dirname(config), { recursive: true })
  const temporary = `${config}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(state), { flag: "wx" })
  try { fs.renameSync(temporary, config) } catch (error) { fs.unlinkSync(temporary); throw error }
}
/** Переписываем только пути и JSON-значения, не произвольный текст сообщений. */
export function relocateDataValue(value: string, mappings: Array<[string, string]>): string {
  for (const [from, to] of [...mappings].sort((a, b) => b[0].length - a[0].length)) {
    const isUrl = value.startsWith("file:")
    let candidate = value
    if (isUrl) { try { candidate = fileURLToPath(value) } catch { continue } }
    if (!path.isAbsolute(candidate) || !inside(from, candidate)) continue
    const changed = path.join(to, path.relative(from, candidate))
    return isUrl ? pathToFileURL(changed).href : changed
  }
  if (!/^[\s]*[\[{]/.test(value)) return value
  try {
    const map = (data: unknown): unknown => typeof data === "string" ? relocateDataValue(data, mappings) : Array.isArray(data) ? data.map(map) : data && typeof data === "object" ? Object.fromEntries(Object.entries(data).map(([key, item]) => [key, map(item)])) : data
    const original = JSON.parse(value), next = map(original)
    return JSON.stringify(next) === JSON.stringify(original) ? value : JSON.stringify(next)
  } catch { return value }
}
export function scheduleInstancesMove(config: string, state: DataLocation, source: string, target: string): DataLocation {
  const destination = path.resolve(target)
  validateDataMove(path.join(source, "intents"), path.join(destination, "intents"))
  const next: DataLocation = { ...state, pending: undefined, error: undefined,
    pendingInstances: same(source, destination) ? undefined : { id: randomUUID(), source, target: destination } }
  writeDataLocation(config, next)
  return next
}

function updateBuildPaths(databaseFile: string, source: string, target: string, root: string) {
  const db = new Database(databaseFile, { fileMustExist: true })
  const mappings: Array<[string, string]> = [[source, target]]
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'
  try {
    db.transaction(() => {
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
      if (tables.some(table => table.name === "builds")) {
        const rows = db.query("SELECT * FROM builds").all() as Array<Record<string, unknown>>
        for (const row of rows) {
          const changed = Object.entries(row).filter(([key, value]) => key !== "id" && typeof value === "string").map(([key, value]) => [key, relocateDataValue(value as string, mappings)] as const).filter(([key, value]) => value !== row[key])
          if (changed.length) db.run(`UPDATE builds SET ${changed.map(([key]) => `${quote(key)} = ?`).join(", ")} WHERE id = ?`, [...changed.map(([, value]) => value), row.id as string])
        }
      }
      if (tables.some(table => table.name === "file_snapshots")) {
        for (const row of db.query("SELECT path FROM file_snapshots").all() as Array<{ path: string }>) {
          const moved = relocateDataValue(row.path, mappings)
          if (moved !== row.path) db.run("UPDATE file_snapshots SET path = ? WHERE path = ?", [moved, row.path])
        }
      }
      db.run("INSERT INTO settings (key,value) VALUES ('instancesPath',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [root])
      if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("DATA_DATABASE_CHECK_FAILED")
    })()
    db.pragma("wal_checkpoint(TRUNCATE)")
  } finally { db.clearQueryCache(); db.close() }
}

/** Переносим только intents и ссылки на файлы сборок. */
export function migrateInstancesLocation(config: string, state: DataLocation): DataLocation {
  const move = state.pendingInstances
  if (!move) return state
  const source = path.join(move.source, "intents"), target = path.join(move.target, "intents")
  const marker = ".xneon-instances-move.json"
  let ready = false
  if (fs.existsSync(path.join(target, marker))) {
    ready = JSON.parse(fs.readFileSync(path.join(target, marker), "utf8")).id === move.id
    if (!ready) throw new Error("DATA_PATH_NOT_EMPTY")
  }
  if (!ready) {
    validateDataMove(source, target)
    fs.mkdirSync(move.target, { recursive: true })
    const staging = fs.mkdtempSync(path.join(move.target, ".xneon-instances-move-"))
    const mappings: Array<[string, string]> = [[source, target]]
    const copy = (from: string, to: string) => {
      const stat = fs.lstatSync(from)
      if (stat.isSymbolicLink()) {
        const link = path.resolve(path.dirname(from), fs.readlinkSync(from))
        fs.symlinkSync(relocateDataValue(link, mappings), to, fs.statSync(from).isDirectory() ? "junction" : "file")
      } else if (stat.isDirectory()) {
        fs.mkdirSync(to, { recursive: true })
        for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name))
      } else if (stat.isFile()) {
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
        if (from.endsWith(".json") && stat.size <= 16_000_000) {
          const text = fs.readFileSync(to, "utf8"), moved = relocateDataValue(text, mappings)
          if (text !== moved) fs.writeFileSync(to, moved)
        }
      } else throw new Error("DATA_UNSUPPORTED_FILE")
    }
    try {
      if (fs.existsSync(source)) copy(source, staging)
      fs.writeFileSync(path.join(staging, marker), JSON.stringify({ id: move.id }))
      validateDataMove(source, target)
      if (fs.existsSync(target)) fs.rmdirSync(target)
      fs.renameSync(staging, target)
    } catch (error) {
      const temporary = path.resolve(staging)
      if (path.dirname(temporary) === path.resolve(move.target) && path.basename(temporary).startsWith(".xneon-instances-move-") && !same(temporary, source) && !same(temporary, target)) {
        try { fs.rmSync(temporary, { recursive: true, force: true }) } catch { /* Исходные файлы остаются целыми. */ }
      }
      throw error
    }
  }
  updateBuildPaths(path.join(state.root, "data.db"), source, target, move.target)
  const next = { ...state, pending: undefined, pendingInstances: undefined, error: undefined }
  writeDataLocation(config, next)
  return next
}
