import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AuthPayload,
  AuthSession,
  MinecraftVersionInfo,
  MinecraftProgress,
  MinecraftNewsEntry,
  DbAccount,
  DbBuild,
  DbBuildMod,
  MinecraftLaunchParams,
  JavaProgress,
  ImportableLauncherInstance,

  JavaDetectResult,
  BuildIntentScanResult,
  ModpackImportResult,
  ImportProgress,
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModEnvironment,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  ModSearchResult,
  FTBVersionManifest,
  CleanupFn,
  QuickPlayEntry,
  BuildExportCategory,
  McProfile,
  LibrarySkin,
  McServerInfo,
  McPlayerEntry,
  McServerState,
  McServerMetrics,
} from '@xnlc/types' with { 'resolution-mode': 'import' }

// World/screenshot types are defined locally (not imported from @xnlc/types)
// so the preload compiles against any published version of the package.
// Keep in sync with electron/main/worlds.ts and @xnlc/types domain-types.
type WorldInfo = {
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

type DatapackInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  path: string
}

type ScreenshotInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  thumbDataUrl: string
  path: string
}

// Server status type is defined locally (not imported from @xnlc/types)
// so the preload compiles against any published version of the package.
// Keep in sync with electron/main/server-status.ts.
type ServerStatusResult = {
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

type XnConnectState =
  | { status: "stopped" }
  | { status: "auth_required"; authUrl: string }
  | { status: "starting" }
  | { status: "running"; publicAddress: string; tunnelId: string }
  | { status: "limit_reached"; used: number; max: number; plan: string }

type XnConnectUsage = {
  used: number
  max: number
  plan: string
}

function subscribe<T>(channel: string, callback: (payload: T) => void): CleanupFn {
  const handler = (_: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function subscribeVoid(channel: string, callback: (payload: number) => void): CleanupFn {
  const handler = (_: Electron.IpcRendererEvent, payload: number) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function invoke<T>(channel: string) {
  return (...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window ─────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  restore: () => ipcRenderer.send('window:restore'),
  isMaximized: invoke<boolean>('window:is-maximized'),

  // ── Auth ───────────────────────────────────────────────
  loginElyBy: invoke<AuthPayload>('auth:elyby-login'),
  startElyByDeviceCode: invoke<{
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
    interval: number
  }>('auth:elyby-device-start'),
  pollElyByDeviceCode: (deviceCode: string) => ipcRenderer.invoke('auth:elyby-device-poll', deviceCode) as Promise<{ status: "pending"; slowDown?: boolean } | { status: "expired" } | { status: "complete"; account: AuthPayload } | { status: "error"; message: string; retryable?: boolean }>,
  loginXnSkins: invoke<AuthPayload>('auth:xnskins-login'),
  startXnSkinsDeviceCode: invoke<{
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
    interval: number
  }>('auth:xnskins-device-start'),
  pollXnSkinsDeviceCode: (deviceCode: string) => ipcRenderer.invoke('auth:xnskins-device-poll', deviceCode) as Promise<{ status: "pending"; slowDown?: boolean } | { status: "expired" } | { status: "complete"; account: AuthPayload } | { status: "error"; message: string; retryable?: boolean }>,
  loginMicrosoft: invoke<AuthPayload>('auth:microsoft-login'),
  startMicrosoftDeviceCode: invoke<{
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
    interval: number
  }>('auth:microsoft-device-start'),
  pollMicrosoftDeviceCode: (deviceCode: string) => ipcRenderer.invoke('auth:microsoft-device-poll', deviceCode) as Promise<{ status: "pending"; slowDown?: boolean } | { status: "expired" } | { status: "complete"; account: AuthPayload } | { status: "error"; message: string; retryable?: boolean }>,
  onAuthProgress: (callback: (msg: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => callback(msg)
    ipcRenderer.on('auth:progress', handler)
    return () => ipcRenderer.removeListener('auth:progress', handler)
  },

  // ── News ───────────────────────────────────────────────
  fetchMinecraftNews: invoke<MinecraftNewsEntry[]>('fetch:minecraft-news'),

  // ── Database ───────────────────────────────────────────
  loadAccounts: invoke<DbAccount[]>('db:load-accounts'),
  saveAccount: (account: DbAccount) => ipcRenderer.invoke('db:save-account', account) as Promise<void>,
  removeAccount: (id: string) => ipcRenderer.invoke('db:remove-account', id) as Promise<void>,
  loadBuilds: invoke<DbBuild[]>('db:load-builds'),
  saveBuilds: (builds: DbBuild[]) => ipcRenderer.invoke('db:save-builds', builds) as Promise<void>,
  dbIsFallbackStorage: invoke<{ isFallback: boolean }>('db:is-fallback-storage'),
  reorderAccounts: (ids: string[]) => ipcRenderer.invoke('db:reorder-accounts', ids) as Promise<void>,

  // ── Build / Intent ─────────────────────────────────────
  scanBuildIntentContent: (buildName: string) => ipcRenderer.invoke('build:scan-intent-content', buildName) as Promise<BuildIntentScanResult>,
  discoverImportableInstances: invoke<ImportableLauncherInstance[]>('launcher:discover-importable-instances'),
  importGdLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-gdlauncher-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  importLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  copyBuild: (buildName: string, newName: string) => ipcRenderer.invoke('build:copy', buildName, newName) as Promise<{ success: boolean; intentPath?: string; error?: string }>,
  renameBuildIntent: (oldName: string, newName: string) => ipcRenderer.invoke('build:rename-intent', oldName, newName) as Promise<{ success: boolean; intentPath?: string; error?: string }>,
  exportBuildZip: (buildName: string, label: string, categories?: BuildExportCategory[]) => ipcRenderer.invoke('build:export-zip', buildName, label, categories) as Promise<{ success: boolean; path?: string; error?: string }>,
  exportBuildModlist: (buildName: string, label: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => ipcRenderer.invoke('build:export-modlist', buildName, label, format) as Promise<{ success: boolean; path?: string; error?: string }>,
  moveBuildIntentToTrash: (dirName: string) => ipcRenderer.invoke('build:move-intent-to-trash', dirName) as Promise<{ success: boolean; trashName?: string; error?: string }>,
  restoreBuildIntentFromTrash: (dirName: string, trashName: string) => ipcRenderer.invoke('build:restore-intent-from-trash', dirName, trashName) as Promise<{ success: boolean; error?: string }>,
  purgeBuildTrash: () => ipcRenderer.invoke('build:purge-trash') as Promise<{ success: boolean; error?: string }>,
  listTrashBuilds: () => ipcRenderer.invoke('build:list-trash') as Promise<Array<{ trashName: string; originalName: string; trashedAt: number }>>,
  deleteTrashItem: (trashName: string) => ipcRenderer.invoke('build:delete-trash-item', trashName) as Promise<{ success: boolean; error?: string }>,
  onCliLaunchBuild: (callback: (buildName: string) => void) => subscribe('cli:launch-build', callback),

  // ── Unified Mods API (via xnlc/mods) ──────────────────
  modsModrinthSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, categories?: string[], environment?: ModEnvironment) =>
    ipcRenderer.invoke('mods:modrinth-search', query, contentType, gameVersion, modLoader, sortBy, page, categories, environment) as Promise<ModSearchResponse>,
  modsModrinthDetails: (slug: string) => ipcRenderer.invoke('mods:modrinth-details', slug) as Promise<ModDetails | null>,
  modsModrinthVersions: (slug: string) => ipcRenderer.invoke('mods:modrinth-versions', slug) as Promise<ModVersion[]>,
  modsCurseforgeSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, categories?: string[], environment?: ModEnvironment) =>
    ipcRenderer.invoke('mods:curseforge-search', query, contentType, gameVersion, modLoader, sortBy, page, categories, environment) as Promise<ModSearchResponse>,
  modsCurseforgeDetails: (modId: number) => ipcRenderer.invoke('mods:curseforge-details', modId) as Promise<ModDetails | null>,
  modsCurseforgeDownloadUrl: (fileId: number, modId: number) => ipcRenderer.invoke('mods:curseforge-download-url', fileId, modId) as Promise<string | null>,
  modsCurseforgeFeatured: (gameVersion?: string) => ipcRenderer.invoke('mods:curseforge-featured', gameVersion) as Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }>,
  modsResolveDependencies: (version: ModVersion, source: "modrinth" | "curseforge") => ipcRenderer.invoke('mods:resolve-dependencies', version, source) as Promise<ModDependency[]>,
  modsFtbSearch: (query: string, page?: number) => ipcRenderer.invoke('mods:ftb-search', query, page) as Promise<ModSearchResponse>,
  modsFtbDetails: (id: number) => ipcRenderer.invoke('mods:ftb-details', id) as Promise<ModDetails | null>,
  modsFtbVersion: (id: number, versionId: number) => ipcRenderer.invoke('mods:ftb-version', id, versionId) as Promise<FTBVersionManifest | null>,
  modsFtbChangelog: (id: number, versionId: number) => ipcRenderer.invoke('mods:ftb-changelog', id, versionId) as Promise<string>,
  modsModrinthCategories: () => ipcRenderer.invoke('mods:modrinth-categories') as Promise<any[]>,
  modsCurseforgeCategories: () => ipcRenderer.invoke('mods:curseforge-categories') as Promise<any[]>,
  modsModrinthLoaders: () => ipcRenderer.invoke('mods:modrinth-loaders') as Promise<string[]>,
  modsModrinthGameVersions: () => ipcRenderer.invoke('mods:modrinth-game-versions') as Promise<string[]>,

  // ── Minecraft Versions ─────────────────────────────────
  getMinecraftVersions: invoke<MinecraftVersionInfo[]>('minecraft:get-versions'),
  getLatestRelease: invoke<string | null>('minecraft:get-latest-release'),
  getLatestSnapshot: invoke<string | null>('minecraft:get-latest-snapshot'),
  getFabricGameVersions: invoke<{ version: string; stable: boolean }[]>('minecraft:get-fabric-game-versions'),
  getFabricVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-fabric-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getFabricSupported: invoke<string[]>('minecraft:get-fabric-supported'),
  getLiteLoaderVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-liteloader-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getLiteLoaderRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-liteloader-recommended', mcVersion) as Promise<string | null>,
  getLiteLoaderSupported: invoke<string[]>('minecraft:get-liteloader-supported'),
  getQuiltGameVersions: invoke<{ version: string; stable: boolean }[]>('minecraft:get-quilt-game-versions'),
  getQuiltVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-quilt-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getQuiltSupported: invoke<string[]>('minecraft:get-quilt-supported'),
  getOptifineVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-optifine-versions', mcVersion) as Promise<{ filename: string; isPreview: boolean }[]>,
  getOptifineRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-optifine-recommended', mcVersion) as Promise<string | null>,
  getOptifineSupported: invoke<string[]>('minecraft:get-optifine-supported'),
  getNeoForgeVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-neoforge-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getNeoForgeRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-neoforge-recommended', mcVersion) as Promise<string | null>,
  getNeoForgeSupported: invoke<string[]>('minecraft:get-neoforge-supported'),
  getForgeVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-forge-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getForgeRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-forge-recommended', mcVersion) as Promise<string | null>,
  getForgeSupported: invoke<string[]>('minecraft:get-forge-supported'),
  getPaperVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-paper-versions', mcVersion) as Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>,
  getPurpurVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-purpur-versions', mcVersion) as Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>,
  getFoliaVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-folia-versions', mcVersion) as Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>,
  getPaperSupported: invoke<string[]>('minecraft:get-paper-supported'),
  getPurpurSupported: invoke<string[]>('minecraft:get-purpur-supported'),
  getFoliaSupported: invoke<string[]>('minecraft:get-folia-supported'),
  getVelocitySupported: invoke<string[]>('minecraft:get-velocity-supported'),
  getVelocityVersions: (velocityVersion: string) => ipcRenderer.invoke('minecraft:get-velocity-versions', velocityVersion) as Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>,
  getWaterfallSupported: invoke<string[]>('minecraft:get-waterfall-supported'),
  getWaterfallVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-waterfall-versions', mcVersion) as Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>,
  getCustomVersions: invoke<string[]>('minecraft:get-custom-versions'),

  // ── Minecraft Auth & Launch ────────────────────────────
  setOfflineAuth: (username: string) => ipcRenderer.invoke('minecraft:set-offline-auth', username) as Promise<AuthSession | null>,
  getGameDir: invoke<string>('minecraft:get-game-dir'),
  getAuth: invoke<AuthSession | null>('minecraft:get-auth'),
  launchMinecraft: (params: MinecraftLaunchParams) => ipcRenderer.invoke('minecraft:launch', params) as Promise<{ success: boolean; error?: string }>,
  stopMinecraft: invoke<void>('minecraft:stop'),
  isMinecraftRunning: invoke<boolean>('minecraft:is-running'),

  // ── Minecraft Events ───────────────────────────────────
  onMinecraftProgress: (callback: (progress: MinecraftProgress) => void) => subscribe('minecraft:progress', callback),
  onMinecraftJavaProgress: (callback: (progress: JavaProgress) => void) => subscribe('minecraft:java-progress', callback),
  onMinecraftDebug: (callback: (message: string) => void) => subscribe('minecraft:debug', callback),
  onMinecraftData: (callback: (message: string) => void) => subscribe('minecraft:data', callback),
  onMinecraftDownloadStatus: (callback: (progress: MinecraftProgress) => void) => subscribe('minecraft:download-progress', callback),
  onMinecraftClose: (callback: (code: number) => void) => subscribeVoid('minecraft:close', callback),

  // ── Settings ───────────────────────────────────────────
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key) as Promise<string | undefined>,
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value) as Promise<void>,
  getTotalMemory: invoke<number>('system:get-total-memory'),

  // ── Servers ────────────────────────────────────────────
  listServers: (buildName: string) => ipcRenderer.invoke('servers:list', buildName) as Promise<Array<{ name: string; ip: string }>>,
  writeServersDat: (buildName: string, servers: Array<{ name: string; ip: string }>) => ipcRenderer.invoke('servers:write-dat', buildName, servers) as Promise<{ success: boolean; error?: string }>,
  pingServer: (address: string) => ipcRenderer.invoke('servers:ping', address) as Promise<ServerStatusResult>,

  // ── Build Intent Operations ────────────────────────────
  getBuildIntentPath: (buildId: string) => ipcRenderer.invoke('build:get-intent-path', buildId) as Promise<string>,
  getInstancesRoot: () => ipcRenderer.invoke('build:get-instances-root') as Promise<string>,
  pickFolder: (title?: string) => ipcRenderer.invoke('common:pick-folder', title) as Promise<string | null>,
  setInstancesRoot: (newRoot: string) => ipcRenderer.invoke('build:set-instances-root', newRoot) as Promise<{ success: boolean; root?: string; error?: string }>,
  saveModToIntent: (buildId: string, url: string, fileName: string) => ipcRenderer.invoke('build:save-mod-to-intent', buildId, url, fileName) as Promise<string | null>,
  saveLocalModToIntent: (buildId: string, localFilePath: string) => ipcRenderer.invoke('build:save-local-mod-to-intent', buildId, localFilePath) as Promise<string | null>,
  saveContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('build:save-content-to-intent', buildId, contentType, url, fileName) as Promise<string | null>,
  saveLocalContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => ipcRenderer.invoke('build:save-local-content-to-intent', buildId, contentType, localFilePath) as Promise<string | null>,
  deleteContentFromIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => ipcRenderer.invoke('build:delete-content-from-intent', buildId, contentType, fileName) as Promise<{ success: boolean; error?: string }>,
  setContentEnabled: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean) => ipcRenderer.invoke('build:set-content-enabled', buildId, contentType, fileName, enabled) as Promise<{ success: boolean; fileName?: string; error?: string }>,
  setBuildIntentPath: (buildId: string, intentPath: string) => ipcRenderer.invoke('build:set-intent-path', buildId, intentPath) as Promise<void>,
  deleteBuildIntent: (buildName: string) => ipcRenderer.invoke('build:delete-intent', buildName) as Promise<{ success: boolean; error?: string }>,
  installContentFile: (contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('content:install-remote', contentType, url, fileName) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string) => ipcRenderer.invoke('build:import-modrinth', buildName, projectSlug, versionId) as Promise<ModpackImportResult>,
  importCurseforgeModpack: (buildName: string, modId: number, fileId: number) => ipcRenderer.invoke('build:import-curseforge', buildName, modId, fileId) as Promise<ModpackImportResult>,
  importFtbModpack: (buildName: string, modpackId: number, versionId: number) => ipcRenderer.invoke('build:import-ftb', buildName, modpackId, versionId) as Promise<ModpackImportResult>,
  openAndImportModpack: invoke<ModpackImportResult & { name?: string; description?: string; icon?: string; source?: 'modrinth' | 'curseforge'; intentPath?: string }>('build:open-and-import'),
  cancelImportModpack: invoke<{ success: boolean }>('build:cancel-import'),
  onImportProgress: (callback: (progress: ImportProgress) => void) => subscribe('import:progress', callback),
  onContentDownloadProgress: (callback: (progress: { fileName: string; current: number; total: number }) => void) => subscribe('content:download-progress', callback),

  // ── Shell ──────────────────────────────────────────────
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  openLauncherFolder: invoke<void>('shell:open-launcher-folder'),
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:open-path', dirPath) as Promise<void>,

  // ── Logs ───────────────────────────────────────────────
  shareToMclogs: (content: string) => ipcRenderer.invoke('logs:share-to-mclogs', content) as Promise<{ success: boolean; url?: string; error?: string }>,

  // ── Java ───────────────────────────────────────────────
  detectJavaInstallations: invoke<JavaDetectResult[]>('java:detect'),
  pickJavaFile: invoke<string | null>('java:pick-file'),

  // ── AI ─────────────────────────────────────────────────
  getAiConfig: invoke<{ apiKey: string; endpoint: string; model: string }>('ai:get-config'),
  saveAiConfig: (config: { apiKey: string; endpoint: string; model: string }) => ipcRenderer.invoke('ai:save-config', config) as Promise<void>,
  analyzeCrash: (logContent: string, sessionId: string) => ipcRenderer.invoke('ai:analyze-crash', logContent, sessionId) as Promise<{ success: boolean; analysis?: string; error?: string }>,
  analyzeCrashStream: (requestId: string, logContent: string) => ipcRenderer.invoke('ai:analyze-crash-stream', requestId, logContent) as Promise<{ success: boolean; analysis?: string; error?: string }>,
  aiChatSend: (sessionId: string, userMessage: string) => ipcRenderer.invoke('ai:chat-send', sessionId, userMessage) as Promise<{ success: boolean; analysis?: string; error?: string }>,
  aiChatSendStream: (requestId: string, sessionId: string, userMessage: string) => ipcRenderer.invoke('ai:chat-send-stream', requestId, sessionId, userMessage) as Promise<{ success: boolean; analysis?: string; error?: string }>,
  aiListSessions: invoke<Array<{ id: string; title: string; createdAt: number; updatedAt: number }>>('ai:sessions-list'),
  aiCreateSession: (id: string, title: string) => ipcRenderer.invoke('ai:sessions-create', id, title) as Promise<void>,
  aiRenameSession: (id: string, title: string) => ipcRenderer.invoke('ai:sessions-rename', id, title) as Promise<void>,
  aiDeleteSession: (id: string) => ipcRenderer.invoke('ai:sessions-delete', id) as Promise<void>,
  aiListMessages: (sessionId: string) => ipcRenderer.invoke('ai:messages-list', sessionId) as Promise<Array<{ id: string; role: string; content: string; createdAt: number }>>,
  onAiStreamChunk: (callback: (data: { requestId: string; content: string }) => void) => subscribe<{ requestId: string; content: string }>('ai:stream-chunk', callback),
  onAiStreamDone: (callback: (data: { requestId: string; fullText: string }) => void) => subscribe<{ requestId: string; fullText: string }>('ai:stream-done', callback),
  onAiStreamError: (callback: (data: { requestId: string; error: string }) => void) => subscribe<{ requestId: string; error: string }>('ai:stream-error', callback),

  // ── Worlds ─────────────────────────────────────────────
  listWorlds: (buildName: string) => ipcRenderer.invoke('worlds:list', buildName) as Promise<WorldInfo[]>,
  renameWorld: (buildName: string, folder: string, newName: string) => ipcRenderer.invoke('worlds:rename', buildName, folder, newName) as Promise<{ success: boolean; error?: string }>,
  copyWorld: (buildName: string, folder: string, newName: string) => ipcRenderer.invoke('worlds:copy', buildName, folder, newName) as Promise<{ success: boolean; folder?: string; error?: string }>,
  importWorldZip: (buildName: string, localFilePath: string, newName?: string) => ipcRenderer.invoke('worlds:import-zip', buildName, localFilePath, newName) as Promise<{ success: boolean; folder?: string; error?: string }>,
  deleteWorld: (buildName: string, folder: string) => ipcRenderer.invoke('worlds:delete', buildName, folder) as Promise<{ success: boolean; error?: string }>,
  setWorldIcon: (buildName: string, folder: string, dataUrl: string) => ipcRenderer.invoke('worlds:set-icon', buildName, folder, dataUrl) as Promise<{ success: boolean; error?: string }>,
  resetWorldIcon: (buildName: string, folder: string) => ipcRenderer.invoke('worlds:reset-icon', buildName, folder) as Promise<{ success: boolean; error?: string }>,
  listWorldDatapacks: (buildName: string, folder: string) => ipcRenderer.invoke('worlds:list-datapacks', buildName, folder) as Promise<DatapackInfo[]>,
  installDatapackRemote: (buildName: string, folder: string, url: string, fileName: string) => ipcRenderer.invoke('worlds:install-datapack-remote', buildName, folder, url, fileName) as Promise<{ success: boolean; path?: string; error?: string }>,
  installDatapackLocal: (buildName: string, folder: string, localFilePath: string) => ipcRenderer.invoke('worlds:install-datapack-local', buildName, folder, localFilePath) as Promise<{ success: boolean; path?: string; error?: string }>,
  deleteWorldDatapack: (buildName: string, folder: string, fileName: string) => ipcRenderer.invoke('worlds:delete-datapack', buildName, folder, fileName) as Promise<{ success: boolean; error?: string }>,

  // ── Screenshots ───────────────────────────────────────
  listScreenshots: (buildName: string) => ipcRenderer.invoke('screenshots:list', buildName) as Promise<ScreenshotInfo[]>,
  getScreenshot: (buildName: string, fileName: string) => ipcRenderer.invoke('screenshots:get', buildName, fileName) as Promise<string | null>,
  deleteScreenshot: (buildName: string, fileName: string) => ipcRenderer.invoke('screenshots:delete', buildName, fileName) as Promise<{ success: boolean; error?: string }>,
  renameScreenshot: (buildName: string, fileName: string, newName: string) => ipcRenderer.invoke('screenshots:rename', buildName, fileName, newName) as Promise<{ success: boolean; error?: string }>,

  // ── Cloud (Third-party providers) ──────────────────────
  cloudListProviders: invoke<Array<{ id: string; name: string }>>('cloud:list-providers'),
  cloudConnect: (providerId: string, authData?: Record<string, string>) => ipcRenderer.invoke('cloud:connect', providerId, authData) as Promise<{ success: boolean; provider?: string; error?: string }>,
  cloudIsConnected: (providerId: string) => ipcRenderer.invoke('cloud:is-connected', providerId) as Promise<boolean>,
  cloudDisconnect: (providerId: string) => ipcRenderer.invoke('cloud:disconnect', providerId) as Promise<{ success: boolean; error?: string }>,
  cloudListFiles: (providerId: string, folderPath?: string) => ipcRenderer.invoke('cloud:list-files', providerId, folderPath) as Promise<{ success: boolean; files?: Array<{ id: string; name: string; size: number; modifiedAt?: string; path: string; isDir: boolean; category?: string }>; error?: string }>,
  cloudUploadFile: (providerId: string, localPath: string, remotePath: string) => ipcRenderer.invoke('cloud:upload-file', providerId, localPath, remotePath) as Promise<{ success: boolean; id?: string; name?: string; error?: string }>,
  cloudDownloadFile: (providerId: string, remotePath: string, localPath: string) => ipcRenderer.invoke('cloud:download-file', providerId, remotePath, localPath) as Promise<{ success: boolean; localPath?: string; error?: string }>,
  cloudDeleteFile: (providerId: string, remotePath: string) => ipcRenderer.invoke('cloud:delete-file', providerId, remotePath) as Promise<{ success: boolean; error?: string }>,
  cloudGetQuota: (providerId: string) => ipcRenderer.invoke('cloud:get-quota', providerId) as Promise<{ used: number; total: number } | null>,
  cloudUploadBuild: (providerId: string, buildName: string, uploadId?: string) => ipcRenderer.invoke('cloud:upload-build', providerId, buildName, uploadId) as Promise<{ success: boolean; id?: string; name?: string; error?: string }>,
  onCloudUploadProgress: (callback: (data: { id: string; percent: number; stage: "zip" | "upload" }) => void) => subscribe('cloud:upload-progress', callback),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  cloudUploadAccount: (providerId: string, account: { id: string; type: string; username: string; uuid?: string }) => ipcRenderer.invoke('cloud:upload-account', providerId, account) as Promise<{ success: boolean; id?: string; name?: string; error?: string }>,
  cloudDownloadAndImport: (providerId: string, remotePath: string, fileType: string) => ipcRenderer.invoke('cloud:download-and-import', providerId, remotePath, fileType) as Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>,

  // ── Skins ──────────────────────────────────────────────
  skinsGetProfile: (accountId?: string) => ipcRenderer.invoke('skins:get-profile', accountId) as Promise<McProfile | null>,
  skinsUploadSkin: (filePath: string, variant: "classic" | "slim", accountId?: string) => ipcRenderer.invoke('skins:upload-skin', { filePath, variant, accountId }) as Promise<boolean>,
  skinsDeleteSkin: (accountId?: string) => ipcRenderer.invoke('skins:delete-skin', accountId) as Promise<boolean>,
  skinsSetCape: (capeId: string | null, accountId?: string) => ipcRenderer.invoke('skins:set-cape', { capeId, accountId }) as Promise<boolean>,
  skinsListLibrary: (accountId: string) => ipcRenderer.invoke('skins:list-library', accountId) as Promise<LibrarySkin[]>,
  skinsSaveToLibrary: (filePath: string, name: string, variant: "classic" | "slim", accountId: string, capeId?: string | null) => ipcRenderer.invoke('skins:save-to-library', { filePath, name, variant, accountId, capeId }) as Promise<LibrarySkin | null>,
  skinsDeleteFromLibrary: (id: string) => ipcRenderer.invoke('skins:delete-from-library', id) as Promise<boolean>,
  skinsUpdateVariant: (id: string, variant: "classic" | "slim", capeId?: string | null, name?: string) => ipcRenderer.invoke('skins:update-variant', { id, variant, capeId, name }) as Promise<boolean>,
  skinsApplyLibrarySkin: (skinId: string, accountId: string) => ipcRenderer.invoke('skins:apply-library-skin', { skinId, accountId }) as Promise<boolean>,
  skinsImportFromUrl: (url: string, name: string, variant: "classic" | "slim", accountId: string) => ipcRenderer.invoke('skins:import-from-url', { url, name, variant, accountId }) as Promise<LibrarySkin | null>,

  readLocalFile: (filePath: string) => ipcRenderer.invoke('read-local-file', filePath) as Promise<string | null>,

  // ── Quick Play ──────────────────────────────────────────
  quickPlayList: (buildName?: string, gameDir?: string) => ipcRenderer.invoke('quickplay:list', buildName, gameDir) as Promise<QuickPlayEntry[]>,
  quickPlayClear: (buildName?: string, gameDir?: string) => ipcRenderer.invoke('quickplay:clear', buildName, gameDir) as Promise<void>,
  quickPlayRemove: (buildName: string | undefined, gameDir: string | undefined, entry: QuickPlayEntry) => ipcRenderer.invoke('quickplay:remove', buildName, gameDir, entry) as Promise<void>,

  // ── MC Server Management ───────────────────────────────
  mcServerList: invoke<McServerInfo[]>('mc-server:list'),
  mcServerGet: (id: string) => ipcRenderer.invoke('mc-server:get', id) as Promise<McServerInfo | null>,
  mcServerCreate: (data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string }) => ipcRenderer.invoke('mc-server:create', data) as Promise<McServerInfo>,
  mcServerInstallPack: (params: { source: "modrinth" | "curseforge"; projectSlug?: string; versionId?: string; modId?: number; fileId?: number; name?: string; icon?: string; port?: number; xmx?: number; xms?: number; extraJavaArgs?: string; javaPath?: string; relayEnabled?: boolean; onlineMode?: boolean; maxPlayers?: number }) => ipcRenderer.invoke('mc-server:install-pack', params) as Promise<McServerInfo>,
  mcServerAnalyzeJar: (jarPath: string) => ipcRenderer.invoke('mc-server:analyze-jar', jarPath) as Promise<{ minecraftVersion: string | null; loaderId: string | null; loaderLabel: string | null; modId: string | null; mainClass: string | null; error?: string }>,
  mcServerUpdate: (id: string, update: Record<string, unknown>) => ipcRenderer.invoke('mc-server:update', id, update) as Promise<void>,
  mcServerDelete: (id: string) => ipcRenderer.invoke('mc-server:delete', id) as Promise<void>,
  mcServerRestore: (id: string) => ipcRenderer.invoke('mc-server:restore', id) as Promise<void>,
  mcServerListTrash: invoke<McServerInfo[]>('mc-server:list-trash'),
  mcServerPurgeTrash: (deleteTunnel?: boolean) => ipcRenderer.invoke('mc-server:purge-trash', deleteTunnel ?? true) as Promise<void>,
  mcServerPermanentDelete: (id: string, deleteTunnel?: boolean) => ipcRenderer.invoke('mc-server:permanent-delete', id, deleteTunnel ?? true) as Promise<void>,
  mcServerExportZip: (id: string, serverName: string, categories?: string[]) => ipcRenderer.invoke('mc-server:export-zip', id, serverName, categories) as Promise<{ success: boolean; path?: string; error?: string }>,
  mcServerDuplicate: (id: string) => ipcRenderer.invoke('mc-server:duplicate', id) as Promise<McServerInfo | null>,
  mcServerStart: (id: string) => ipcRenderer.invoke('mc-server:start', id) as Promise<void>,
  mcServerStop: (id: string) => ipcRenderer.invoke('mc-server:stop', id) as Promise<void>,
  mcServerKill: (id: string) => ipcRenderer.invoke('mc-server:kill', id) as Promise<void>,
  mcServerSendCommand: (id: string, command: string) => ipcRenderer.invoke('mc-server:send-command', id, command) as Promise<void>,
  mcServerStatus: (id: string) => ipcRenderer.invoke('mc-server:status', id) as Promise<McServerState>,
  mcServerMetrics: (id: string) => ipcRenderer.invoke('mc-server:metrics', id) as Promise<McServerMetrics>,
  mcServerLogs: (id: string) => ipcRenderer.invoke('mc-server:logs', id) as Promise<string[]>,
  mcServerOpenFolder: (id: string) => ipcRenderer.invoke('mc-server:open-folder', id) as Promise<void>,
  mcServerReadProperties: (id: string) => ipcRenderer.invoke('mc-server:read-properties', id) as Promise<Record<string, string> | null>,
  mcServerWriteProperties: (id: string, properties: Record<string, string>) => ipcRenderer.invoke('mc-server:write-properties', id, properties) as Promise<void>,
  mcServerGetWhitelist: (id: string) => ipcRenderer.invoke('mc-server:get-whitelist', id) as Promise<McPlayerEntry[]>,
  mcServerAddWhitelist: (id: string, username: string) => ipcRenderer.invoke('mc-server:add-whitelist', id, username) as Promise<void>,
  mcServerRemoveWhitelist: (id: string, uuid: string) => ipcRenderer.invoke('mc-server:remove-whitelist', id, uuid) as Promise<void>,
  mcServerGetOps: (id: string) => ipcRenderer.invoke('mc-server:get-ops', id) as Promise<McPlayerEntry[]>,
  mcServerAddOp: (id: string, username: string) => ipcRenderer.invoke('mc-server:add-op', id, username) as Promise<void>,
  mcServerRemoveOp: (id: string, uuid: string) => ipcRenderer.invoke('mc-server:remove-op', id, uuid) as Promise<void>,
  mcServerGetBanned: (id: string) => ipcRenderer.invoke('mc-server:get-banned', id) as Promise<McPlayerEntry[]>,
  mcServerBanPlayer: (id: string, username: string) => ipcRenderer.invoke('mc-server:ban-player', id, username) as Promise<void>,
  mcServerUnbanPlayer: (id: string, uuid: string) => ipcRenderer.invoke('mc-server:unban-player', id, uuid) as Promise<void>,
  mcServerGetBannedIps: (id: string) => ipcRenderer.invoke('mc-server:get-banned-ips', id) as Promise<McPlayerEntry[]>,
  mcServerBanIp: (id: string, ip: string) => ipcRenderer.invoke('mc-server:ban-ip', id, ip) as Promise<void>,
  mcServerUnbanIp: (id: string, ip: string) => ipcRenderer.invoke('mc-server:unban-ip', id, ip) as Promise<void>,
  mcServerGetAddresses: (id: string) => ipcRenderer.invoke('mc-server:get-addresses', id) as Promise<{ local: string; public: string | null; custom: string } | null>,
  mcServerCheckEula: (id: string) => ipcRenderer.invoke('mc-server:check-eula', id) as Promise<boolean>,
  mcServerAcceptEula: (id: string) => ipcRenderer.invoke('mc-server:accept-eula', id) as Promise<void>,

  // ── Server Files ──────────────────────────────────────────
  mcServerFsList: (id: string, relativePath: string) => ipcRenderer.invoke('mc-server:fs-list', id, relativePath) as Promise<Array<{ name: string; isDir: boolean; size: number; lastModified: number }>>,
  mcServerFsRead: (id: string, relativePath: string) => ipcRenderer.invoke('mc-server:fs-read', id, relativePath) as Promise<string | null>,
  mcServerFsWrite: (id: string, relativePath: string, content: string) => ipcRenderer.invoke('mc-server:fs-write', id, relativePath, content) as Promise<void>,
  mcServerFsDelete: (id: string, relativePath: string) => ipcRenderer.invoke('mc-server:fs-delete', id, relativePath) as Promise<void>,
  mcServerFsRename: (id: string, oldPath: string, newPath: string) => ipcRenderer.invoke('mc-server:fs-rename', id, oldPath, newPath) as Promise<void>,
  mcServerFsMkdir: (id: string, relativePath: string) => ipcRenderer.invoke('mc-server:fs-mkdir', id, relativePath) as Promise<void>,
  mcServerFsStat: (id: string, relativePath: string) => ipcRenderer.invoke('mc-server:fs-stat', id, relativePath) as Promise<{ name: string; isDir: boolean; size: number; lastModified: number } | null>,
  mcServerFsDownload: (id: string, relativePath: string, url: string, fileName: string) => ipcRenderer.invoke('mc-server:fs-download', id, relativePath, url, fileName) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  mcServerResolveInstalled: (id: string, relativePath: string) => ipcRenderer.invoke('mc-server:resolve-installed', id, relativePath) as Promise<Array<{ name: string; sha1: string; projectId?: string; versionId?: string }>>,

  // ── XN-Connect Relay ──────────────────────────────────
  xnConnectAuthorize: () => ipcRenderer.invoke('xn-connect:authorize') as Promise<boolean>,
  xnConnectStart: (serverId: string) => ipcRenderer.invoke('xn-connect:start', serverId) as Promise<XnConnectState>,
  xnConnectStop: (serverId: string) => ipcRenderer.invoke('xn-connect:stop', serverId) as Promise<void>,
  xnConnectStatus: (serverId: string) => ipcRenderer.invoke('xn-connect:status', serverId) as Promise<XnConnectState>,
  xnConnectUsage: invoke<XnConnectUsage | null>('xn-connect:usage'),
  onXnConnectUsage: (callback: (usage: XnConnectUsage) => void) => subscribe<XnConnectUsage>('xn-connect:usage-updated', callback),
  onXnConnectState: (callback: (data: { serverId: string; state: XnConnectState }) => void) => subscribe<{ serverId: string; state: XnConnectState }>('xn-connect:state', callback),
  onXnConnectLog: (callback: (data: { serverId: string; line: string }) => void) => subscribe<{ serverId: string; line: string }>('xn-connect:log', callback),
  onXnConnectAuthState: (callback: (data: { state: XnConnectState }) => void) => subscribe<{ state: XnConnectState }>('xn-connect:auth-state', callback),

  onMcServerLog: (callback: (data: { id: string; line: string }) => void) => subscribe<{ id: string; line: string }>('mc-server:log', callback),
  onMcServerStateChange: (callback: (data: { id: string; state: McServerState }) => void) => subscribe<{ id: string; state: McServerState }>('mc-server:state-change', callback),
  onMcServerDownloadProgress: (callback: (data: { id: string; progress: { phase: string; percent?: number; bytesTotal?: number; bytesDownloaded?: number; message: string } }) => void) => subscribe('mc-server:download-progress', callback),

  // ── Updater ─────────────────────────────────────────────
  updateCheck: invoke<{ available: boolean; version?: string; error?: string }>('update:check'),
  updateDownload: invoke<{ success: boolean; error?: string }>('update:download'),
  updateInstall: invoke<void>('update:install'),
  updateInfo: invoke<{ version: string | null; downloaded: boolean }>('update:info'),
  onUpdateStatus: (callback: (status: { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }) => void) => subscribe('update:status', callback),
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => subscribe('update:progress', callback),
})
