// ============================================================
// @xnlc/types — Domain Types
// Single source of truth for database entities, auth, news, etc.
// ============================================================

import type { ModVersion } from "./mod-types.js"

// ── Database Types ──────────────────────────────────────────

export type BuildExportCategory = "mods" | "resourcepacks" | "shaderpacks" | "saves" | "data" | "logs"

/**
 * Категории содержимого, которое можно выборочно загрузить в облако.
 * Объединяет категории сборки (BuildExportCategory) и серверные категории.
 */
export type CloudUploadCategory =
  | "mods"
  | "resourcepacks"
  | "shaderpacks"
  | "saves"
  | "data"
  | "logs"
  | "world"
  | "plugins"
  | "configs"

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
  /** Display order in the accounts list */
  sortOrder?: number
}

export type DbBuildMod = {
  id: string
  slug: string
  name: string
  description: string
  icon_url?: string
  version: string
  source?: "local" | "modrinth" | "curseforge"
  projectId?: string
  modId?: number
  author?: string
  enabled?: boolean
}

export type DbBuild = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon: string
  coverImage?: string
  mods: DbBuildMod[]
  resourcepacks?: DbBuildMod[]
  shaders?: DbBuildMod[]
  createdAt: string
  source: "local" | "modrinth" | "curseforge"
  projectSlug?: string
  modpackVersion?: string
  modId?: number
  fileId?: number
  /** Whether the build is linked/locked to an official modpack */
  locked?: boolean
  intentPath?: string
  installedMods?: Record<string, string>
  playtime: number
  /** Per-build Java override: use build-specific java/memory/args instead of global settings */
  javaOverride?: boolean
  javaPath?: string
  javaArgs?: string
  memoryMin?: string
  memoryMax?: string
  /** Per-build auto-join server: use build-specific address instead of global settings */
  serverOverride?: boolean
  server?: string
  serverPort?: string
  /** Pre-launch command executed before the game starts (supports $INST_* placeholders) */
  preLaunchCommand?: string
  /** Post-launch command executed after the game exits (supports $INST_* placeholders) */
  postLaunchCommand?: string
  /** Wrapper command prepended to the java invocation (e.g. optirun, primusrun) */
  wrapperCommand?: string
  /** Custom environment variables for the game process (newline-separated KEY=VALUE) */
  customEnv?: string
  /** Default account used when launching this build */
  defaultAccountId?: string
  /** Group/category label for organizing builds (e.g. "Моды для сервера") */
  group?: string
}

// ── World / Save Management ─────────────────────────────────

export type WorldInfo = {
  folder: string
  name: string
  seed: string
  gameMode: string
  hardcore: boolean
  lastPlayed: number
  playedTime: number
  mcVersion: string
  iconDataUrl: string
  sizeBytes: number
  lastModified: number
  path: string
  datapackCount: number
  hasLevelData: boolean
}

export type DatapackInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  path: string
}

export type ScreenshotInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  thumbDataUrl: string
  path: string
}

// ── Auth Payloads ───────────────────────────────────────────

export type AuthPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

/** @deprecated Use AuthPayload directly */
export type ElyByPayload = AuthPayload
/** @deprecated Use AuthPayload directly */
export type XnSkinsPayload = AuthPayload
/** @deprecated Use AuthPayload directly */
export type MicrosoftPayload = AuthPayload

export type AuthSession = {
  uuid: string
  username: string
  accessToken: string
  profileId: string
  profileName?: string
}

export type DeviceCodeStart = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export type DeviceCodePoll =
  | { status: "pending"; slowDown?: boolean }
  | { status: "expired" }
  | { status: "complete"; account: AuthPayload }
  | { status: "error"; message: string; retryable?: boolean }

// ── Minecraft Types ─────────────────────────────────────────

export type MinecraftVersionInfo = {
  version: string
  stable: boolean
  type: string
}

export type VersionEntry = {
  id: string
  type: "release" | "snapshot" | "old_alpha" | "old_beta"
  url?: string
  releaseTime?: string
}

