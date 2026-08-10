import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { app } from "electron"
import initSqlJs from "sql.js"
import type { DbAccount } from "@xnlc/types" with { "resolution-mode": "import" }

// Re-export for backward compatibility with existing imports
export type { DbAccount }

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

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
  return dir
}

const dbPath = path.join(getDataDir(), "data.db")
const tmpDbPath = path.join(getDataDir(), "data.db.tmp")
const nodeRequire = createRequire(__filename)

let dbInitialized = false
let dbAvailable = true
let dbFallbackMode = false
let sqlModulePromise: Promise<SqlJsModule> | null = null
let database: SqlJsDatabase | null = null
let persistTimer: NodeJS.Timeout | null = null

const inMemoryAccounts = new Map<string, DbAccount>()
const inMemoryBuilds = new Map<string, BuildJson>()
const inMemorySettings = new Map<string, string>()

const DEFAULT_SETTINGS: Record<string, string> = {
  onboardingCompleted: "false",
  authlibInjectorEnabled: "false",
  retroauthInjectorEnabled: "true",
  showSnapshot: "false",
  showBeta: "false",
  showAlpha: "false",
  memoryMin: "512M",
  memoryMax: "4G",
  javaPath: "",
  javaArgs: "",
  useBmclapi: "false",
  autoJoinServer: "false",
  server: "",
  serverPort: "25565",
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

function run(sql: string, params: unknown[] = []) {
  try {
    ensureDatabase().run(sql, params)
  } catch (e) {
    console.error(`[DB] SQL error running: ${sql}`)
    console.error(`[DB] Params (${params.length}):`, params.map((p, i) => `${i + 1}: ${typeof p} = ${JSON.stringify(p)}`).join(", "))
    throw e
  }
}

async function writeDatabaseToDisk() {
  if (!database) {
    return
  }
  try {
    const bytes = Buffer.from(database.export())
    await fs.mkdir(path.dirname(dbPath), { recursive: true }).catch(() => {})
    // Atomic write: write to tmp file first, then rename over data.db.
    // If the process dies mid-write, data.db stays intact (never truncated to 0 bytes).
    await fs.writeFile(tmpDbPath, bytes)
    await fs.rename(tmpDbPath, dbPath)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`[DB] writeDatabaseToDisk() FAILED: ${message}`)
    throw error
  }
}

function persistDatabase() {
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

function flushDatabasePersistence() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }

  if (database) {
    writeDatabaseToDisk()
  }
}

