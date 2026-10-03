import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AuthPayload,
  AuthSession,
  DeviceCodeStart,
  DeviceCodePoll,
  MinecraftVersionInfo,
  MinecraftProgress,
  MinecraftNewsEntry,
  DbAccount,
  DbBuild,
  DbBuildLight,
  DbBuildMod,
  MinecraftLaunchParams,
  JavaProgress,
  ImportableLauncherInstance,

  JavaDetectResult,
  BuildIntentScanResult,
  ModpackImportResult,
  ImportProgress,
  ContentDownloadProgress,
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModEnvironment,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  JarDependencyInspection,
  ContentFileMetadata,
  ContentDropKind,
  ContentDropClassification,
  ModSearchResult,
  FTBVersionManifest,
  CleanupFn,
  QuickPlayEntry,
  BuildExportCategory,
  McProfile,
  LibrarySkin,
  LabyCatalogPage,
  LabyImportResult,
  LabyOrder,
  LabyPlayer,
  LabySkin,
  LabyTag,
  McServerInfo,
  McPlayerEntry,
  McServerState,
  McServerMetrics,
  WorldInfo,
  DatapackInfo,
  ScreenshotInfo,
  XnConnectState,
  XnConnectUsage,
  UpdateChannel,
  BuildContentUpdates,
  StatsOverview,
  StatsRange,
  StorageScanResult,
  StorageCleanTarget,
  StorageCleanResult,
  CloudUploadCategory,
  MinecraftCloseInfo,
  ServerStatusResult,
} from '@xnlc/types' with { 'resolution-mode': 'import' }

