// ============================================================
// @xnlc/types — Mod Types
// Unified mod search/detail types for Modrinth & CurseForge
// ============================================================

export type ModContentType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack"
export type ModSort = "relevance" | "downloads" | "popular" | "followers" | "updated" | "published"
export type ModLoaderFilter = "vanilla" | "fabric" | "quilt" | "neoforge"

export interface ModSearchResult {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  source: "modrinth" | "curseforge"
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
  source: "modrinth" | "curseforge"
  body?: string
  modId?: number
  projectId?: string
}
