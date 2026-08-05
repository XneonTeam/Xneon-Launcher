import type {
  ElectronAPIExplicit,
  ImportableLauncherInstance,
} from '@xnlc/types'

export {}

// ── Launcher Extra API ─────────────────────────────────────
// Types and methods added to the renderer bridge that may not
// exist in older published versions of @xnlc/types.
// Kept in sync with electron/preload.ts, electron/main/worlds.ts
// and packages/xnlc-types (domain-types / ipc-contracts).

export type LauncherWorldInfo = {
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

export type LauncherDatapackInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  path: string
}

export type LauncherScreenshotInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  thumbDataUrl: string
  path: string
}

export type LauncherServerStatus = {
  online: boolean
  ip: string
  port: number
  players_online: number
  players_max: number
  motd_raw?: string
  motd_clean?: string
  version: string
  latency_ms: number
  icon?: string
  error?: string
}

export type LauncherExtraApi = {
  listWorlds: (buildName: string) => Promise<LauncherWorldInfo[]>
  renameWorld: (buildName: string, folder: string, newName: string) => Promise<{ success: boolean; error?: string }>
  copyWorld: (buildName: string, folder: string, newName: string) => Promise<{ success: boolean; folder?: string; error?: string }>
  importWorldZip: (buildName: string, localFilePath: string, newName?: string) => Promise<{ success: boolean; folder?: string; error?: string }>
  deleteWorld: (buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>
  setWorldIcon: (buildName: string, folder: string, dataUrl: string) => Promise<{ success: boolean; error?: string }>
  resetWorldIcon: (buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>
  listWorldDatapacks: (buildName: string, folder: string) => Promise<LauncherDatapackInfo[]>
  installDatapackRemote: (buildName: string, folder: string, url: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  installDatapackLocal: (buildName: string, folder: string, localFilePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
  deleteWorldDatapack: (buildName: string, folder: string, fileName: string) => Promise<{ success: boolean; error?: string }>
  listScreenshots: (buildName: string) => Promise<LauncherScreenshotInfo[]>
  getScreenshot: (buildName: string, fileName: string) => Promise<string | null>
  deleteScreenshot: (buildName: string, fileName: string) => Promise<{ success: boolean; error?: string }>
  writeServersDat: (servers: Array<{ name: string; ip: string }>) => Promise<{ success: boolean; error?: string }>
  pingServer: (address: string) => Promise<LauncherServerStatus>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPIExplicit & LauncherExtraApi
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance
}
