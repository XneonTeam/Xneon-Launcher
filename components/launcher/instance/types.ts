export type ViewMode = "my" | "detail" | "modrinth" | "curseforge"
export type DetailTab = "general" | "mods" | "resourcepacks" | "shaders"
export type ModSort = "downloads" | "popular" | "updated" | "published"
export type Source = "modrinth" | "curseforge"
export type ContentType = "mod" | "modpack" | "resourcepack" | "shader"
export type ModalTab = "description" | "gallery" | "changelog" | "versions"

export type Build = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  icon: string
  coverImage?: string
  mods: BuildMod[]
  resourcepacks: BuildMod[]
  shaders: BuildMod[]
  createdAt: string
  source: "local" | "modrinth" | "curseforge"
  projectSlug?: string
  intentPath?: string
  installedMods?: Record<string, string>
}

export type BuildMod = {
  id: string
  slug: string
  name: string
  description: string
  icon_url?: string
  version: string
}

// ── Unified Mod Types (aligned with xnlc/mods) ────────────

export type ModSearchResult = {
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

export type ModVersion = {
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

export type ModDetails = {
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
export type ModrinthProject = ModSearchResult & { title?: string; description?: string; icon_url?: string; downloads?: number }

/** @deprecated Use ModDetails instead */
export type CFModalData = ModDetails

/** @deprecated Use ModSearchResult instead */
export type CFModpack = ModSearchResult
