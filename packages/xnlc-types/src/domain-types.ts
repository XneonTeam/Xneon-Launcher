// ============================================================
// @xnlc/types — Domain Types
// Single source of truth for database entities, auth, news, etc.
// ============================================================

// ── Database Types ──────────────────────────────────────────

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
  intentPath?: string
  installedMods?: Record<string, string>
  playtime: number
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
  source: "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher"
  modCount?: number
  resourcepackCount?: number
  shaderCount?: number
}

// ── Server Types ────────────────────────────────────────────

export type HotmcServerSearchResult = {
  name: string
  pageUrl: string
  description: string
  ip: string
  version: string
  playersOnline: number
  playersMax: number
  rank?: string
  country?: string
  avatarUrl?: string
  bannerUrl?: string
  isOnline: boolean
}

// ── Java Types ──────────────────────────────────────────────

export type JavaDetectResult = {
  path: string
  version: string
  label: string
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

export type ModpackImportResult = {
  success: boolean
  error?: string
  cancelled?: boolean
  version?: string
  modLoader?: string
  loaderVersion?: string
  mods?: ModpackImportMod[]
  resourcepacks?: ModpackImportMod[]
  shaders?: ModpackImportMod[]
  installedMods?: Record<string, string>
}

// ── Import Progress ─────────────────────────────────────────

export type ImportProgress = {
  current: number
  total: number
  message: string
  itemName?: string
}
