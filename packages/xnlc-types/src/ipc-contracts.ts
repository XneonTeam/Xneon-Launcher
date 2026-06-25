// ============================================================
// @xnlc/types — IPC Contracts
// Single source of truth for all IPC channel signatures
// ============================================================

import type {
  DbAccount,
  DbBuild,
  DbBuildMod,
  AuthPayload,
  AuthSession,
  MinecraftNewsEntry,
  MinecraftVersionInfo,
  ImportableLauncherInstance,
  HotmcServerSearchResult,
  JavaDetectResult,
  BuildIntentScanResult,
  ModpackImportResult,
  ImportProgress,
  CloudUser,
  CloudFile,
  CloudStorageInfo,
  CleanupFn,
  P2PRoom,
  P2PRoomMember,
  P2PLogEntry,
  P2PConnState,
  P2PLanServer,
  P2PRole,
  P2PAuthResult,
  P2PRoomOpResult,
  P2PChatMessage,
} from "./domain-types.js"

import type {
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  ModSearchResult,
} from "./mod-types.js"

import type {
  MinecraftLaunchParams,
  MinecraftProgress,
  JavaProgress,
} from "./launch-types.js"

// ── IPC Invoke Channel Map ──────────────────────────────────
// Maps channel name → { args: tuple of arguments, return: return type }

export interface IpcInvokeMap {
  // ── Window ──
  "window:is-maximized": { args: []; return: boolean }

  // ── Auth ──
  "auth:elyby-login": { args: []; return: AuthPayload }
  "auth:xnskins-login": { args: []; return: AuthPayload }
  "auth:microsoft-login": { args: []; return: AuthPayload }

  // ── Fetch ──
  "fetch:minecraft-news": { args: []; return: MinecraftNewsEntry[] }

  // ── Database ──
  "db:load-accounts": { args: []; return: DbAccount[] }
  "db:save-account": { args: [account: DbAccount]; return: void }
  "db:remove-account": { args: [id: string]; return: void }
  "db:load-builds": { args: []; return: DbBuild[] }
  "db:save-builds": { args: [builds: DbBuild[]]; return: void }
  "db:is-fallback-storage": { args: []; return: { isFallback: boolean } }

