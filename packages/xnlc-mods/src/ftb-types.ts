// ============================================================
// XNLC Mods — FTB (Feed The Beast) API Types
// Raw shapes returned by https://api.modpacks.ch
// ============================================================

export interface FTBModpacksResult {
  packs: number[]
  curseforge: number[]
  total: number
  limit: number
  refreshed: number
}

export interface FTBArt {
  width: number
  height: number
  url: string
  sha1: string
  size: number
  id: number
  type: string
  updated: number
}

export interface FTBAuthor {
  website: string
  id: number
  name: string
  type: string
  updated: number
}

export interface FTBSpecs {
  id: number
  minimum: number
  recommended: number
}

export interface FTBVersion {
  specs: FTBSpecs
  id: number
  name: string
  type: string
  updated: number
}

export interface FTBModpackManifest {
  synopsis: string
  description: string
  art: FTBArt[]
  authors: FTBAuthor[]
  versions: FTBVersion[]
  installs: number
  plays: number
  featured: boolean
  refreshed: number
  released: number
  status: string
  id: number
  name: string
  type: string
  updated: number
  tags: { id: number; name: string }[]
}

export interface FTBFile {
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

export interface FTBTarget {
  version: string
  id: number
  name: string
  type: string
  updated: number
}

export interface FTBModpackVersionManifest {
  files: FTBFile[]
  specs: FTBSpecs
  targets: FTBTarget[]
  installs: number
  plays: number
  refreshed: number
  status: string
  changelog: string
  parent: number
  id: number
  name: string
  type: string
  updated: number
}