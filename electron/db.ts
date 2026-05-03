import path from "path"
import fs from "fs"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { app } from "electron"
import initSqlJs from "sql.js"

type SqlJsDatabase = {
  run: (sql: string, params?: unknown[] | Record<string, unknown>) => void
  exec: (sql: string, params?: unknown[] | Record<string, unknown>) => Array<{ columns: string[]; values: unknown[][] }>
  export: () => Uint8Array
  close: () => void
}

type SqlJsModule = {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase
}

function getDataDir(): string {
  if (process.platform === "win32") {
    return path.join(app.getPath("appData"), "xneonlauncher")
  }
  if (process.platform === "darwin") {
    return path.join(app.getPath("home"), "Library", "Application Support", "xneonlauncher")
  }
  return path.join(app.getPath("home"), ".xneonlauncher")
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

const dbPath = path.join(ensureDir(getDataDir()), "data.db")
const nodeRequire = createRequire(__filename)

let dbInitialized = false
let dbAvailable = true
let sqlModulePromise: Promise<SqlJsModule> | null = null
let database: SqlJsDatabase | null = null

const inMemoryAccounts = new Map<string, DbAccount>()
const inMemoryBuilds = new Map<string, BuildJson>()
const inMemorySettings = new Map<string, string>()

const DEFAULT_SETTINGS: Record<string, string> = {
  authlibInjectorEnabled: "false",
  retroauthInjectorEnabled: "true",
  showSnapshot: "false",
  showBeta: "false",
  showAlpha: "false",
  memoryMin: "2G",
  memoryMax: "4G",
  javaPath: "",
  javaArgs: "",
}

function ensureInMemoryDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!inMemorySettings.has(key)) {
      inMemorySettings.set(key, value)
    }
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

function ensureDatabase(): SqlJsDatabase {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  return database
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = ensureDatabase()
  const result = db.exec(sql, params)
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

function run(sql: string, params: unknown[] = []) {
  ensureDatabase().run(sql, params)
}

function persistDatabase() {
  if (!database) {
    return
  }
  ensureDir(path.dirname(dbPath))
  fs.writeFileSync(dbPath, Buffer.from(database.export()))
}

function initializeSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      username TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 0,
      uuid TEXT,
      accessToken TEXT,
      refreshToken TEXT,
      clientId TEXT,
      skinUrl TEXT
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL,
      modLoader TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      coverImage TEXT,
      mods TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      projectSlug TEXT
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  const accountColumns = queryAll<{ name: string }>("PRAGMA table_info(accounts)")

  if (Array.isArray(accountColumns) && !accountColumns.some((column) => column.name === "refreshToken")) {
    run("ALTER TABLE accounts ADD COLUMN refreshToken TEXT")
  }

  if (Array.isArray(accountColumns) && !accountColumns.some((column) => column.name === "clientId")) {
    run("ALTER TABLE accounts ADD COLUMN clientId TEXT")
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value])
  }
}

export async function initDatabase(): Promise<void> {
  if (dbInitialized) return

  ensureInMemoryDefaults()

  try {
    const SQL = await getSqlModule()
    const data = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined
    database = new SQL.Database(data ? new Uint8Array(data) : undefined)
    initializeSchema()
    persistDatabase()
  } catch (error) {
    dbAvailable = false
    console.error("[DB] Falling back to in-memory storage:", error)
    try {
      database?.close()
    } catch {
      // ignore close errors
    }
    database = null
  }

  dbInitialized = true
}

export type DbAccount = {
  id: string
  type: "elyby" | "xnskins" | "microsoft" | "offline"
  username: string
  isActive: boolean
  uuid?: string
  accessToken?: string
  refreshToken?: string
  clientId?: string
  skinUrl?: string
}

function normalizeOfflineAccount(account: DbAccount): DbAccount {
  if (account.type !== "offline") {
    return account
  }

  const offlineAuth = createOfflineAuth(account.username)

  return {
    ...account,
    uuid: account.uuid ?? offlineAuth.uuid,
    accessToken: account.accessToken ?? offlineAuth.accessToken,
  }
}

function createOfflineAuth(username: string): { uuid: string; accessToken: string } {
  const data = `OfflinePlayer:${username}`
  const hash = crypto.createHash("md5").update(data, "utf8").digest()
  hash[6] = (hash[6]! & 0x0f) | 0x30
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.toString("hex")

  return {
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
    accessToken: "0",
  }
}

type AccountRow = {
  id: string
  type: string
  username: string
  isActive: number
  uuid: string | null
  accessToken: string | null
  refreshToken: string | null
  clientId: string | null
  skinUrl: string | null
}

