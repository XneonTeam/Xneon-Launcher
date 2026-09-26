import { queryAll, run, transaction, setUserVersion, DB_FORMAT_VERSION, isDbAvailable } from "./core"

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
      modpackVersionId TEXT,
      locked INTEGER,
      modId INTEGER,
      fileId INTEGER,
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
      createdAt TEXT NOT NULL,
      sourceId TEXT DEFAULT NULL
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
      customJar TEXT DEFAULT NULL,
      [group] TEXT DEFAULT NULL
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

  run(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id TEXT PRIMARY KEY,
      buildId TEXT NOT NULL,
      buildName TEXT NOT NULL DEFAULT '',
      startedAt INTEGER NOT NULL,
      endedAt INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0
    )
  `)

  run(`
    CREATE TABLE IF NOT EXISTS server_sessions (
      id TEXT PRIMARY KEY,
      serverId TEXT NOT NULL,
      serverName TEXT NOT NULL DEFAULT '',
      icon TEXT,
      startedAt INTEGER NOT NULL,
      endedAt INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0
    )
  `)
}

function addColumnIfMissing(table: string, column: string, ddl: string) {
  const columns = queryAll<{ name: string }>(`PRAGMA table_info(${table})`)
  // PRAGMA table_info returns bare column names — strip quoting/brackets
  // from the requested name before comparing (e.g. "[group]" → "group").
  const bareName = column.replace(/[[\]"]/g, "")
  if (Array.isArray(columns) && !columns.some((c) => c.name === bareName)) {
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
  addColumnIfMissing("builds", "modpackVersionId", "modpackVersionId TEXT")
  addColumnIfMissing("builds", "locked", "locked INTEGER")
  addColumnIfMissing("builds", "modId", "modId INTEGER")
  addColumnIfMissing("builds", "fileId", "fileId INTEGER")
  addColumnIfMissing("builds", "javaOverride", "javaOverride INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("builds", "javaPath", "javaPath TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "javaArgs", "javaArgs TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "memoryMin", "memoryMin TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "memoryMax", "memoryMax TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "serverOverride", "serverOverride INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("builds", "server", "server TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "serverPort", "serverPort TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "[group]", "[group] TEXT")
  // Настройки запуска сборки: команды до/после запуска, обёртка, переменные
  // окружения и переопределение размера окна. Без этих колонок UI их показывал,
  // но запись молча терялась — после перезапуска поля оказывались пустыми.
  addColumnIfMissing("builds", "preLaunchCommand", "preLaunchCommand TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "postLaunchCommand", "postLaunchCommand TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "wrapperCommand", "wrapperCommand TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "customEnv", "customEnv TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing("builds", "windowOverride", "windowOverride INTEGER NOT NULL DEFAULT 0")
  addColumnIfMissing("builds", "windowWidth", "windowWidth INTEGER")
  addColumnIfMissing("builds", "windowHeight", "windowHeight INTEGER")
}

function migrateResources() {
  addColumnIfMissing("resources", "modId", "modId INTEGER")
  addColumnIfMissing("resources", "fileId", "fileId INTEGER")
  addColumnIfMissing("resources", "cfChecked", "cfChecked INTEGER NOT NULL DEFAULT 0")
}

function migrateSkinLibrary() {
  addColumnIfMissing("skin_library", "capeId", "capeId TEXT DEFAULT NULL")
  // Идентификатор скина в каталоге: по нему карточка понимает, что скин уже
  // лежит в «Избранном», и повторный импорт не создаёт дубликат. Новые записи
  // хранят префикс источника (`laby:<hash>`), старые — голый ID Craftdex.
  addColumnIfMissing("skin_library", "sourceId", "sourceId TEXT DEFAULT NULL")
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
  addColumnIfMissing("mc_servers", "group", "[group] TEXT DEFAULT NULL")
}

function seedDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value])
  }
}

/**
 * Индексы под самые частые выборки. Раньше их не было: sql.js держал всю БД
 * в памяти, а полный дамп на диск при каждом изменении делал любую оптимизацию
 * бессмысленной. Теперь запросы идут по файлу, и индексы реально нужны.
 */
function createIndexes() {
  run("CREATE INDEX IF NOT EXISTS idx_builds_createdAt ON builds (createdAt DESC)")
  run("CREATE INDEX IF NOT EXISTS idx_accounts_sortOrder ON accounts (sortOrder ASC)")
  run("CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages (sessionId, createdAt ASC)")
  run("CREATE INDEX IF NOT EXISTS idx_ai_sessions_updatedAt ON ai_sessions (updatedAt DESC)")
  run("CREATE INDEX IF NOT EXISTS idx_game_sessions_startedAt ON game_sessions (startedAt DESC)")
  run("CREATE INDEX IF NOT EXISTS idx_game_sessions_buildId ON game_sessions (buildId, buildName)")
  // DELETE по buildName идёт при удалении сборки (см. deleteGameSessionsForDeletedBuild)
  run("CREATE INDEX IF NOT EXISTS idx_game_sessions_buildName ON game_sessions (buildName)")
  run("CREATE INDEX IF NOT EXISTS idx_server_sessions_startedAt ON server_sessions (startedAt DESC)")
  // Аналогично: очистка статистики сервера по serverName
  run("CREATE INDEX IF NOT EXISTS idx_server_sessions_serverName ON server_sessions (serverName)")
  run("CREATE INDEX IF NOT EXISTS idx_skin_library_accountId ON skin_library (accountId, createdAt DESC)")
  // Поиск «этот скин каталога уже сохранён» идёт по паре (accountId, sourceId):
  // без индекса он сканировал все скины аккаунта при каждом добавлении в избранное.
  run("CREATE INDEX IF NOT EXISTS idx_skin_library_source ON skin_library (accountId, sourceId)")
  run("CREATE INDEX IF NOT EXISTS idx_mc_servers_trashedAt ON mc_servers (trashedAt)")
  run("CREATE INDEX IF NOT EXISTS idx_resources_updatedAt ON resources (updatedAt DESC)")
}

export { DEFAULT_SETTINGS }

/**
 * Версия схемы. Увеличивайте, когда добавляете `addColumnIfMissing`/новые
 * таблицы: тогда на БД с актуальной версией стартовые `PRAGMA table_info`
 * (их около 30 — по одному на колонку) выполняться не будут.
 *
 * `DB_FORMAT_VERSION` в core.ts — это другой маркер («файл открывался
 * better-sqlite3», нужен для разового бэкапа sql.js-БД), поэтому в
 * `user_version` пишем максимум из двух.
 */
export const SCHEMA_VERSION = 3

function readUserVersion(): number {
  const rows = queryAll<{ user_version?: number }>("PRAGMA user_version")
  const value = Array.isArray(rows) && rows.length > 0 ? rows[0].user_version : 0
  return typeof value === "number" ? value : Number(value ?? 0)
}

/**
 * Создание схемы + миграции одной транзакцией: либо БД готова целиком, либо
 * (при ошибке) остаётся в исходном состоянии — без полу-применённых ALTER TABLE.
 *
 * Колоночные миграции пропускаются, если файл уже помечен текущей версией
 * схемы: на каждом старте это экономит ~30 `PRAGMA table_info` и лишние ALTER.
 * `CREATE TABLE/INDEX IF NOT EXISTS` остаются всегда — они идемпотентны и
 * защищают от частично созданной схемы.
 */
export function initializeSchema() {
  if (!isDbAvailable()) {
    return
  }

  const currentVersion = readUserVersion()
  const needsColumnMigrations = currentVersion < SCHEMA_VERSION

  transaction(() => {
    createTables()
    if (needsColumnMigrations) {
      migrateAccounts()
      migrateBuilds()
      migrateResources()
      migrateSkinLibrary()
      migrateMcServers()
    }
    createIndexes()
    seedDefaultSettings()
    setUserVersion(Math.max(DB_FORMAT_VERSION, SCHEMA_VERSION))
  })

  if (needsColumnMigrations && currentVersion > 0) {
    console.log(`[DB] Схема обновлена: ${currentVersion} → ${SCHEMA_VERSION}`)
  }
}

