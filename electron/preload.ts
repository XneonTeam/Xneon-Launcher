import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthPayload,
  AuthSession,
  MinecraftVersionInfo,
  MinecraftProgress,
  MinecraftNewsEntry,
  DbAccount,
  DbBuild,
  DbBuildMod,
  WorldInfo,
  DatapackInfo,
  ScreenshotInfo,
  MinecraftLaunchParams,
  JavaProgress,
  ImportableLauncherInstance,

  JavaDetectResult,
  BuildIntentScanResult,
  ModpackImportResult,
  ImportProgress,
  CloudUser,
  CloudFile,
  CloudStorageInfo,
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  ModSearchResult,
  CleanupFn,
  P2PRole,
  P2PRoom,
  P2PRoomMember,
  P2PLogEntry,
  P2PConnState,
  P2PLanServer,
  P2PAuthResult,
  P2PRoomOpResult,
  P2PChatMessage,
} from '@xnlc/types' with { 'resolution-mode': 'import' }

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
  isMaximized: invoke<boolean>('window:is-maximized'),

  // ── Auth ───────────────────────────────────────────────
  loginElyBy: invoke<AuthPayload>('auth:elyby-login'),
  loginXnSkins: invoke<AuthPayload>('auth:xnskins-login'),
  loginMicrosoft: invoke<AuthPayload>('auth:microsoft-login'),
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

  // ── Build / Intent ─────────────────────────────────────
  scanBuildIntentContent: (buildName: string) => ipcRenderer.invoke('build:scan-intent-content', buildName) as Promise<BuildIntentScanResult>,
  discoverImportableInstances: invoke<ImportableLauncherInstance[]>('launcher:discover-importable-instances'),
  importGdLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-gdlauncher-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  importLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,

  // ── Unified Mods API (via xnlc/mods) ──────────────────
  modsModrinthSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, category?: string) =>
    ipcRenderer.invoke('mods:modrinth-search', query, contentType, gameVersion, modLoader, sortBy, page, category) as Promise<ModSearchResponse>,
  modsModrinthDetails: (slug: string) => ipcRenderer.invoke('mods:modrinth-details', slug) as Promise<ModDetails | null>,
  modsModrinthVersions: (slug: string) => ipcRenderer.invoke('mods:modrinth-versions', slug) as Promise<ModVersion[]>,
  modsModrinthCategories: (contentType?: ModContentType) => ipcRenderer.invoke('mods:modrinth-categories', contentType) as Promise<Array<{ slug: string; name: string }>>,
  modsCurseforgeSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, category?: string) =>
    ipcRenderer.invoke('mods:curseforge-search', query, contentType, gameVersion, modLoader, sortBy, page, category) as Promise<ModSearchResponse>,
  modsCurseforgeDetails: (modId: number) => ipcRenderer.invoke('mods:curseforge-details', modId) as Promise<ModDetails | null>,
  modsCurseforgeDownloadUrl: (fileId: number, modId: number) => ipcRenderer.invoke('mods:curseforge-download-url', fileId, modId) as Promise<string | null>,
  modsCurseforgeCategories: (contentType?: ModContentType) => ipcRenderer.invoke('mods:curseforge-categories', contentType) as Promise<Array<{ id: number; slug: string; name: string }>>,
  modsCurseforgeFeatured: (gameVersion?: string) => ipcRenderer.invoke('mods:curseforge-featured', gameVersion) as Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }>,
  modsResolveDependencies: (version: ModVersion, source: "modrinth" | "curseforge") => ipcRenderer.invoke('mods:resolve-dependencies', version, source) as Promise<ModDependency[]>,

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

  // ── Build Intent Operations ────────────────────────────
  getBuildIntentPath: (buildId: string) => ipcRenderer.invoke('build:get-intent-path', buildId) as Promise<string>,
  saveModToIntent: (buildId: string, url: string, fileName: string) => ipcRenderer.invoke('build:save-mod-to-intent', buildId, url, fileName) as Promise<string | null>,
  saveLocalModToIntent: (buildId: string, localFilePath: string) => ipcRenderer.invoke('build:save-local-mod-to-intent', buildId, localFilePath) as Promise<string | null>,
  saveContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('build:save-content-to-intent', buildId, contentType, url, fileName) as Promise<string | null>,
  saveLocalContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => ipcRenderer.invoke('build:save-local-content-to-intent', buildId, contentType, localFilePath) as Promise<string | null>,
  deleteContentFromIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => ipcRenderer.invoke('build:delete-content-from-intent', buildId, contentType, fileName) as Promise<{ success: boolean; error?: string }>,
  setBuildIntentPath: (buildId: string, intentPath: string) => ipcRenderer.invoke('build:set-intent-path', buildId, intentPath) as Promise<void>,
  deleteBuildIntent: (buildName: string) => ipcRenderer.invoke('build:delete-intent', buildName) as Promise<{ success: boolean; error?: string }>,
  installContentFile: (contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('content:install-remote', contentType, url, fileName) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string) => ipcRenderer.invoke('build:import-modrinth', buildName, projectSlug, versionId) as Promise<ModpackImportResult>,
  importCurseforgeModpack: (buildName: string, modId: number, fileId: number) => ipcRenderer.invoke('build:import-curseforge', buildName, modId, fileId) as Promise<ModpackImportResult>,
  openAndImportModpack: invoke<ModpackImportResult & { name?: string; description?: string; icon?: string; source?: 'modrinth' | 'curseforge'; intentPath?: string }>('build:open-and-import'),
  cancelImportModpack: invoke<{ success: boolean }>('build:cancel-import'),
  onImportProgress: (callback: (progress: ImportProgress) => void) => subscribe('import:progress', callback),

  // ── Shell ──────────────────────────────────────────────
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  openLauncherFolder: invoke<void>('shell:open-launcher-folder'),
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:open-path', dirPath) as Promise<void>,

  // ── Logs ───────────────────────────────────────────────
  shareToMclogs: (content: string) => ipcRenderer.invoke('logs:share-to-mclogs', content) as Promise<{ success: boolean; url?: string; error?: string }>,

  // ── Java ───────────────────────────────────────────────
  detectJavaInstallations: invoke<JavaDetectResult[]>('java:detect'),
  pickJavaFile: invoke<string | null>('java:pick-file'),

  // ── Worlds ─────────────────────────────────────────────
  listWorlds: (buildName: string) => ipcRenderer.invoke('worlds:list', buildName) as Promise<WorldInfo[]>,
  renameWorld: (buildName: string, folder: string, newName: string) => ipcRenderer.invoke('worlds:rename', buildName, folder, newName) as Promise<{ success: boolean; error?: string }>,
  deleteWorld: (buildName: string, folder: string) => ipcRenderer.invoke('worlds:delete', buildName, folder) as Promise<{ success: boolean; error?: string }>,
  setWorldIcon: (buildName: string, folder: string, dataUrl: string) => ipcRenderer.invoke('worlds:set-icon', buildName, folder, dataUrl) as Promise<{ success: boolean; error?: string }>,
  listWorldDatapacks: (buildName: string, folder: string) => ipcRenderer.invoke('worlds:list-datapacks', buildName, folder) as Promise<DatapackInfo[]>,
  installDatapackRemote: (buildName: string, folder: string, url: string, fileName: string) => ipcRenderer.invoke('worlds:install-datapack-remote', buildName, folder, url, fileName) as Promise<{ success: boolean; path?: string; error?: string }>,
  installDatapackLocal: (buildName: string, folder: string, localFilePath: string) => ipcRenderer.invoke('worlds:install-datapack-local', buildName, folder, localFilePath) as Promise<{ success: boolean; path?: string; error?: string }>,
  deleteWorldDatapack: (buildName: string, folder: string, fileName: string) => ipcRenderer.invoke('worlds:delete-datapack', buildName, folder, fileName) as Promise<{ success: boolean; error?: string }>,

  // ── Screenshots ───────────────────────────────────────
  listScreenshots: (buildName: string) => ipcRenderer.invoke('screenshots:list', buildName) as Promise<ScreenshotInfo[]>,
  getScreenshot: (buildName: string, fileName: string) => ipcRenderer.invoke('screenshots:get', buildName, fileName) as Promise<string | null>,
  deleteScreenshot: (buildName: string, fileName: string) => ipcRenderer.invoke('screenshots:delete', buildName, fileName) as Promise<{ success: boolean; error?: string }>,

  // ── Build Cloud Upload ─────────────────────────────────
  uploadBuildToCloud: (buildName: string, cloudToken: string, category?: string) => ipcRenderer.invoke('build:upload-to-cloud', buildName, cloudToken, category) as Promise<{ success: boolean; error?: string }>,

  // ── Cloud ──────────────────────────────────────────────
  cloudLogin: (username: string, password: string) => ipcRenderer.invoke('cloud:login', username, password) as Promise<{ success: boolean; token?: string; error?: string }>,
  cloudRegister: (username: string, password: string, email?: string) => ipcRenderer.invoke('cloud:register', username, password, email) as Promise<{ success: boolean; error?: string }>,
  cloudGetUser: (token: string) => ipcRenderer.invoke('cloud:get-user', token) as Promise<{ success: boolean; user?: CloudUser; error?: string }>,
  cloudGetStorageInfo: (token: string) => ipcRenderer.invoke('cloud:get-storage-info', token) as Promise<CloudStorageInfo | null>,
  cloudGetFiles: (token: string, category?: string) => ipcRenderer.invoke('cloud:get-files', token, category) as Promise<{ success: boolean; files?: CloudFile[]; error?: string }>,
  cloudDeleteFile: (token: string, fileId: string) => ipcRenderer.invoke('cloud:delete-file', token, fileId) as Promise<{ success: boolean; error?: string }>,
  cloudDownloadFile: (token: string, fileId: string, fileName: string) => ipcRenderer.invoke('cloud:download-file', token, fileId, fileName) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  cloudDownloadAndImport: (token: string, fileId: string, fileName: string, fileType: string) => ipcRenderer.invoke('cloud:download-and-import', token, fileId, fileName, fileType) as Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>,
  cloudGetCategories: (token: string) => ipcRenderer.invoke('cloud:get-categories', token) as Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }>,
  cloudUploadFile: (filePath: string, token: string, category: string) => ipcRenderer.invoke('cloud:upload-file', filePath, token, category) as Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>,
  uploadAccountToCloud: (token: string, account: { id: string; type: string; username: string; uuid?: string }) => ipcRenderer.invoke('cloud:upload-account-data', token, account) as Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>,

  // ── P2P Multiplayer ────────────────────────────────────
  p2pRegister: (login: string, password: string) => ipcRenderer.invoke('p2p:register', login, password) as Promise<P2PAuthResult>,
  p2pLogin: (login: string, password: string) => ipcRenderer.invoke('p2p:login', login, password) as Promise<P2PAuthResult>,
  p2pGetMe: invoke<{ success: boolean; login?: string; userId?: string; error?: string }>('p2p:get-me'),
  p2pLogout: invoke<{ success: boolean }>('p2p:logout'),
  p2pListRooms: invoke<{ success: boolean; rooms?: P2PRoom[]; error?: string }>('p2p:list-rooms'),
  p2pCreateRoom: (name: string, password?: string) => ipcRenderer.invoke('p2p:create-room', name, password) as Promise<P2PRoomOpResult>,
  p2pJoinRoom: (name: string, password?: string) => ipcRenderer.invoke('p2p:join-room', name, password) as Promise<P2PRoomOpResult>,
  p2pListMembers: (groupId: string) => ipcRenderer.invoke('p2p:list-members', groupId) as Promise<{ success: boolean; members?: P2PRoomMember[]; error?: string }>,
  p2pDeleteRoom: (groupId: string) => ipcRenderer.invoke('p2p:delete-room', groupId) as Promise<{ success: boolean; error?: string }>,
  p2pTransferHost: (groupId: string, targetUserId: string) => ipcRenderer.invoke('p2p:transfer-host', groupId, targetUserId) as Promise<{ success: boolean; error?: string }>,
  p2pKickMember: (groupId: string, userId: string) => ipcRenderer.invoke('p2p:kick-member', groupId, userId) as Promise<{ success: boolean; error?: string }>,
  p2pLeaveRoom: (groupId: string) => ipcRenderer.invoke('p2p:leave-room', groupId) as Promise<{ success: boolean; error?: string }>,
  p2pStart: (role: P2PRole, groupId: string, groupName: string, playerName: string) => ipcRenderer.invoke('p2p:start', role, groupId, groupName, playerName) as Promise<{ success: boolean; error?: string }>,
  p2pStop: invoke<{ success: boolean }>('p2p:stop'),
  p2pSendChat: (message: string) => ipcRenderer.invoke('p2p:send-chat', message) as Promise<{ success: boolean; error?: string }>,
  p2pGetState: invoke<{ state: P2PConnState; role?: P2PRole; groupName?: string; playerName?: string; groupId?: string }>('p2p:get-state'),
  onP2PLog: (callback: (entry: P2PLogEntry) => void) => subscribe<P2PLogEntry>('p2p:log', callback),
  onP2PState: (callback: (state: P2PConnState) => void) => subscribe<P2PConnState>('p2p:state', callback),
  onP2PMembers: (callback: (members: P2PRoomMember[]) => void) => subscribe<P2PRoomMember[]>('p2p:members', callback),
  onP2PLan: (callback: (server: P2PLanServer) => void) => subscribe<P2PLanServer>('p2p:lan', callback),
  onP2PLanRemove: (callback: (data: { port: number }) => void) => subscribe<{ port: number }>('p2p:lan_remove', callback),
  onP2PChat: (callback: (message: P2PChatMessage) => void) => subscribe<P2PChatMessage>('p2p:chat', callback),
})
