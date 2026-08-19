// ============================================================
// @xnlc/types — Mod Types
// Unified mod search/detail types for Modrinth & CurseForge
// ============================================================

export type ModContentType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack"
export type ModSort = "relevance" | "downloads" | "follows" | "newest" | "updated" | "featured" | "rating"
export type ModSource = "modrinth" | "curseforge" | "ftb"
export type ModLoaderFilter = "vanilla" | "fabric" | "quilt" | "neoforge"

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

export interface ModVersion {
  id: string
  name: string
  gameVersion: string
  downloadCount: number
  fileName: string
  fileSize: number
  downloadUrl?: string
  versionType?: "release" | "beta" | "alpha"
  loaders?: string[]
  changelog?: string
  datePublished?: string
  files?: { url: string; size: number; filename: string }[]
  dependencies?: ModDependency[]
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
}

export interface ModCategory {
  name: string
  icon: string
  header: string
  projectType: ModContentType
  cfCategoryId?: number
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