export async function loadAccounts(): Promise<DbAccount[]> {
  if (!dbAvailable) {
    return Array.from(inMemoryAccounts.values()).map(normalizeOfflineAccount)
  }

  const rows = queryAll<AccountRow>("SELECT * FROM accounts")
  if (!Array.isArray(rows)) return []

  return rows.map((row) => normalizeOfflineAccount({
    id: row.id,
    type: row.type as DbAccount["type"],
    username: row.username,
    isActive: row.isActive === 1,
    uuid: row.uuid ?? undefined,
    accessToken: row.accessToken ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    clientId: row.clientId ?? undefined,
    skinUrl: row.skinUrl ?? undefined,
  }))
}

export async function saveAccount(account: DbAccount): Promise<void> {
  const normalizedAccount = normalizeOfflineAccount(account)

  if (!dbAvailable) {
    if (normalizedAccount.isActive) {
      for (const [id, existing] of inMemoryAccounts.entries()) {
        inMemoryAccounts.set(id, { ...existing, isActive: id === normalizedAccount.id })
      }
    }
    inMemoryAccounts.set(normalizedAccount.id, normalizedAccount)
    return
  }

  run(`
    INSERT OR REPLACE INTO accounts (id, type, username, isActive, uuid, accessToken, refreshToken, clientId, skinUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    normalizedAccount.id,
    normalizedAccount.type,
    normalizedAccount.username,
    normalizedAccount.isActive ? 1 : 0,
    normalizedAccount.uuid ?? null,
    normalizedAccount.accessToken ?? null,
    normalizedAccount.refreshToken ?? null,
    normalizedAccount.clientId ?? null,
    normalizedAccount.skinUrl ?? null,
  ])

  persistDatabase()
}

type BuildJson = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  icon: string
  coverImage?: string
  mods: unknown[]
  createdAt: string
  source: "local" | "modrinth" | "curseforge"
  projectSlug?: string
}

type BuildRow = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  icon: string
  coverImage: string | null
  mods: string
  createdAt: string
  source: string
  projectSlug: string | null
}

export async function loadBuilds(): Promise<BuildJson[]> {
  if (!dbAvailable) {
    return Array.from(inMemoryBuilds.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  const rows = queryAll<BuildRow>("SELECT * FROM builds ORDER BY createdAt DESC")
  if (!Array.isArray(rows)) return []

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    modLoader: row.modLoader,
    icon: row.icon,
    coverImage: row.coverImage ?? undefined,
    mods: JSON.parse(row.mods),
    createdAt: row.createdAt,
    source: row.source as BuildJson["source"],
    projectSlug: row.projectSlug ?? undefined,
  }))
}

export async function saveAllBuilds(builds: BuildJson[]): Promise<void> {
  if (!dbAvailable) {
    inMemoryBuilds.clear()
    for (const build of builds) {
      inMemoryBuilds.set(build.id, build)
    }
    return
  }

  run("BEGIN")
  try {
    run("DELETE FROM builds")
    for (const build of builds) {
      run(`
        INSERT OR REPLACE INTO builds (id, name, description, version, modLoader, icon, coverImage, mods, createdAt, source, projectSlug)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        build.id,
        build.name,
        build.description,
        build.version,
        build.modLoader,
        build.icon,
        build.coverImage ?? null,
        JSON.stringify(build.mods),
        build.createdAt,
        build.source,
        build.projectSlug ?? null,
      ])
    }
    run("COMMIT")
    persistDatabase()
  } catch (error) {
    try {
      run("ROLLBACK")
    } catch {
      // ignore rollback errors
    }
    throw error
  }
}

export const dbHelpers = {
  loadAccounts,
  saveAccount,
  removeAccount: async (id: string): Promise<void> => {
    if (!dbAvailable) {
      inMemoryAccounts.delete(id)
      return
    }

    run("DELETE FROM accounts WHERE id = ?", [id])
    persistDatabase()
  },
  loadBuilds,
  saveAllBuilds,
  getLauncherDirectory: () => ensureDir(getDataDir()),
  getSetting: async (key: string): Promise<string | undefined> => {
    if (!dbAvailable) {
      ensureInMemoryDefaults()
      return inMemorySettings.get(key)
    }

    const rows = queryAll<{ value?: string }>("SELECT value FROM settings WHERE key = ?", [key])
    if (!Array.isArray(rows) || rows.length === 0) return undefined
    return rows[0].value
  },
  setSetting: async (key: string, value: string): Promise<void> => {
    if (!dbAvailable) {
      inMemorySettings.set(key, value)
      return
    }

    run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value])
    persistDatabase()
  },
}