  // ── Build / Intent ──
  "build:scan-intent-content": { args: [buildName: string]; return: BuildIntentScanResult }
  "build:get-intent-path": { args: [buildId: string]; return: string }
  "build:save-mod-to-intent": { args: [buildId: string, url: string, fileName: string]; return: string | null }
  "build:save-local-mod-to-intent": { args: [buildId: string, localFilePath: string]; return: string | null }
  "build:save-content-to-intent": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string]; return: string | null }
  "build:save-local-content-to-intent": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string]; return: string | null }
  "build:delete-content-from-intent": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string]; return: { success: boolean; error?: string } }
  "build:set-intent-path": { args: [buildId: string, intentPath: string]; return: void }
  "build:delete-intent": { args: [buildName: string]; return: { success: boolean; error?: string } }
  "build:import-modrinth": { args: [buildName: string, projectSlug: string, versionId?: string]; return: ModpackImportResult }
  "build:import-curseforge": { args: [buildName: string, modId: number, fileId: number]; return: ModpackImportResult }
  "build:open-and-import": { args: []; return: ModpackImportResult & { name?: string; description?: string; icon?: string; source?: "modrinth" | "curseforge"; intentPath?: string } }
  "build:cancel-import": { args: []; return: { success: boolean } }
  "build:upload-to-cloud": { args: [buildName: string, cloudToken: string, category?: string]; return: { success: boolean; error?: string } }

  // ── Launcher Import ──
  "launcher:discover-importable-instances": { args: []; return: ImportableLauncherInstance[] }
  "launcher:import-gdlauncher-instances": { args: [ids: string[]]; return: { success: boolean; imported: number; error?: string } }
  "launcher:import-instances": { args: [ids: string[]]; return: { success: boolean; imported: number; error?: string } }

  // ── Mods (Modrinth) ──
  "mods:modrinth-search": { args: [query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, category?: string]; return: ModSearchResponse }
  "mods:modrinth-details": { args: [slug: string]; return: ModDetails | null }
  "mods:modrinth-versions": { args: [slug: string]; return: ModVersion[] }
  "mods:modrinth-categories": { args: [contentType?: ModContentType]; return: Array<{ slug: string; name: string }> }

  // ── Mods (CurseForge) ──
  "mods:curseforge-search": { args: [query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, category?: string]; return: ModSearchResponse }
  "mods:curseforge-details": { args: [modId: number]; return: ModDetails | null }
  "mods:curseforge-download-url": { args: [fileId: number, modId: number]; return: string | null }
  "mods:curseforge-categories": { args: [contentType?: ModContentType]; return: Array<{ id: number; slug: string; name: string }> }
  "mods:curseforge-featured": { args: [gameVersion?: string]; return: { popular: ModSearchResult[]; trending: ModSearchResult[] } }
  "mods:resolve-dependencies": { args: [version: ModVersion, source: "modrinth" | "curseforge"]; return: ModDependency[] }

  // ── Minecraft ──
  "minecraft:get-versions": { args: []; return: MinecraftVersionInfo[] }
  "minecraft:get-latest-release": { args: []; return: string | null }
  "minecraft:get-latest-snapshot": { args: []; return: string | null }
  "minecraft:get-fabric-game-versions": { args: []; return: { version: string; stable: boolean }[] }
  "minecraft:get-fabric-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-fabric-supported": { args: []; return: string[] }
  "minecraft:get-liteloader-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-liteloader-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-liteloader-supported": { args: []; return: string[] }
  "minecraft:get-quilt-game-versions": { args: []; return: { version: string; stable: boolean }[] }
  "minecraft:get-quilt-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-quilt-supported": { args: []; return: string[] }
  "minecraft:get-optifine-versions": { args: [mcVersion: string]; return: { filename: string; isPreview: boolean }[] }
  "minecraft:get-optifine-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-optifine-supported": { args: []; return: string[] }
  "minecraft:get-neoforge-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-neoforge-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-neoforge-supported": { args: []; return: string[] }
  "minecraft:get-forge-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-forge-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-forge-supported": { args: []; return: string[] }
  "minecraft:get-custom-versions": { args: []; return: string[] }
  "minecraft:set-offline-auth": { args: [username: string]; return: AuthSession | null }
  "minecraft:get-game-dir": { args: []; return: string }
  "minecraft:get-auth": { args: []; return: AuthSession | null }
  "minecraft:launch": { args: [params: MinecraftLaunchParams]; return: { success: boolean; error?: string } }
  "minecraft:stop": { args: []; return: void }
  "minecraft:is-running": { args: []; return: boolean }

  // ── Settings ──
  "settings:get": { args: [key: string]; return: string | undefined }
  "settings:set": { args: [key: string, value: string]; return: void }

  // ── Servers ──
  "servers:write-dat": { args: [servers: Array<{ name: string; ip: string }>]; return: { success: boolean; error?: string } }
  "servers:check-status": { args: [ip: string]; return: { success: boolean; result: unknown } }
  "servers:check-statuses": { args: [ips: string[]]; return: { success: boolean; results: Array<{ ip: string; result: unknown; error?: string }> } }
  "servers:hotmc-search": { args: [query: string, limit?: number, maxPages?: number, exact?: boolean]; return: { success: boolean; results: HotmcServerSearchResult[]; error?: string } }

  // ── Content ──
  "content:install-remote": { args: [contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string]; return: { success: boolean; filePath?: string; error?: string } }

  // ── Shell ──
  "shell:open-external": { args: [url: string]; return: void }
  "shell:open-launcher-folder": { args: []; return: void }
  "shell:open-path": { args: [dirPath: string]; return: void }

  // ── Logs ──
  "logs:share-to-mclogs": { args: [content: string]; return: { success: boolean; url?: string; error?: string } }

  // ── Java ──
  "java:detect": { args: []; return: JavaDetectResult[] }
  "java:pick-file": { args: []; return: string | null }

  // ── Cloud ──
  "cloud:login": { args: [username: string, password: string]; return: { success: boolean; token?: string; error?: string } }
  "cloud:register": { args: [username: string, password: string, email?: string]; return: { success: boolean; error?: string } }
  "cloud:get-user": { args: [token: string]; return: { success: boolean; user?: CloudUser; error?: string } }
  "cloud:get-storage-info": { args: [token: string]; return: CloudStorageInfo | null }
  "cloud:get-files": { args: [token: string, category?: string]; return: { success: boolean; files?: CloudFile[]; error?: string } }
  "cloud:delete-file": { args: [token: string, fileId: string]; return: { success: boolean; error?: string } }
  "cloud:download-file": { args: [token: string, fileId: string, fileName: string]; return: { success: boolean; filePath?: string; error?: string } }
  "cloud:download-and-import": { args: [token: string, fileId: string, fileName: string, fileType: string]; return: { success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } } }
  "cloud:get-categories": { args: [token: string]; return: { success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string } }
  "cloud:upload-file": { args: [filePath: string, token: string, category: string]; return: { success: boolean; id?: string; name?: string; size?: number; error?: string } }
  "cloud:upload-account-data": { args: [token: string, account: { id: string; type: string; username: string; uuid?: string }]; return: { success: boolean; id?: string; name?: string; size?: number; error?: string } }

  // ── P2P Multiplayer ──
  "p2p:register": { args: [login: string, password: string]; return: P2PAuthResult }
  "p2p:login": { args: [login: string, password: string]; return: P2PAuthResult }
  "p2p:get-me": { args: []; return: { success: boolean; login?: string; userId?: string; error?: string } }
  "p2p:logout": { args: []; return: { success: boolean } }
  "p2p:list-rooms": { args: []; return: { success: boolean; rooms?: P2PRoom[]; error?: string } }
  "p2p:create-room": { args: [name: string, password?: string]; return: P2PRoomOpResult }
  "p2p:join-room": { args: [name: string, password?: string]; return: P2PRoomOpResult }
  "p2p:list-members": { args: [groupId: string]; return: { success: boolean; members?: P2PRoomMember[]; error?: string } }
  "p2p:delete-room": { args: [groupId: string]; return: { success: boolean; error?: string } }
  "p2p:transfer-host": { args: [groupId: string, targetUserId: string]; return: { success: boolean; error?: string } }
  "p2p:kick-member": { args: [groupId: string, userId: string]; return: { success: boolean; error?: string } }
  "p2p:start": { args: [role: P2PRole, groupId: string, groupName: string, playerName: string]; return: { success: boolean; error?: string } }
  "p2p:stop": { args: []; return: { success: boolean } }
  "p2p:send-chat": { args: [message: string]; return: { success: boolean; error?: string } }
  "p2p:get-state": { args: []; return: { state: P2PConnState; role?: P2PRole; groupName?: string; playerName?: string; groupId?: string } }
}

