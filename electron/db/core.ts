import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { createRequire } from "node:module"
import initSqlJs from "sql.js"
import { getLauncherDataRoot } from "../main/paths"
import { ensureDir } from "../main/utils/fs"

export type SqlJsDatabase = {
  run: (sql: string, params?: unknown[] | Record<string, unknown>) => void
  exec: (sql: string, params?: unknown[] | Record<string, unknown>) => Array<{ columns: string[]; values: unknown[][] }>
  export: () => Uint8Array
  close: () => void
}

type SqlJsModule = {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase
}

function getDataDir(): string {
  return getLauncherDataRoot()
}

export const dbPath = path.join(getDataDir(), "data.db")
export const tmpDbPath = path.join(getDataDir(), "data.db.tmp")
const nodeRequire = createRequire(__filename)

let dbInitialized = false
let dbAvailable = true
let dbFallbackMode = false
let sqlModulePromise: Promise<SqlJsModule> | null = null
let database: SqlJsDatabase | null = null
let persistTimer: NodeJS.Timeout | null = null

export const inMemoryAccounts = new Map<string, unknown>()
export const inMemoryBuilds = new Map<string, unknown>()
export const inMemorySettings = new Map<string, string>()

export function isDbAvailable(): boolean {
  return dbAvailable
}

export function isDbFallbackMode(): boolean {
  return dbFallbackMode
}

export function getDatabase(): SqlJsDatabase {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  return database
}

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  let result: Array<{ columns: string[]; values: unknown[][] }>
  try {
    result = db.exec(sql, params)
  } catch (e) {
    console.error(`[DB] queryAll SQL error running: ${sql}`)
    console.error(`[DB] queryAll Params (${params.length}):`, params.map((p, i) => `${i + 1}: ${typeof p} = ${JSON.stringify(p)}`).join(", "))
    throw e
  }
  if (!Array.isArray(result) || result.length === 0) {
    return []
  }

  const [first] = result
  const columns = first?.columns ?? []
  const values = first?.values ?? []

  return values.map((row) => {
    const entry: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      entry[column] = row[index]
    })
    return entry as T
  })
}

export function run(sql: string, params: unknown[] = []) {
  try {
    getDatabase().run(sql, params)
  } catch (e) {
    console.error(`[DB] SQL error running: ${sql}`)
    console.error(`[DB] Params (${params.length}):`, params.map((p, i) => `${i + 1}: ${typeof p} = ${JSON.stringify(p)}`).join(", "))
    throw e
  }
}

async function persistBytes(bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true }).catch(() => {})
  await fs.writeFile(tmpDbPath, bytes)
  await fs.rename(tmpDbPath, dbPath)
}

function persistBytesSync(bytes: Uint8Array): void {
  fsSync.mkdirSync(path.dirname(dbPath), { recursive: true })
  fsSync.writeFileSync(tmpDbPath, bytes)
  fsSync.renameSync(tmpDbPath, dbPath)
}

export async function writeDatabaseToDisk() {
  if (!database) {
    return
  }
  try {
    const bytes = Buffer.from(database.export())
    await persistBytes(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`[DB] writeDatabaseToDisk() FAILED: ${message}`)
    throw error
  }
}

export function persistDatabase() {
  if (!database) {
    return
  }

  if (persistTimer) {
    clearTimeout(persistTimer)
  }

  persistTimer = setTimeout(() => {
    persistTimer = null
    writeDatabaseToDisk()
  }, 75)
}

export function flushDatabasePersistence() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }

  if (database) {
    writeDatabaseToDisk()
  }
}

export function flushDatabasePersistenceSync() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }

  if (!database) {
    return
  }

  try {
    const bytes = Buffer.from(database.export())
    persistBytesSync(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`[DB] flushDatabasePersistenceSync() FAILED: ${message}`)
  }
}

function getSqlModule(): Promise<SqlJsModule> {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file: string) => nodeRequire.resolve(`sql.js/dist/${file}`),
    }) as Promise<SqlJsModule>
  }
  return sqlModulePromise
}

export async function initDatabaseCore(): Promise<void> {
  if (dbInitialized) return

  try {
    const SQL = await getSqlModule()
    let data: Buffer | undefined
    try {
      data = await fs.readFile(dbPath)
    } catch {}
    if (!data || data.length === 0) {
      try {
        const tmpData = await fs.readFile(tmpDbPath)
        data = tmpData
      } catch {}
    }
    database = new SQL.Database(data ? new Uint8Array(data) : undefined)
  } catch (error) {
    dbAvailable = false
    dbFallbackMode = true
    console.error("[DB] Falling back to in-memory storage:", error)
    try {
      database?.close()
    } catch {}
    database = null
  }

  dbInitialized = true
}

export function getLauncherDirectory(): Promise<string> {
  return ensureDir(getDataDir())
}
