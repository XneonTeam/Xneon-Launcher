import { queryAll, run } from "./core"

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

function createTables() {
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
      modpackVersion TEXT,
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

  run(`
    CREATE TABLE IF NOT EXISTS resources (
      sha1 TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      projectId TEXT,
      versionId TEXT,
      modId INTEGER,
      fileId INTEGER,
      cfChecked INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL DEFAULT 0
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS file_snapshots (
      path TEXT PRIMARY KEY,
      size INTEGER NOT NULL DEFAULT 0,
      mtime INTEGER NOT NULL DEFAULT 0,
      sha1 TEXT NOT NULL DEFAULT ''
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS skin_library (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      name TEXT NOT NULL,
      filePath TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'classic',
      capeId TEXT DEFAULT NULL,
      createdAt TEXT NOT NULL
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS mc_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gameVersion TEXT NOT NULL DEFAULT '1.21.4',
      modloader TEXT NOT NULL DEFAULT 'vanilla',
      modloaderVersion TEXT,
      port INTEGER NOT NULL DEFAULT 25565,
      xmx INTEGER NOT NULL DEFAULT 2048,
      xms INTEGER NOT NULL DEFAULT 1024,
      extraJavaArgs TEXT NOT NULL DEFAULT '',
      autoRestart INTEGER NOT NULL DEFAULT 0,
      icon TEXT DEFAULT NULL,
      relayEnabled INTEGER NOT NULL DEFAULT 0,
      onlineMode INTEGER NOT NULL DEFAULT 1,
      maxPlayers INTEGER NOT NULL DEFAULT 20,
      createdAt TEXT NOT NULL,
      trashedAt TEXT DEFAULT NULL,
      customJar TEXT DEFAULT NULL
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES ai_sessions(id) ON DELETE CASCADE
    )
  `)
}

function addColumnIfMissing(table: string, column: string, ddl: string) {
  const columns = queryAll<{ name: string }>(`PRAGMA table_info(${table})`)
  if (Array.isArray(columns) && !columns.some((c) => c.name === column)) {
    run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

function migrateAccounts() {
  addColumnIfMissing("accounts", "refreshToken", "refreshToken TEXT")
  addColumnIfMissing("accounts", "clientId", "clientId TEXT")
  addColumnIfMissing("accounts", "sortOrder", "sortOrder INTEGER NOT NULL DEFAULT 0")
}

function migrateBuilds() {
  addColumnIfMissing("builds", "resourcepacks", "resourcepacks TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing("builds", "shaders", "shaders TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing("builds", "playtime", "playtime INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("builds", "intentPath", "intentPath TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "installedMods", "installedMods TEXT NOT NULL DEFAULT '{}'")
  addColumnIfMissing("builds", "loaderVersion", "loaderVersion TEXT")
  addColumnIfMissing("builds", "coverImage", "coverImage TEXT")
  addColumnIfMissing("builds", "projectSlug", "projectSlug TEXT")
  addColumnIfMissing("builds", "modpackVersion", "modpackVersion TEXT")
  addColumnIfMissing("builds", "javaOverride", "javaOverride INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("builds", "javaPath", "javaPath TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "javaArgs", "javaArgs TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "memoryMin", "memoryMin TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "memoryMax", "memoryMax TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "serverOverride", "serverOverride INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("builds", "server", "server TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "serverPort", "serverPort TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "[group]", "[group] TEXT")
}

function migrateResources() {
  addColumnIfMissing("resources", "modId", "modId INTEGER")
  addColumnIfMissing("resources", "fileId", "fileId INTEGER")
  addColumnIfMissing("resources", "cfChecked", "cfChecked INTEGER NOT NULL DEFAULT 0")
}

function migrateSkinLibrary() {
  addColumnIfMissing("skin_library", "capeId", "capeId TEXT DEFAULT NULL")
}

function migrateMcServers() {
  addColumnIfMissing("mc_servers", "javaPath", "javaPath TEXT DEFAULT NULL")
  addColumnIfMissing("mc_servers", "icon", "icon TEXT DEFAULT NULL")
  addColumnIfMissing("mc_servers", "relayEnabled", "relayEnabled INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("mc_servers", "onlineMode", "onlineMode INTEGER NOT NULL DEFAULT 1")
  addColumnIfMissing("mc_servers", "maxPlayers", "maxPlayers INTEGER NOT NULL DEFAULT 20")
  addColumnIfMissing("mc_servers", "trashedAt", "trashedAt TEXT DEFAULT NULL")
  addColumnIfMissing("mc_servers", "customJar", "customJar TEXT DEFAULT NULL")
  addColumnIfMissing("mc_servers", "source", "source TEXT NOT NULL DEFAULT 'local'")
}

function seedDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value])
  }
}

export { DEFAULT_SETTINGS }

export function initializeSchema() {
  createTables()
  migrateAccounts()
  migrateBuilds()
  migrateResources()
  migrateSkinLibrary()
  migrateMcServers()
  seedDefaultSettings()
}