export type MinecraftNewsEntry = {
  id: string
  title: string
  tag?: string
  category?: string
  date: string
  text?: string
  readMoreLink?: string
  playPageImage?: { url?: string }
  newsPageImage?: { url?: string }
  newsType?: string[]
}

// ── Importable Instances ────────────────────────────────────

export type ImportableLauncherInstance = {
  id: string
  name: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon?: string
  path: string
  source: "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher" | "modrinthapp"
  modCount?: number
  resourcepackCount?: number
  shaderCount?: number
}

// ── Java Types ──────────────────────────────────────────────

export type JavaDetectResult = {
  path: string
  version: string
  label: string
  /** Full runtime version string, e.g. "17.0.8+7" */
  fullVersion?: string
  /** Java vendor, e.g. "Eclipse Adoptium", "Microsoft" */
  vendor?: string
  /** Data model: "64" or "32" */
  arch?: string
}

// ── Utility Types ───────────────────────────────────────────

export interface CleanupFn {
  (): void
}

// ── Cloud Types ─────────────────────────────────────────────

export type CloudUser = {
  id: string
  username: string
  email: string
}

export type CloudFile = {
  id: string
  name: string
  size: number
  type: string
  category?: string
  downloadUrl?: string
  icon?: string
  uploadedAt?: string
  originalName?: string
  _id?: string
}

export type CloudStorageInfo = {
  used_bytes: number
  limit_bytes: number
  used_gb: number
  limit_gb: number
  formatted_used: string
  formatted_limit: string
}

// ── Build Intent Scan Result ────────────────────────────────

export type BuildIntentScanResult = {
  mods: DbBuildMod[]
  resourcepacks: DbBuildMod[]
  shaders: DbBuildMod[]
  installedMods: Record<string, string>
}

// ── Modpack Import Result ───────────────────────────────────

export type ModpackImportMod = {
  id: string
  slug: string
  name: string
  description: string
  version: string
}

/** Уже установленный модпак, который мешает новой установке */
export type ModpackImportConflict = {
  /** duplicate — этот же модпак уже установлен, name — имя сборки уже занято другим модпаком */
  kind: "duplicate" | "name"
  /** Имя существующей сборки */
  existingName: string
  /** Id существующей сборки */
  existingBuildId: string
  /** Свободное имя, предлагаемое для новой сборки */
  suggestedName: string
}

export type ModpackImportResult = {
  success: boolean
  error?: string
  cancelled?: boolean
  version?: string
  modLoader?: string
  loaderVersion?: string
  modpackVersion?: string
  /** Id установленной версии модпака — нужен, чтобы «Восстановить» ставил именно её */
  modpackVersionId?: string
  mods?: ModpackImportMod[]
  resourcepacks?: ModpackImportMod[]
  shaders?: ModpackImportMod[]
  installedMods?: Record<string, string>
  /** Заполняется, когда импорт заблокирован, потому что такая сборка уже есть */
  conflict?: ModpackImportConflict
}

// ── Import Progress ─────────────────────────────────────────

export type ImportProgress = {
  current: number
  total: number
  message: string
  itemName?: string
}

export type ContentDownloadProgress = {
  fileName: string
  current: number
  total: number
  /**
   * `true` — поток по файлу закрыт (успешно или с ошибкой). Без этого признака
   * живое уведомление об установке остаётся висеть на последнем проценте.
   */
  done?: boolean
}

// ── Skins ─────────────────────────────────────────────────

export type MinecraftSkin = { id: string; state: string; url: string; variant: "CLASSIC" | "SLIM" }
export type MinecraftCape = { id: string; state: string; url: string; alias?: string }
export type McProfile = { id: string; name: string; skins: MinecraftSkin[]; capes: MinecraftCape[] }

export type LibrarySkin = {
  id: string
  accountId: string
  name: string
  filePath: string
  variant: "classic" | "slim"
  capeId: string | null
  createdAt: string
}

