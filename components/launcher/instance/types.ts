export type ViewMode = "my" | "detail" | "modrinth" | "curseforge" | "ftb" | "trash"
export type DetailTab = "settings" | "general" | "mods" | "resourcepacks" | "shaders" | "worlds" | "screenshots" | "servers"
export type ModSort = "relevance" | "downloads" | "follows" | "newest" | "updated" | "featured" | "rating"
export type Source = "modrinth" | "curseforge" | "ftb"
export type SearchSource = "both" | Source
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
  source: "local" | Source
  projectSlug?: string
  modpackVersion?: string
  modpackVersionId?: string
  modId?: number
  fileId?: number
  /** Whether the build is linked/locked to an official modpack */
  locked?: boolean
  intentPath?: string
  installedMods?: Record<string, string>
  memoryMin?: string
  memoryMax?: string
  memoryPreset?: MemoryPreset
  javaOverride?: boolean
  javaPath?: string
  javaArgs?: string
  windowOverride?: boolean
  windowWidth?: number
  windowHeight?: number
  serverOverride?: boolean
  server?: string
  serverPort?: string
  preLaunchCommand?: string
  postLaunchCommand?: string
  wrapperCommand?: string
  customEnv?: string
  defaultAccountId?: string
  playtime: number
  group?: string
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

import type { ModSearchResult, ModDetails, ModVersion, ModDependency } from "@xnlc/types"

export type { ModSearchResult, ModDetails, ModVersion, ModDependency }

// -- World / Save Management --

export type { WorldInfo, DatapackInfo, ScreenshotInfo } from "@xnlc/types"

/** @deprecated Use ModSearchResult instead */
export type ModrinthProject = ModSearchResult & { title?: string; description?: string; icon_url?: string; downloads?: number }

/** @deprecated Use ModDetails instead */
export type CFModalData = ModDetails

/** @deprecated Use ModSearchResult instead */
export type CFModpack = ModSearchResult
