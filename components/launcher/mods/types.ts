// ============================================================
// Mods — Frontend Types (aligned with xnlc/mods)
// Author: MAINER4IK
// ============================================================

export type ContentType = "mod" | "modpack" | "resourcepack" | "shader"
export type Source = "modrinth" | "curseforge"
export type ModalTab = "description" | "gallery" | "changelog" | "versions"
export type ModsPageTab = "browse" | "installed" | "updates"
export type ModSort = "downloads" | "popular" | "updated" | "published"

export interface ModSearchResult {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  source: Source
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
  source: Source
  body?: string
  modId?: number
  projectId?: string
}

/** @deprecated Use ModSearchResult instead */
export type CFSearchResult = ModSearchResult
/** @deprecated Use ModSearchResponse instead */
export type CFSearchResponse = ModSearchResponse
/** @deprecated Use ModDetails instead */
export type CFModalData = ModDetails
/** @deprecated Use ModVersion instead */
export type CFVersion = ModVersion
/** @deprecated Use ModSearchResult instead (with source:"modrinth") */
export type ModrinthProject = ModSearchResult & { title?: string; description?: string; icon_url?: string; downloads?: number }
/** @deprecated Use ModVersion instead */
export type ModrinthVersion = ModVersion
