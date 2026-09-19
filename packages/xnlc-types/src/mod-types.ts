// ============================================================
// @xnlc/types — Mod Types
// Unified mod search/detail types for Modrinth & CurseForge
// ============================================================

export type ModContentType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack" | "plugin" | "world"
export type ModSort = "relevance" | "downloads" | "follows" | "newest" | "updated" | "featured" | "rating"
export type ModSource = "modrinth" | "curseforge" | "ftb"
export type ModLoaderFilter = "vanilla" | "forge" | "fabric" | "quilt" | "neoforge"
export type ModEnvironment = "client" | "server"

export interface ModSearchResult {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  source: ModSource
  author?: string
  projectId?: string
  modId?: number
  primaryFileId?: number
  primaryFileName?: string
  fileSize?: number
  dateCreated?: string
  dateModified?: string
  gameVersions?: string[]
  loaders?: string[]
}

export interface ModSearchResponse {
  results: ModSearchResult[]
  totalCount: number
}

export interface ModDependency {
  projectId: string
  versionId?: string | null
  fileName?: string | null
  dependencyType: "required" | "optional" | "incompatible" | "embedded"
  name?: string
  slug?: string
  iconUrl?: string
}

/** Зависимость, объявленная в метаданных jar (fabric.mod.json, quilt.mod.json, mods.toml). */
export interface JarDeclaredDependency {
  modId: string
  versionRange?: string
}

/**
 * Разбор зависимостей из метаданных скачанного jar. Нужен потому, что
 * CurseForge и Modrinth заполняют `dependencies` не у всех файлов.
 */
export interface JarDependencyInspection {
  /** id самого мода из метаданных (например, `jei`). */
  modId: string | null
  /** Зависимости, уже сопоставленные с проектами источника. */
  dependencies: ModDependency[]
  /** Все установимые id до сопоставления — видно, что не нашлось. */
  declared: JarDeclaredDependency[]
}

/**
 * Метаданные локального файла контента (jar/zip), прочитанные из архива:
 * fabric.mod.json, quilt.mod.json, mods.toml, pack.mcmeta или shaders.properties.
 */
export interface ContentFileMetadata {
  name?: string
  version?: string
  description?: string
  /** Иконка из архива как data URL. */
  icon_url?: string
  author?: string
}

/** Тип контента сборки, для которого проверяется брошенный файл. */
export type ContentDropKind = "mod" | "resourcepack" | "shader"

/** Почему файл не приняли: текст собирает рендерер на языке пользователя. */
export type ContentDropRejectReason = "notFound" | "folderNotAllowed" | "wrongExtension" | "empty"

export interface ContentDropEntry {
  path: string
  name: string
  isDirectory: boolean
}

export interface ContentDropClassification {
  accepted: ContentDropEntry[]
  rejected: Array<ContentDropEntry & { reason: ContentDropRejectReason }>
}

export interface ModVersion {
  id: string
  name: string
  versionNumber?: string
  gameVersion: string
  downloadCount: number
  fileName: string
  fileSize: number
  downloadUrl?: string
  versionType?: "release" | "beta" | "alpha"
  loaders?: string[]
  changelog?: string
  datePublished?: string
  files?: { url: string; size: number; filename: string; hashes?: { sha1?: string; sha512?: string } }[]
  dependencies?: ModDependency[]
}

export interface ModLinks {
  websiteUrl?: string
  wikiUrl?: string
  issuesUrl?: string
  sourceUrl?: string
  discordUrl?: string
  donationUrls?: { id?: string; platform?: string; url: string }[]
}

export interface ModDetails {
  id: string
  slug: string
  name: string
  summary: string
  description: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  versions: ModVersion[]
  gallery: { url: string; title?: string }[]
  source: ModSource
  body?: string
  modId?: number
  projectId?: string
  links?: ModLinks
}

export interface ModCategory {
  name: string
  icon: string
  header: string
  projectType: ModContentType
  cfCategoryId?: number
  /** CurseForge category slug (used as a stable filter key) */
  slug?: string
}

export interface CurseForgeCategory {
  id: number
  name: string
  slug: string
  classId: number
  parentId: number
  url: string
  iconUrl: string
}

// ── FTB (Feed The Beast) ─────────────────────────────────────

export interface FTBVersionManifestFile {
  version: string
  path: string
  url?: string
  sha1: string
  size: number
  tags: string[]
  clientonly: boolean
  serveronly: boolean
  optional: boolean
  id: number
  curseforge?: { project: number; file: number }
  name: string
  type: string
  updated: number
}

export interface FTBVersionManifest {
  files: FTBVersionManifestFile[]
  targets: { version: string; id: number; name: string; type: string; updated: number }[]
  installs: number
  plays: number
  status: string
  changelog: string
  parent: number
  id: number
  name: string
  type: string
  updated: number
}
