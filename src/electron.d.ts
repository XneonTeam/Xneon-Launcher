import type {
  ElectronAPIExplicit,
  ImportableLauncherInstance,
  QuickPlayEntry,
  AuthPayload,
  McProfile,
  LibrarySkin,
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

export type LauncherCloudFile = {
  id: string
  name: string
  size: number
  modifiedAt?: string
  path: string
  isDir: boolean
  category?: string
}

export type LauncherExtraApi = {
  getAiConfig: () => Promise<{ apiKey: string; endpoint: string; model: string }>
  saveAiConfig: (config: { apiKey: string; endpoint: string; model: string }) => Promise<void>
  analyzeCrash: (logContent: string, sessionId: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  analyzeCrashStream: (requestId: string, logContent: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  aiChatSend: (sessionId: string, userMessage: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  aiChatSendStream: (requestId: string, sessionId: string, userMessage: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  aiListSessions: () => Promise<Array<{ id: string; title: string; createdAt: number; updatedAt: number }>>
  aiCreateSession: (id: string, title: string) => Promise<void>
  aiRenameSession: (id: string, title: string) => Promise<void>
  aiDeleteSession: (id: string) => Promise<void>
  aiListMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; createdAt: number }>>
  onAiStreamChunk: (callback: (data: { requestId: string; content: string }) => void) => () => void
  onAiStreamDone: (callback: (data: { requestId: string; fullText: string }) => void) => () => void
  onAiStreamError: (callback: (data: { requestId: string; error: string }) => void) => () => void
  getTotalMemory: () => Promise<number>
  reorderAccounts: (ids: string[]) => Promise<void>
  getInstancesRoot: () => Promise<string>
  pickFolder: (title?: string) => Promise<string | null>
  setInstancesRoot: (newRoot: string) => Promise<{ success: boolean; root?: string; error?: string }>
  cloudListProviders: () => Promise<Array<{ id: string; name: string }>>
  cloudConnect: (providerId: string, authData?: Record<string, string>) => Promise<{ success: boolean; provider?: string; error?: string }>
  cloudIsConnected: (providerId: string) => Promise<boolean>
  cloudDisconnect: (providerId: string) => Promise<{ success: boolean; error?: string }>
  cloudListFiles: (providerId: string, folderPath?: string) => Promise<{ success: boolean; files?: LauncherCloudFile[]; error?: string }>
  cloudUploadFile: (providerId: string, localPath: string, remotePath: string) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
  cloudDownloadFile: (providerId: string, remotePath: string, localPath: string) => Promise<{ success: boolean; localPath?: string; error?: string }>
  cloudDeleteFile: (providerId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>
  cloudGetQuota: (providerId: string) => Promise<{ used: number; total: number } | null>
   cloudUploadBuild: (providerId: string, buildName: string, uploadId?: string) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
   onContentDownloadProgress: (callback: (progress: { fileName: string; current: number; total: number }) => void) => () => void
   onCloudUploadProgress: (callback: (data: { id: string; percent: number; stage: "zip" | "upload" }) => void) => () => void
  getFilePath: (file: File) => string
  cloudUploadAccount: (providerId: string, account: { id: string; type: string; username: string; uuid?: string }) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
  cloudDownloadAndImport: (providerId: string, remotePath: string, fileType: string) => Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>
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
  renameScreenshot: (buildName: string, fileName: string, newName: string) => Promise<{ success: boolean; error?: string }>
  listServers: (buildName: string) => Promise<Array<{ name: string; ip: string }>>
  writeServersDat: (buildName: string, servers: Array<{ name: string; ip: string }>) => Promise<{ success: boolean; error?: string }>
  pingServer: (address: string) => Promise<LauncherServerStatus>
  quickPlayList: (buildName?: string, gameDir?: string) => Promise<QuickPlayEntry[]>
  quickPlayClear: (buildName?: string, gameDir?: string) => Promise<void>
  quickPlayRemove: (buildName: string | undefined, gameDir: string | undefined, entry: QuickPlayEntry) => Promise<void>
  copyBuild: (buildName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>
  renameBuildIntent: (oldName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>
  exportBuildZip: (buildName: string, label: string, categories?: import('@xnlc/types').BuildExportCategory[]) => Promise<{ success: boolean; path?: string; error?: string }>
  exportBuildModlist: (buildName: string, label: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => Promise<{ success: boolean; path?: string; error?: string }>
  moveBuildIntentToTrash: (dirName: string) => Promise<{ success: boolean; trashName?: string; error?: string }>
  restoreBuildIntentFromTrash: (dirName: string, trashName: string) => Promise<{ success: boolean; error?: string }>
  purgeBuildTrash: () => Promise<{ success: boolean; error?: string }>
  listTrashBuilds: () => Promise<Array<{ trashName: string; originalName: string; trashedAt: number }>>
  deleteTrashItem: (trashName: string) => Promise<{ success: boolean; error?: string }>
  setContentEnabled: (buildName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean) => Promise<{ success: boolean; fileName?: string; error?: string }>
  onCliLaunchBuild: (callback: (buildName: string) => void) => () => void
  updateCheck: () => Promise<{ available: boolean; version?: string; error?: string }>
  updateDownload: () => Promise<{ success: boolean; error?: string }>
  updateInstall: () => Promise<void>
  updateInfo: () => Promise<{ version: string | null; downloaded: boolean }>
  onUpdateStatus: (callback: (status: { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }) => void) => () => void
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void
  skinsGetProfile: (accountId?: string) => Promise<McProfile | null>
  skinsUploadSkin: (filePath: string, variant: "classic" | "slim", accountId?: string) => Promise<boolean>
  skinsDeleteSkin: (accountId?: string) => Promise<boolean>
  skinsSetCape: (capeId: string | null, accountId?: string) => Promise<boolean>
  skinsListLibrary: (accountId: string) => Promise<LibrarySkin[]>
  skinsSaveToLibrary: (filePath: string, name: string, variant: "classic" | "slim", accountId: string, capeId?: string | null) => Promise<LibrarySkin | null>
  skinsDeleteFromLibrary: (id: string) => Promise<boolean>
  skinsUpdateVariant: (id: string, variant: "classic" | "slim", capeId?: string | null, name?: string) => Promise<boolean>
  skinsApplyLibrarySkin: (skinId: string, accountId: string) => Promise<boolean>
  skinsImportFromUrl: (url: string, name: string, variant: "classic" | "slim", accountId: string) => Promise<LibrarySkin | null>
  readLocalFile: (filePath: string) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPIExplicit & LauncherExtraApi
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance
}