// ── IPC Event Channel Map ───────────────────────────────────
// Maps channel name → payload type (for subscribe/on listeners)

export interface IpcEventMap {
  "minecraft:progress": MinecraftProgress
  "minecraft:java-progress": JavaProgress
  "minecraft:debug": string
  "minecraft:data": string
  "minecraft:download-progress": MinecraftProgress
  "minecraft:close": number
  "auth:progress": string
  "import:progress": ImportProgress
  "p2p:log": P2PLogEntry
  "p2p:state": P2PConnState
  "p2p:members": P2PRoomMember[]
  "p2p:lan": P2PLanServer
  "p2p:lan_remove": { port: number }
  "p2p:chat": P2PChatMessage
}

// ── Explicit ElectronAPI ────────────────────────────────────
// The IpcInvokeMap above serves as the canonical channel registry.
// The ElectronAPIExplicit below is derived from it and used by preload.ts and electron.d.ts.

export interface ElectronAPIExplicit {
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  loginElyBy: () => Promise<AuthPayload>
  loginXnSkins: () => Promise<AuthPayload>
  loginMicrosoft: () => Promise<AuthPayload>
  fetchMinecraftNews: () => Promise<MinecraftNewsEntry[]>
  loadAccounts: () => Promise<DbAccount[]>
  saveAccount: (account: DbAccount) => Promise<void>
  removeAccount: (id: string) => Promise<void>
  loadBuilds: () => Promise<DbBuild[]>
  saveBuilds: (builds: DbBuild[]) => Promise<void>
  dbIsFallbackStorage: () => Promise<{ isFallback: boolean }>
  scanBuildIntentContent: (buildName: string) => Promise<BuildIntentScanResult>
  discoverImportableInstances: () => Promise<ImportableLauncherInstance[]>
  importGdLauncherInstances: (ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>
  importLauncherInstances: (ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>
  modsModrinthSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, category?: string) => Promise<ModSearchResponse>
  modsModrinthDetails: (slug: string) => Promise<ModDetails | null>
  modsModrinthVersions: (slug: string) => Promise<ModVersion[]>
  modsModrinthCategories: (contentType?: ModContentType) => Promise<Array<{ slug: string; name: string }>>
  modsCurseforgeSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, category?: string) => Promise<ModSearchResponse>
  modsCurseforgeDetails: (modId: number) => Promise<ModDetails | null>
  modsCurseforgeDownloadUrl: (fileId: number, modId: number) => Promise<string | null>
  modsCurseforgeCategories: (contentType?: ModContentType) => Promise<Array<{ id: number; slug: string; name: string }>>
  modsCurseforgeFeatured: (gameVersion?: string) => Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }>
  modsResolveDependencies: (version: ModVersion, source: "modrinth" | "curseforge") => Promise<ModDependency[]>
  getMinecraftVersions: () => Promise<MinecraftVersionInfo[]>
  getLatestRelease: () => Promise<string | null>
  getLatestSnapshot: () => Promise<string | null>
  getFabricGameVersions: () => Promise<{ version: string; stable: boolean }[]>
  getFabricVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getFabricSupported: () => Promise<string[]>
  getLiteLoaderVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getLiteLoaderRecommended: (mcVersion: string) => Promise<string | null>
  getLiteLoaderSupported: () => Promise<string[]>
  getQuiltGameVersions: () => Promise<{ version: string; stable: boolean }[]>
  getQuiltVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getQuiltSupported: () => Promise<string[]>
  getOptifineVersions: (mcVersion: string) => Promise<{ filename: string; isPreview: boolean }[]>
  getOptifineRecommended: (mcVersion: string) => Promise<string | null>
  getOptifineSupported: () => Promise<string[]>
  getNeoForgeVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getNeoForgeRecommended: (mcVersion: string) => Promise<string | null>
  getNeoForgeSupported: () => Promise<string[]>
  getForgeVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getForgeRecommended: (mcVersion: string) => Promise<string | null>
  getForgeSupported: () => Promise<string[]>
  getCustomVersions: () => Promise<string[]>
  setOfflineAuth: (username: string) => Promise<AuthSession | null>
  getGameDir: () => Promise<string>
  getAuth: () => Promise<AuthSession | null>
  launchMinecraft: (params: MinecraftLaunchParams) => Promise<{ success: boolean; error?: string }>
  stopMinecraft: () => Promise<void>
  isMinecraftRunning: () => Promise<boolean>
  onMinecraftProgress: (callback: (progress: MinecraftProgress) => void) => CleanupFn
  onMinecraftJavaProgress: (callback: (progress: JavaProgress) => void) => CleanupFn
  onMinecraftDebug: (callback: (message: string) => void) => CleanupFn
  onMinecraftData: (callback: (message: string) => void) => CleanupFn
  onMinecraftDownloadStatus: (callback: (progress: MinecraftProgress) => void) => CleanupFn
  onMinecraftClose: (callback: (code: number) => void) => CleanupFn
  onAuthProgress: (callback: (msg: string) => void) => CleanupFn
  getSetting: (key: string) => Promise<string | undefined>
  setSetting: (key: string, value: string) => Promise<void>
  writeServersDat: (servers: Array<{ name: string; ip: string }>) => Promise<{ success: boolean; error?: string }>
  checkServerStatus: (ip: string) => Promise<{ success: boolean; result: unknown }>
  checkServerStatuses: (ips: string[]) => Promise<{ success: boolean; results: Array<{ ip: string; result: unknown; error?: string }> }>
  searchHotmcServers: (query: string, limit?: number, maxPages?: number, exact?: boolean) => Promise<{ success: boolean; results: HotmcServerSearchResult[]; error?: string }>
  getBuildIntentPath: (buildId: string) => Promise<string>
  saveModToIntent: (buildId: string, url: string, fileName: string) => Promise<string | null>
  saveLocalModToIntent: (buildId: string, localFilePath: string) => Promise<string | null>
  saveContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => Promise<string | null>
  saveLocalContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => Promise<string | null>
  deleteContentFromIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => Promise<{ success: boolean; error?: string }>
  setBuildIntentPath: (buildId: string, intentPath: string) => Promise<void>
  deleteBuildIntent: (buildName: string) => Promise<{ success: boolean; error?: string }>
  installContentFile: (contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string) => Promise<ModpackImportResult>
  importCurseforgeModpack: (buildName: string, modId: number, fileId: number) => Promise<ModpackImportResult>
  openAndImportModpack: () => Promise<ModpackImportResult & { name?: string; description?: string; icon?: string; source?: "modrinth" | "curseforge"; intentPath?: string }>
  cancelImportModpack: () => Promise<{ success: boolean }>
  onImportProgress: (callback: (progress: ImportProgress) => void) => CleanupFn
  openExternal: (url: string) => Promise<void>
  openLauncherFolder: () => Promise<void>
  openPath: (dirPath: string) => Promise<void>
  shareToMclogs: (content: string) => Promise<{ success: boolean; url?: string; error?: string }>
  detectJavaInstallations: () => Promise<JavaDetectResult[]>
  pickJavaFile: () => Promise<string | null>
  uploadBuildToCloud: (buildName: string, cloudToken: string, category?: string) => Promise<{ success: boolean; error?: string }>
  cloudLogin: (username: string, password: string) => Promise<{ success: boolean; token?: string; error?: string }>
  cloudRegister: (username: string, password: string, email?: string) => Promise<{ success: boolean; error?: string }>
  cloudGetUser: (token: string) => Promise<{ success: boolean; user?: CloudUser; error?: string }>
  cloudGetStorageInfo: (token: string) => Promise<CloudStorageInfo | null>
  cloudGetFiles: (token: string, category?: string) => Promise<{ success: boolean; files?: CloudFile[]; error?: string }>
  cloudDeleteFile: (token: string, fileId: string) => Promise<{ success: boolean; error?: string }>
  cloudDownloadFile: (token: string, fileId: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  cloudDownloadAndImport: (token: string, fileId: string, fileName: string, fileType: string) => Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>
  cloudGetCategories: (token: string) => Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }>
  cloudUploadFile: (filePath: string, token: string, category: string) => Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>
  uploadAccountToCloud: (token: string, account: { id: string; type: string; username: string; uuid?: string }) => Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>
  p2pRegister: (login: string, password: string) => Promise<P2PAuthResult>
  p2pLogin: (login: string, password: string) => Promise<P2PAuthResult>
  p2pGetMe: () => Promise<{ success: boolean; login?: string; userId?: string; error?: string }>
  p2pLogout: () => Promise<{ success: boolean }>
  p2pListRooms: () => Promise<{ success: boolean; rooms?: P2PRoom[]; error?: string }>
  p2pCreateRoom: (name: string, password?: string) => Promise<P2PRoomOpResult>
  p2pJoinRoom: (name: string, password?: string) => Promise<P2PRoomOpResult>
  p2pListMembers: (groupId: string) => Promise<{ success: boolean; members?: P2PRoomMember[]; error?: string }>
  p2pDeleteRoom: (groupId: string) => Promise<{ success: boolean; error?: string }>
  p2pTransferHost: (groupId: string, targetUserId: string) => Promise<{ success: boolean; error?: string }>
  p2pKickMember: (groupId: string, userId: string) => Promise<{ success: boolean; error?: string }>
  p2pLeaveRoom: (groupId: string) => Promise<{ success: boolean; error?: string }>
  p2pStart: (role: P2PRole, groupId: string, groupName: string, playerName: string) => Promise<{ success: boolean; error?: string }>
  p2pStop: () => Promise<{ success: boolean }>
  p2pSendChat: (message: string) => Promise<{ success: boolean; error?: string }>
  p2pGetState: () => Promise<{ state: P2PConnState; role?: P2PRole; groupName?: string; playerName?: string; groupId?: string }>
  onP2PLog: (callback: (entry: P2PLogEntry) => void) => CleanupFn
  onP2PState: (callback: (state: P2PConnState) => void) => CleanupFn
  onP2PMembers: (callback: (members: P2PRoomMember[]) => void) => CleanupFn
  onP2PLan: (callback: (server: P2PLanServer) => void) => CleanupFn
  onP2PChat: (callback: (message: P2PChatMessage) => void) => CleanupFn
}