// Synchronous flush used on the 'exit' event and 'will-quit' — async fs writes
// cannot complete before the process terminates, which previously left data.db
// truncated to 0 bytes and wiped all user data on the next launch.
function flushDatabasePersistenceSync() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }

  if (!database) {
    return
  }

  try {
    const bytes = Buffer.from(database.export())
    fsSync.mkdirSync(path.dirname(dbPath), { recursive: true })
    fsSync.writeFileSync(tmpDbPath, bytes)
    fsSync.renameSync(tmpDbPath, dbPath)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`[DB] flushDatabasePersistenceSync() FAILED: ${message}`)
  }
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
      loaderVersion TEXT,
      icon TEXT NOT NULL DEFAULT '',
      coverImage TEXT,
      mods TEXT NOT NULL DEFAULT '[]',
      resourcepacks TEXT NOT NULL DEFAULT '[]',
      shaders TEXT NOT NULL DEFAULT '[]',
      intentPath TEXT NOT NULL DEFAULT '',
      installedMods TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      projectSlug TEXT,
      playtime INTEGER NOT NULL DEFAULT 0
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS cloud_configs (
      provider TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )
  `)

  const accountColumns = queryAll<{ name: string }>("PRAGMA table_info(accounts)")

  if (Array.isArray(accountColumns) && !accountColumns.some((column) => column.name === "refreshToken")) {
    run("ALTER TABLE accounts ADD COLUMN refreshToken TEXT")
  }

  if (Array.isArray(accountColumns) && !accountColumns.some((column) => column.name === "clientId")) {
    run("ALTER TABLE accounts ADD COLUMN clientId TEXT")
  }

  const buildColumns = queryAll<{ name: string }>("PRAGMA table_info(builds)")

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "resourcepacks")) {
    run("ALTER TABLE builds ADD COLUMN resourcepacks TEXT NOT NULL DEFAULT '[]'")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "shaders")) {
    run("ALTER TABLE builds ADD COLUMN shaders TEXT NOT NULL DEFAULT '[]'")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "playtime")) {
    run("ALTER TABLE builds ADD COLUMN playtime INTEGER NOT NULL DEFAULT 0")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "intentPath")) {
    run("ALTER TABLE builds ADD COLUMN intentPath TEXT NOT NULL DEFAULT ''")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "installedMods")) {
    run("ALTER TABLE builds ADD COLUMN installedMods TEXT NOT NULL DEFAULT '{}'")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "loaderVersion")) {
    run("ALTER TABLE builds ADD COLUMN loaderVersion TEXT")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "coverImage")) {
    run("ALTER TABLE builds ADD COLUMN coverImage TEXT")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "projectSlug")) {
    run("ALTER TABLE builds ADD COLUMN projectSlug TEXT")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "javaOverride")) {
    run("ALTER TABLE builds ADD COLUMN javaOverride INTEGER NOT NULL DEFAULT 0")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "javaPath")) {
    run("ALTER TABLE builds ADD COLUMN javaPath TEXT NOT NULL DEFAULT ''")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "javaArgs")) {
    run("ALTER TABLE builds ADD COLUMN javaArgs TEXT NOT NULL DEFAULT ''")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "memoryMin")) {
    run("ALTER TABLE builds ADD COLUMN memoryMin TEXT NOT NULL DEFAULT ''")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "memoryMax")) {
    run("ALTER TABLE builds ADD COLUMN memoryMax TEXT NOT NULL DEFAULT ''")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "serverOverride")) {
    run("ALTER TABLE builds ADD COLUMN serverOverride INTEGER NOT NULL DEFAULT 0")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "server")) {
    run("ALTER TABLE builds ADD COLUMN server TEXT NOT NULL DEFAULT ''")
  }

  if (Array.isArray(buildColumns) && !buildColumns.some((column) => column.name === "serverPort")) {
    run("ALTER TABLE builds ADD COLUMN serverPort TEXT NOT NULL DEFAULT ''")
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
    let data: Buffer | undefined
    try {
      data = await fs.readFile(dbPath)
    } catch {}
    if (!data || data.length === 0) {
      // data.db is missing or empty (previously caused by an interrupted async write
      // truncating the file). Try to recover the last good snapshot from the tmp file.
      try {
        const tmpData = await fs.readFile(tmpDbPath)
        data = tmpData
      } catch {}
    }
    database = new SQL.Database(data ? new Uint8Array(data) : undefined)
    initializeSchema()
    flushDatabasePersistence()
  } catch (error) {
    dbAvailable = false
    dbFallbackMode = true
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

export function isUsingFallbackStorage(): boolean {
  return dbFallbackMode
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

  const accountParams: unknown[] = [
    normalizedAccount.id,
    normalizedAccount.type,
    normalizedAccount.username,
    normalizedAccount.isActive ? 1 : 0,
    normalizedAccount.uuid ?? null,
    normalizedAccount.accessToken ?? null,
    normalizedAccount.refreshToken ?? null,
    normalizedAccount.clientId ?? null,
    normalizedAccount.skinUrl ?? null,
  ]
  for (let i = 0; i < accountParams.length; i++) {
    const v = accountParams[i]
    if (v === undefined || typeof v === "boolean" || typeof v === "bigint") {
      console.error(`[DB] saveAccount param ${i + 1} for account ${normalizedAccount.id} has unexpected type: ${typeof v}, value: ${JSON.stringify(v)}, coercing to null`)
      accountParams[i] = null
    }
  }
  run(`
    INSERT OR REPLACE INTO accounts (id, type, username, isActive, uuid, accessToken, refreshToken, clientId, skinUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, accountParams)

  persistDatabase()
}

type BuildJson = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon: string
  coverImage?: string
  mods: unknown[]
  resourcepacks?: unknown[]
  shaders?: unknown[]
  createdAt: string
  source: "local" | "modrinth" | "curseforge"
  projectSlug?: string
  intentPath?: string
  installedMods?: Record<string, string>
  playtime: number
  javaOverride?: boolean
  javaPath?: string
  javaArgs?: string
  memoryMin?: string
  memoryMax?: string
  serverOverride?: boolean
  server?: string
  serverPort?: string
}