// ── Quick Play ─────────────────────────────────────────────

export type QuickPlayEntry = {
  type: "singleplayer" | "multiplayer"
  label: string
  address: string
  lastPlayed: number
}

// ── Content Updates ─────────────────────────────────────────

/** Minimum stability channel included when checking for content updates */
export type UpdateChannel = "release" | "beta" | "alpha"

export type ContentUpdateInfo = {
  /** BuildMod.id of the installed item */
  itemId: string
  contentType: "mods" | "resourcepacks" | "shaders"
  source: "modrinth" | "curseforge"
  /** CurseForge numeric project id (needed to resolve download URLs) */
  modId?: number
  name: string
  iconUrl?: string
  currentVersion: string
  latestVersion: ModVersion
}

export type BuildContentUpdates = {
  buildId: string
  channel: UpdateChannel
  checkedAt: number
  updates: ContentUpdateInfo[]
}

// ── Game Statistics ─────────────────────────────────────────

export type GameSessionInfo = {
  id: string
  buildId: string
  buildName: string
  startedAt: number
  endedAt: number
  /** Session length in seconds */
  duration: number
}

export type ServerSessionInfo = {
  id: string
  serverId: string
  serverName: string
  startedAt: number
  endedAt: number
  /** Session length in seconds */
  duration: number
}

/** Inclusive time range (epoch ms) for statistics aggregation. */
export type StatsRange = {
  from: number
  to: number
}

export type StatsOverview = {
  totalPlaytime: number
  totalSessions: number
  averageSession: number
  lastSession: GameSessionInfo | null
  /** Range actually aggregated (epoch ms). */
  rangeFrom?: number
  rangeTo?: number
  /** Per-day playtime inside the selected range, date = YYYY-MM-DD (local) */
  dailyPlaytime: Array<{ date: string; seconds: number }>
  topBuilds: Array<{ buildId: string; name: string; icon?: string; seconds: number; sessions: number }>
  /** Per-server uptime for the launcher's own MC servers */
  serverTotalUptime: number
  serverTotalSessions?: number
  serverAverageSession?: number
  serverLastSession?: ServerSessionInfo | null
  dailyServerUptime?: Array<{ date: string; seconds: number }>
  topServers: Array<{ serverId: string; name: string; icon?: string; seconds: number; sessions: number }>
}

// ── Storage / Disk Manager ──────────────────────────────────

export type BuildStorageEntry = {
  buildId: string
  name: string
  path: string
  icon: string
  version: string
  modLoader: string
  total: number
  mods: number
  resourcepacks: number
  shaderpacks: number
  saves: number
  config: number
  logs: number
  crashReports: number
  /** .cache, .fabric, .quilt folders */
  cache: number
  other: number
}

export type ServerStorageEntry = {
  serverId: string
  name: string
  path: string
  icon: string
  gameVersion: string
  modLoader: string
  total: number
  mods: number
  config: number
  logs: number
  world: number
  /** server wrapper / plugins / dynmap etc. */
  plugins: number
  cache: number
  other: number
}

export type JavaRuntimeEntry = {
  path: string
  component: string
  size: number
  /** Human-readable Java version label, e.g. "Java 21" */
  label: string
  /** Exact version string when known, e.g. "21.0.7" */
  versionLabel: string
}

export type StorageScanResult = {
  builds: BuildStorageEntry[]
  servers: ServerStorageEntry[]
  trash: { path: string; size: number }
  javaRuntimes: { path: string; size: number; entries: JavaRuntimeEntry[] }
  gameDir: { path: string; size: number }
  scannedAt: number
}

export type StorageCleanTarget =
  | { kind: "build-logs"; buildId: string }
  | { kind: "build-crash-reports"; buildId: string }
  | { kind: "build-cache"; buildId: string }
  | { kind: "trash" }
  | { kind: "java-runtime"; path: string }

export type StorageCleanResult = {
  success: boolean
  freedBytes: number
  error?: string
}