function subscribe<T>(channel: string, callback: (payload: T) => void): CleanupFn {
  const handler = (_: Electron.IpcRendererEvent, payload: T) => callback(payload)
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

  // ── Auth ───────────────────────────────────────────────
  loginElyBy: invoke<AuthPayload>('auth:elyby-login'),
  startElyByDeviceCode: invoke<DeviceCodeStart>('auth:elyby-device-start'),
  pollElyByDeviceCode: (deviceCode: string) => ipcRenderer.invoke('auth:elyby-device-poll', deviceCode) as Promise<DeviceCodePoll>,
  loginXnSkins: invoke<AuthPayload>('auth:xnskins-login'),
  startXnSkinsDeviceCode: invoke<DeviceCodeStart>('auth:xnskins-device-start'),
  pollXnSkinsDeviceCode: (deviceCode: string) => ipcRenderer.invoke('auth:xnskins-device-poll', deviceCode) as Promise<DeviceCodePoll>,
  loginMicrosoft: invoke<AuthPayload>('auth:microsoft-login'),
  startMicrosoftDeviceCode: invoke<DeviceCodeStart>('auth:microsoft-device-start'),
  pollMicrosoftDeviceCode: (deviceCode: string) => ipcRenderer.invoke('auth:microsoft-device-poll', deviceCode) as Promise<DeviceCodePoll>,

  // ── News ───────────────────────────────────────────────
  fetchMinecraftNews: invoke<MinecraftNewsEntry[]>('fetch:minecraft-news'),

  // ── Database ───────────────────────────────────────────
  loadAccounts: invoke<DbAccount[]>('db:load-accounts'),
  saveAccount: (account: DbAccount) => ipcRenderer.invoke('db:save-account', account) as Promise<void>,
  removeAccount: (id: string) => ipcRenderer.invoke('db:remove-account', id) as Promise<void>,
  loadBuildsLight: invoke<DbBuildLight[]>('db:load-builds-light'),
  loadBuildContent: (buildId: string) => ipcRenderer.invoke('db:load-build-content', buildId) as Promise<{ mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods: Record<string, string> } | null>,
  fetchMissingBuildMods: (buildName: string) => ipcRenderer.invoke('build:fetch-missing-mods', buildName) as Promise<{ success: boolean; downloaded?: number; failed?: number; missing?: number; error?: string }>,
  saveBuilds: (builds: DbBuild[]) => ipcRenderer.invoke('db:save-builds', builds) as Promise<void>,
  insertBuild: (build: DbBuild) => ipcRenderer.invoke('db:insert-build', build) as Promise<void>,
  updateBuildFields: (buildId: string, fields: Partial<DbBuild>) => ipcRenderer.invoke('db:update-build-fields', buildId, fields) as Promise<void>,
  dbIsFallbackStorage: invoke<{ isFallback: boolean }>('db:is-fallback-storage'),
  reorderAccounts: (ids: string[]) => ipcRenderer.invoke('db:reorder-accounts', ids) as Promise<void>,

  // ── Build / Intent ─────────────────────────────────────
  scanBuildIntentContent: (buildName: string) => ipcRenderer.invoke('build:scan-intent-content', buildName) as Promise<BuildIntentScanResult>,
  discoverImportableInstances: invoke<ImportableLauncherInstance[]>('launcher:discover-importable-instances'),
  // Импорт из произвольной папки: хендлер launcher:discover-from-path (system.ts).
  // Без этого метода выбор кастомного пути падал с TypeError.
  discoverFromPath: (source: string, customPath: string) => ipcRenderer.invoke('launcher:discover-from-path', source, customPath) as Promise<ImportableLauncherInstance[]>,
  importGdLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-gdlauncher-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  importLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  copyBuild: (buildName: string, newName: string) => ipcRenderer.invoke('build:copy', buildName, newName) as Promise<{ success: boolean; intentPath?: string; error?: string }>,
  renameBuildIntent: (oldName: string, newName: string) => ipcRenderer.invoke('build:rename-intent', oldName, newName) as Promise<{ success: boolean; intentPath?: string; error?: string }>,
  exportBuildZip: (buildName: string, label: string, categories?: BuildExportCategory[]) => ipcRenderer.invoke('build:export-zip', buildName, label, categories) as Promise<{ success: boolean; path?: string; error?: string }>,
  exportBuildModlist: (buildName: string, label: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => ipcRenderer.invoke('build:export-modlist', buildName, label, format) as Promise<{ success: boolean; path?: string; error?: string }>,
  moveBuildIntentToTrash: (dirName: string, metadata?: Record<string, unknown>) => ipcRenderer.invoke('build:move-intent-to-trash', dirName, metadata) as Promise<{ success: boolean; trashName?: string; error?: string }>,
  restoreBuildIntentFromTrash: (dirName: string, trashName: string) => ipcRenderer.invoke('build:restore-intent-from-trash', dirName, trashName) as Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }>,
  purgeBuildTrash: () => ipcRenderer.invoke('build:purge-trash') as Promise<{ success: boolean; error?: string }>,
  listTrashBuilds: () => ipcRenderer.invoke('build:list-trash') as Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string }>>,
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
  modsCurseforgeChangelog: (modId: number, fileId: number) => ipcRenderer.invoke('mods:curseforge-changelog', modId, fileId) as Promise<string>,
  modsResolveDependencies: (version: ModVersion, source: "modrinth" | "curseforge") => ipcRenderer.invoke('mods:resolve-dependencies', version, source) as Promise<ModDependency[]>,
  // Зависимости из метаданных jar: у новых файлов CurseForge/Modrinth список пустой,
  // а сам мод требует fabric-api и падает без него.
  modsInspectJarDependencies: (url: string, source: "modrinth" | "curseforge") => ipcRenderer.invoke('mods:inspect-jar-dependencies', url, source) as Promise<JarDependencyInspection>,
  checkBuildLoaderRequirements: (buildName: string, modLoader?: string, loaderVersion?: string) => ipcRenderer.invoke('mods:check-loader-requirements', buildName, modLoader, loaderVersion) as Promise<{ loaderId: string; loaderVersion?: string; checked: number; issues: Array<{ fileName: string; modName?: string; modId?: string; loaderId: string; requirement: string; buildLoaderVersion?: string; satisfied: boolean; reason?: string }> }>,
  modsFtbSearch: (query: string, page?: number, options?: { sortBy?: ModSort; categories?: string[]; gameVersion?: string; loader?: string }) => ipcRenderer.invoke('mods:ftb-search', query, page, options) as Promise<ModSearchResponse>,
  modsFtbCatalogFacets: () => ipcRenderer.invoke('mods:ftb-catalog-facets') as Promise<{ categories: string[]; gameVersions: string[]; loaders: string[] }>,
  modsFtbDetails: (id: number) => ipcRenderer.invoke('mods:ftb-details', id) as Promise<ModDetails | null>,
  modsFtbChangelog: (id: number, versionId: number) => ipcRenderer.invoke('mods:ftb-changelog', id, versionId) as Promise<string>,
  modsModrinthCategories: () => ipcRenderer.invoke('mods:modrinth-categories') as Promise<any[]>,
  modsCurseforgeCategories: () => ipcRenderer.invoke('mods:curseforge-categories') as Promise<any[]>,

  // ── Minecraft Versions ─────────────────────────────────
  getMinecraftVersions: invoke<MinecraftVersionInfo[]>('minecraft:get-versions'),
  getLatestRelease: invoke<string | null>('minecraft:get-latest-release'),
  getFabricVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-fabric-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getFabricSupported: invoke<string[]>('minecraft:get-fabric-supported'),
  getLiteLoaderVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-liteloader-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getLiteLoaderRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-liteloader-recommended', mcVersion) as Promise<string | null>,
  getLiteLoaderSupported: invoke<string[]>('minecraft:get-liteloader-supported'),
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
  getSpongeSupported: (spongeType?: string) => ipcRenderer.invoke('minecraft:get-sponge-supported', spongeType) as Promise<string[]>,
  getSpongeVersions: (spongeType: string, mcVersion: string) => ipcRenderer.invoke('minecraft:get-sponge-versions', spongeType, mcVersion) as Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>,
  getCustomVersions: invoke<string[]>('minecraft:get-custom-versions'),

  // ── Minecraft Auth & Launch ────────────────────────────
  setOfflineAuth: (username: string) => ipcRenderer.invoke('minecraft:set-offline-auth', username) as Promise<AuthSession | null>,
  getGameDir: invoke<string>('minecraft:get-game-dir'),
  getAuth: invoke<AuthSession | null>('minecraft:get-auth'),
  launchMinecraft: (params: MinecraftLaunchParams) => ipcRenderer.invoke('minecraft:launch', params) as Promise<{ success: boolean; error?: string }>,
  stopMinecraft: invoke<void>('minecraft:stop'),
  isMinecraftRunning: invoke<boolean>('minecraft:is-running'),

  // ── Minecraft Events ───────────────────────────────────
  onMinecraftJavaProgress: (callback: (progress: JavaProgress) => void) => subscribe('minecraft:java-progress', callback),
  onMinecraftDebug: (callback: (message: string) => void) => subscribe('minecraft:debug', callback),
  onMinecraftData: (callback: (message: string) => void) => subscribe('minecraft:data', callback),
  onMinecraftDownloadStatus: (callback: (progress: MinecraftProgress) => void) => subscribe('minecraft:download-progress', callback),
  onMinecraftClose: (callback: (info: MinecraftCloseInfo) => void) => subscribe<MinecraftCloseInfo>('minecraft:close', callback),

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
  // Метаданные локального файла: нужны, чтобы брошенный в панель мод появлялся
  // со своим именем/версией/автором, а не с именем файла.
  readLocalContentMetadata: (localFilePath: string) => ipcRenderer.invoke('build:read-local-content-metadata', localFilePath) as Promise<ContentFileMetadata | null>,
  // Что можно принять из перетащенного, а что нет: папку от файла отличает main.
  classifyDropPaths: (paths: string[], kind: ContentDropKind) => ipcRenderer.invoke('build:classify-drop-paths', paths, kind) as Promise<ContentDropClassification>,
  saveContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('build:save-content-to-intent', buildId, contentType, url, fileName) as Promise<string | null>,
  saveLocalContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => ipcRenderer.invoke('build:save-local-content-to-intent', buildId, contentType, localFilePath) as Promise<string | null>,
  deleteContentFromIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => ipcRenderer.invoke('build:delete-content-from-intent', buildId, contentType, fileName) as Promise<{ success: boolean; error?: string }>,
  setContentEnabled: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean) => ipcRenderer.invoke('build:set-content-enabled', buildId, contentType, fileName, enabled) as Promise<{ success: boolean; fileName?: string; error?: string }>,
  setBuildIntentPath: (buildId: string, intentPath: string) => ipcRenderer.invoke('build:set-intent-path', buildId, intentPath) as Promise<void>,
  pruneLoaderProfiles: (buildName: string, modLoader?: string, loaderVersion?: string) => ipcRenderer.invoke('build:prune-loader-profiles', buildName, modLoader, loaderVersion) as Promise<{ removed: string[]; kept: string[] }>,
  deleteBuildIntent: (buildName: string) => ipcRenderer.invoke('build:delete-intent', buildName) as Promise<{ success: boolean; error?: string }>,
  importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string, targetBuildId?: string) => ipcRenderer.invoke('build:import-modrinth', buildName, projectSlug, versionId, targetBuildId) as Promise<ModpackImportResult>,
  importCurseforgeModpack: (buildName: string, modId: number, fileId: number, targetBuildId?: string) => ipcRenderer.invoke('build:import-curseforge', buildName, modId, fileId, targetBuildId) as Promise<ModpackImportResult>,
  importFtbModpack: (buildName: string, modpackId: number, versionId: number, targetBuildId?: string) => ipcRenderer.invoke('build:import-ftb', buildName, modpackId, versionId, targetBuildId) as Promise<ModpackImportResult>,
  openAndImportModpack: (nameOverride?: string) => invoke<ModpackImportResult & { name?: string; description?: string; icon?: string; source?: 'modrinth' | 'curseforge'; intentPath?: string }>('build:open-and-import')(nameOverride),
  cancelImportModpack: invoke<{ success: boolean }>('build:cancel-import'),
  onImportProgress: (callback: (progress: ImportProgress) => void) => subscribe('import:progress', callback),
  onBuildExportProgress: (callback: (progress: { current: number; total: number }) => void) => subscribe('build:export-progress', callback),
  onContentDownloadProgress: (callback: (progress: ContentDownloadProgress) => void) => subscribe('content:download-progress', callback),

  // ── Content Updates ──────────────────────────────────────
  checkBuildContentUpdates: (buildId: string, channel?: UpdateChannel) => ipcRenderer.invoke('build:check-content-updates', buildId, channel) as Promise<BuildContentUpdates>,
  getContentUpdatesCache: () => ipcRenderer.invoke('build:get-content-updates-cache') as Promise<Record<string, BuildContentUpdates>>,
  getContentUpdatesCounts: () => ipcRenderer.invoke('build:get-content-updates-counts') as Promise<Record<string, { mods: number; resourcepacks: number; shaders: number }>>,
  dismissContentUpdate: (buildId: string, itemId: string) => ipcRenderer.invoke('build:dismiss-content-update', buildId, itemId) as Promise<void>,

  // ── Game Statistics ──────────────────────────────────────
  getStatsOverview: (range?: StatsRange) => ipcRenderer.invoke('stats:overview', range) as Promise<StatsOverview>,
  onStatsUpdated: (callback: () => void) => subscribe<{}>('stats:updated', callback),

  // ── Storage / Disk Manager ───────────────────────────────
  scanStorage: () => ipcRenderer.invoke('storage:scan') as Promise<StorageScanResult>,
  cleanStorage: (target: StorageCleanTarget) => ipcRenderer.invoke('storage:clean', target) as Promise<StorageCleanResult>,

  // ── Shell ──────────────────────────────────────────────
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  openLauncherFolder: invoke<void>('shell:open-launcher-folder'),
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:open-path', dirPath) as Promise<void>,

  // ── Logs ───────────────────────────────────────────────

  // ── Java ───────────────────────────────────────────────
  detectJavaInstallations: (force?: boolean) => ipcRenderer.invoke('java:detect', force) as Promise<JavaDetectResult[]>,
  pickJavaFile: invoke<string | null>('java:pick-file'),

  // ── AI ─────────────────────────────────────────────────
  getAiConfig: invoke<{ apiKey: string; endpoint: string; model: string }>('ai:get-config'),
  saveAiConfig: (config: { apiKey: string; endpoint: string; model: string }) => ipcRenderer.invoke('ai:save-config', config) as Promise<void>,
  listAiModels: (override?: { apiKey?: string; endpoint?: string }) => ipcRenderer.invoke('ai:list-models', override) as Promise<{ success: boolean; models?: string[]; error?: string }>,
  analyzeCrash: (logContent: string) => ipcRenderer.invoke('ai:analyze-crash', logContent) as Promise<{ success: boolean; analysis?: string; error?: string }>,
  analyzeCrashStream: (requestId: string, logContent: string) => ipcRenderer.invoke('ai:analyze-crash-stream', requestId, logContent) as Promise<{ success: boolean; analysis?: string; error?: string }>,
  onAiStreamChunk: (callback: (data: { requestId: string; content: string }) => void) => subscribe<{ requestId: string; content: string }>('ai:stream-chunk', callback),
  onAiStreamDone: (callback: (data: { requestId: string; fullText: string }) => void) => subscribe<{ requestId: string; fullText: string }>('ai:stream-done', callback),
  onAiStreamError: (callback: (data: { requestId: string; error: string }) => void) => subscribe<{ requestId: string; error: string }>('ai:stream-error', callback),

  // ── Worlds ─────────────────────────────────────────────
  listWorlds: (buildName: string) => ipcRenderer.invoke('worlds:list', buildName) as Promise<WorldInfo[]>,
  renameWorld: (buildName: string, folder: string, newName: string) => ipcRenderer.invoke('worlds:rename', buildName, folder, newName) as Promise<{ success: boolean; error?: string }>,
  copyWorld: (buildName: string, folder: string, newName: string) => ipcRenderer.invoke('worlds:copy', buildName, folder, newName) as Promise<{ success: boolean; folder?: string; error?: string }>,
  importWorldZip: (buildName: string, localFilePath: string, newName?: string) => ipcRenderer.invoke('worlds:import-zip', buildName, localFilePath, newName) as Promise<{ success: boolean; folder?: string; error?: string }>,
  importWorldRemote: (buildName: string, url: string, preferredName?: string) => ipcRenderer.invoke('worlds:import-remote', buildName, url, preferredName) as Promise<{ success: boolean; folder?: string; error?: string }>,
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
  cloudDownloadFile: (providerId: string, remotePath: string, localPath: string) => ipcRenderer.invoke('cloud:download-file', providerId, remotePath, localPath) as Promise<{ success: boolean; localPath?: string; error?: string }>,
  cloudDeleteFile: (providerId: string, remotePath: string) => ipcRenderer.invoke('cloud:delete-file', providerId, remotePath) as Promise<{ success: boolean; error?: string }>,
  cloudGetQuota: (providerId: string) => ipcRenderer.invoke('cloud:get-quota', providerId) as Promise<{ used: number; total: number } | null>,
  cloudUploadBuild: (providerId: string, buildName: string, uploadId?: string, categories?: CloudUploadCategory[]) => ipcRenderer.invoke('cloud:upload-build', providerId, buildName, uploadId, categories) as Promise<{ success: boolean; id?: string; name?: string; error?: string }>,
  cloudUploadServer: (providerId: string, serverId: string, serverName: string, uploadId?: string, categories?: CloudUploadCategory[]) => ipcRenderer.invoke('cloud:upload-server', providerId, serverId, serverName, uploadId, categories) as Promise<{ success: boolean; id?: string; name?: string; error?: string }>,
  onCloudUploadProgress: (callback: (data: { id: string; percent: number; stage: "zip" | "upload" }) => void) => subscribe('cloud:upload-progress', callback),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  cloudUploadAccount: (providerId: string, account: { id: string; type: string; username: string; uuid?: string }) => ipcRenderer.invoke('cloud:upload-account', providerId, account) as Promise<{ success: boolean; id?: string; name?: string; error?: string }>,
  cloudDownloadAndImport: (providerId: string, remotePath: string, fileType: string, selectedCategories?: string[]) => ipcRenderer.invoke('cloud:download-and-import', providerId, remotePath, fileType, selectedCategories) as Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>,

  // ── Skins ──────────────────────────────────────────────
  skinsGetProfile: (accountId?: string) => ipcRenderer.invoke('skins:get-profile', accountId) as Promise<McProfile | null>,
  skinsDeleteSkin: (accountId?: string) => ipcRenderer.invoke('skins:delete-skin', accountId) as Promise<boolean>,
  skinsSetCape: (capeId: string | null, accountId?: string) => ipcRenderer.invoke('skins:set-cape', { capeId, accountId }) as Promise<boolean>,
  skinsListLibrary: (accountId: string) => ipcRenderer.invoke('skins:list-library', accountId) as Promise<LibrarySkin[]>,
  skinsSaveToLibrary: (filePath: string, name: string, variant: "classic" | "slim", accountId: string, capeId?: string | null) => ipcRenderer.invoke('skins:save-to-library', { filePath, name, variant, accountId, capeId }) as Promise<LibrarySkin | null>,
  skinsDeleteFromLibrary: (id: string) => ipcRenderer.invoke('skins:delete-from-library', id) as Promise<boolean>,
  skinsUpdateVariant: (id: string, variant: "classic" | "slim", capeId?: string | null, name?: string) => ipcRenderer.invoke('skins:update-variant', { id, variant, capeId, name }) as Promise<boolean>,
  skinsApplyLibrarySkin: (skinId: string, accountId: string) => ipcRenderer.invoke('skins:apply-library-skin', { skinId, accountId }) as Promise<boolean>,

  // ── Laby (каталог скинов) ──────────────────────────────
  labyCatalog: (page: number, size?: number, order?: LabyOrder, tags?: string[] | null, query?: string | null) =>
    ipcRenderer.invoke('laby:catalog', { page, size, order, tags, query }) as Promise<LabyCatalogPage>,
  labyTags: (locale?: string) => ipcRenderer.invoke('laby:tags', locale) as Promise<LabyTag[]>,
  labySimilar: (hash: string, tags: string[], slim: boolean) =>
    ipcRenderer.invoke('laby:similar', { hash, tags, slim }) as Promise<LabySkin[]>,
  labyPlayer: (username: string) => ipcRenderer.invoke('laby:player', username) as Promise<LabyPlayer | null>,
  labySaveToLibrary: (hash: string, accountId: string, name?: string, slim?: boolean) =>
    ipcRenderer.invoke('laby:save-to-library', { hash, accountId, name, slim }) as Promise<LabyImportResult>,
  labyApply: (hash: string, accountId: string, name?: string, slim?: boolean) =>
    ipcRenderer.invoke('laby:apply', { hash, accountId, name, slim }) as Promise<LabyImportResult>,

  readLocalFile: (filePath: string) => ipcRenderer.invoke('read-local-file', filePath) as Promise<string | null>,

  // ── Quick Play ──────────────────────────────────────────
  quickPlayList: (buildName?: string, gameDir?: string) => ipcRenderer.invoke('quickplay:list', buildName, gameDir) as Promise<QuickPlayEntry[]>,
  quickPlayClear: (buildName?: string, gameDir?: string) => ipcRenderer.invoke('quickplay:clear', buildName, gameDir) as Promise<void>,
  quickPlayRemove: (buildName: string | undefined, gameDir: string | undefined, entry: QuickPlayEntry) => ipcRenderer.invoke('quickplay:remove', buildName, gameDir, entry) as Promise<void>,

  // ── MC Server Management ───────────────────────────────
  mcServerList: invoke<McServerInfo[]>('mc-server:list'),
  mcServerGet: (id: string) => ipcRenderer.invoke('mc-server:get', id) as Promise<McServerInfo | null>,
  mcServerCreate: (data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string }) => ipcRenderer.invoke('mc-server:create', data) as Promise<McServerInfo>,
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
  mcServerMetricsSubscribe: (id: string) => ipcRenderer.invoke('mc-server:metrics-subscribe', id) as Promise<void>,
  mcServerMetricsUnsubscribe: (id: string) => ipcRenderer.invoke('mc-server:metrics-unsubscribe', id) as Promise<void>,
  onMcServerMetrics: (callback: (data: { id: string; metrics: McServerMetrics }) => void) => subscribe<{ id: string; metrics: McServerMetrics }>('mc-server:metrics', callback),
  mcServerLogs: (id: string) => ipcRenderer.invoke('mc-server:logs', id) as Promise<string[]>,
  mcServerInstallState: (id: string) => ipcRenderer.invoke('mc-server:install-state', id) as Promise<{ installing: boolean; progress: { phase: string; percent?: number; bytesTotal?: number; bytesDownloaded?: number; message: string } | null }>,
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
  onUpdateStatus: (callback: (status: { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }) => void) => subscribe('update:status', callback),
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => subscribe('update:progress', callback),
})