type BuildRow = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion: string | null
  icon: string
  coverImage: string | null
  mods: string
  resourcepacks: string
  shaders: string
  intentPath: string
  installedMods: string
  createdAt: string
  source: string
  projectSlug: string | null
  playtime: number
  javaOverride: number | null
  javaPath: string | null
  javaArgs: string | null
  memoryMin: string | null
  memoryMax: string | null
  serverOverride: number | null
  server: string | null
  serverPort: string | null
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
    loaderVersion: row.loaderVersion ?? undefined,
    icon: row.icon,
    coverImage: row.coverImage ?? undefined,
    mods: JSON.parse(row.mods),
    resourcepacks: JSON.parse(row.resourcepacks || "[]"),
    shaders: JSON.parse(row.shaders || "[]"),
    createdAt: row.createdAt,
    source: row.source as BuildJson["source"],
    projectSlug: row.projectSlug ?? undefined,
    intentPath: row.intentPath || undefined,
    installedMods: JSON.parse(row.installedMods || "{}"),
    playtime: row.playtime ?? 0,
    javaOverride: row.javaOverride === 1,
    javaPath: row.javaPath || undefined,
    javaArgs: row.javaArgs || undefined,
    memoryMin: row.memoryMin || undefined,
    memoryMax: row.memoryMax || undefined,
    serverOverride: row.serverOverride === 1,
    server: row.server || undefined,
    serverPort: row.serverPort || undefined,
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
      const params: unknown[] = [
        build.id,
        build.name,
        build.description,
        build.version,
        build.modLoader,
        build.loaderVersion ?? null,
        build.icon,
        build.coverImage ?? null,
        JSON.stringify(build.mods),
        JSON.stringify(build.resourcepacks ?? []),
        JSON.stringify(build.shaders ?? []),
        build.intentPath ?? "",
        JSON.stringify(build.installedMods ?? {}),
        build.createdAt,
        build.source,
        build.projectSlug ?? null,
        build.playtime ?? 0,
        build.javaOverride ? 1 : 0,
        build.javaPath ?? "",
        build.javaArgs ?? "",
        build.memoryMin ?? "",
        build.memoryMax ?? "",
        build.serverOverride ? 1 : 0,
        build.server ?? "",
        build.serverPort ?? "",
      ]
      for (let i = 0; i < params.length; i++) {
        const v = params[i]
        if (v === undefined || (typeof v === "object" && v !== null) || typeof v === "boolean" || typeof v === "bigint") {
          console.error(`[DB] saveAllBuilds param ${i + 1} for build ${build.id} has unexpected type: ${typeof v}, value: ${JSON.stringify(v)}, coercing to null`)
          params[i] = null
        }
      }
      run(`
        INSERT OR REPLACE INTO builds (id, name, description, version, modLoader, loaderVersion, icon, coverImage, mods, resourcepacks, shaders, intentPath, installedMods, createdAt, source, projectSlug, playtime, javaOverride, javaPath, javaArgs, memoryMin, memoryMax, serverOverride, server, serverPort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, params)
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

export async function updateBuildPlaytime(buildId: string, seconds: number): Promise<void> {
  if (!dbAvailable) {
    const build = inMemoryBuilds.get(buildId)
    if (build) {
      build.playtime = (build.playtime ?? 0) + seconds
    }
    return
  }

  run("UPDATE builds SET playtime = playtime + ? WHERE id = ?", [seconds, buildId])
  persistDatabase()
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
  updateBuildPlaytime,
  getLauncherDirectory: async () => ensureDir(getDataDir()),
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
  getCloudConfig: async (provider: string): Promise<string | null> => {
    if (!dbAvailable) return null

    const rows = queryAll<{ data?: string }>("SELECT data FROM cloud_configs WHERE provider = ?", [provider])
    if (!Array.isArray(rows) || rows.length === 0) return null
    return rows[0].data ?? null
  },
  setCloudConfig: async (provider: string, data: string): Promise<void> => {
    if (!dbAvailable) return

    run("INSERT OR REPLACE INTO cloud_configs (provider, data) VALUES (?, ?)", [provider, data])
    persistDatabase()
  },
  removeCloudConfig: async (provider: string): Promise<void> => {
    if (!dbAvailable) return

    run("DELETE FROM cloud_configs WHERE provider = ?", [provider])
    persistDatabase()
  },
}

process.once("beforeExit", flushDatabasePersistence)
process.once("exit", flushDatabasePersistenceSync)
app.on("will-quit", () => {
  flushDatabasePersistenceSync()
})
