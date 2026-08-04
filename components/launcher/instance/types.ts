export type ViewMode = "my" | "detail" | "modrinth" | "curseforge"
export type DetailTab = "general" | "mods" | "resourcepacks" | "shaders" | "worlds" | "screenshots"
export type ModSort = "relevance" | "downloads" | "popular" | "followers" | "updated" | "published"
export type Source = "modrinth" | "curseforge"
export type ContentType = "mod" | "modpack" | "resourcepack" | "shader"
export type ModalTab = "description" | "gallery" | "changelog" | "versions"

export type MemoryPreset = "light" | "balanced" | "heavy" | "custom"

export type Build = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion?: string
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
  memoryMin?: string
  memoryMax?: string
  memoryPreset?: MemoryPreset
  javaOverride?: boolean
  javaPath?: string
  javaArgs?: string
  playtime: number
}

export type BuildMod = {
  id: string
  slug: string
  name: string
  description: string
  icon_url?: string
  version: string
  source?: "local" | Source
  projectId?: string
  modId?: number
  author?: string
  enabled?: boolean
}

// -- Unified Mod Types (aligned with xnlc/mods) --

export type ModSearchResult = {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  source: Source
  author?: string
  projectId?: string
  modId?: number
  primaryFileId?: number
  primaryFileName?: string
  fileSize?: number
  dateCreated?: string
  dateModified?: string
}

export type ModDependency = {
  projectId: string
  versionId?: string | null
  fileName?: string | null
  dependencyType: "required" | "optional" | "incompatible" | "embedded"
  name?: string
  slug?: string
  iconUrl?: string
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
  dependencies?: ModDependency[]
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

// -- World / Save Management --

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

/** @deprecated Use ModSearchResult instead */
export type ModrinthProject = ModSearchResult & { title?: string; description?: string; icon_url?: string; downloads?: number }

/** @deprecated Use ModDetails instead */
export type CFModalData = ModDetails

/** @deprecated Use ModSearchResult instead */
export type CFModpack = ModSearchResult
