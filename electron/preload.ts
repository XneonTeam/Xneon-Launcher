import { contextBridge, ipcRenderer } from 'electron'

type VersionEntry = {
  id: string
  type: 'release' | 'snapshot' | 'old_alpha' | 'old_beta'
  url?: string
  releaseTime?: string
}

type AuthSession = {
  uuid: string
  username: string
  accessToken: string
  profileId: string
  profileName?: string
}

type MinecraftVersionInfo = {
  version: string
  stable: boolean
  type: string
}

type MinecraftProgress = {
  type?: string
  installationPhase?: string
  task?: number
  total?: number
  current?: number
  fileName?: string
  downloaded?: number
  downloadedBytes?: number
  percent?: number
  currentFile?: number
  totalFiles?: number
  breakdown?: {
    classes: { current: number; total: number }
    assets: { current: number; total: number }
    natives: { current: number; total: number }
  }
  name?: string
}

type ElyByPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

type XnSkinsPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

type MicrosoftPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

type MinecraftNewsEntry = {
  id: string
  title: string
  tag?: string
  category?: string
  date: string
  text?: string
  readMoreLink?: string
  playPageImage?: { url?: string }
  newsPageImage?: { url?: string }
  newsType?: string[]
}

type DbAccount = {
  id: string
  type: 'elyby' | 'xnskins' | 'microsoft' | 'offline'
  username: string
  isActive: boolean
  uuid?: string
  accessToken?: string
  refreshToken?: string
  clientId?: string
  skinUrl?: string
}

type DbBuildMod = {
  id: string
  slug: string
  name: string
  description: string
  icon_url?: string
  version: string
  source?: "local" | "modrinth" | "curseforge"
  projectId?: string
  modId?: number
  author?: string
  enabled?: boolean
}

type DbBuild = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon: string
  coverImage?: string
  mods: DbBuildMod[]
  resourcepacks?: DbBuildMod[]
  shaders?: DbBuildMod[]
  createdAt: string
  source: 'local' | 'modrinth' | 'curseforge'
  projectSlug?: string
  intentPath?: string
  installedMods?: Record<string, string>
}

// ── Unified Mod Types (from xnlc/mods) ────────────────────
type ModContentType = "mod" | "modpack" | "resourcepack" | "shader"
type ModSort = "relevance" | "downloads" | "popular" | "followers" | "updated" | "published"
type ModLoaderFilter = "vanilla" | "fabric" | "quilt" | "neoforge"

interface ModSearchResult {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  source: "modrinth" | "curseforge"
  author?: string
  projectId?: string
  modId?: number
  primaryFileId?: number
  primaryFileName?: string
  fileSize?: number
  dateCreated?: string
  dateModified?: string
}

interface ModSearchResponse {
  results: ModSearchResult[]
  totalCount: number
}

interface ModDependency {
  projectId: string
  versionId?: string | null
  fileName?: string | null
  dependencyType: "required" | "optional" | "incompatible" | "embedded"
  name?: string
  slug?: string
  iconUrl?: string
}

interface ModVersion {
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

interface ModDetails {
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
  source: "modrinth" | "curseforge"
  body?: string
  modId?: number
  projectId?: string
}

type HotmcServerSearchResult = {
  name: string
  pageUrl: string
  description: string
  ip: string
  version: string
  playersOnline: number
  playersMax: number
  rank?: string
  country?: string
  avatarUrl?: string
  bannerUrl?: string
  isOnline: boolean
}

type MinecraftLaunchParams = {
  version: string
  modLoader: 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'liteloader' | 'optifine' | 'neoforge'
  loaderVersion?: string
  account: { type: string; username: string; uuid?: string; accessToken?: string }
  memory: { min: string; max: string }
  javaPath?: string
  javaArgs?: string
  width?: number
  height?: number
  gameDirectory?: string
  authlibInjectorEnabled?: boolean
  retroauthInjectorEnabled?: boolean
  buildName?: string
}

type JavaProgress = {
  type: 'download' | 'extract'
  percent: number
  message: string
  downloaded?: number
  total?: number
}

type ImportableLauncherInstance = {
  id: string
  name: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon?: string
  path: string
  source: "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher"
  modCount?: number
  resourcepackCount?: number
  shaderCount?: number
}

interface CleanupFn {
  (): void
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

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  loginElyBy: () => ipcRenderer.invoke('auth:elyby-login') as Promise<ElyByPayload>,
  loginXnSkins: () => ipcRenderer.invoke('auth:xnskins-login') as Promise<XnSkinsPayload>,
  loginMicrosoft: () => ipcRenderer.invoke('auth:microsoft-login') as Promise<MicrosoftPayload>,
  fetchMinecraftNews: () => ipcRenderer.invoke('fetch:minecraft-news') as Promise<MinecraftNewsEntry[]>,
  loadAccounts: () => ipcRenderer.invoke('db:load-accounts') as Promise<DbAccount[]>,
  saveAccount: (account: DbAccount) => ipcRenderer.invoke('db:save-account', account) as Promise<void>,
  removeAccount: (id: string) => ipcRenderer.invoke('db:remove-account', id) as Promise<void>,
  loadBuilds: () => ipcRenderer.invoke('db:load-builds') as Promise<DbBuild[]>,
  saveBuilds: (builds: DbBuild[]) => ipcRenderer.invoke('db:save-builds', builds) as Promise<void>,
  dbIsFallbackStorage: () => ipcRenderer.invoke('db:is-fallback-storage') as Promise<{ isFallback: boolean }>,
  scanBuildIntentContent: (buildName: string) => ipcRenderer.invoke('build:scan-intent-content', buildName) as Promise<{ mods: DbBuildMod[]; resourcepacks: DbBuildMod[]; shaders: DbBuildMod[]; installedMods: Record<string, string> }>,
  discoverImportableInstances: () => ipcRenderer.invoke('launcher:discover-importable-instances') as Promise<ImportableLauncherInstance[]>,
  importGdLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-gdlauncher-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  importLauncherInstances: (ids: string[]) => ipcRenderer.invoke('launcher:import-instances', ids) as Promise<{ success: boolean; imported: number; error?: string }>,
  // ── Unified Mods API (via xnlc/mods) ────────────────────
  modsModrinthSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, category?: string) => ipcRenderer.invoke('mods:modrinth-search', query, contentType, gameVersion, modLoader, sortBy, page, category) as Promise<ModSearchResponse>,
  modsModrinthDetails: (slug: string) => ipcRenderer.invoke('mods:modrinth-details', slug) as Promise<ModDetails | null>,
  modsModrinthVersions: (slug: string) => ipcRenderer.invoke('mods:modrinth-versions', slug) as Promise<ModVersion[]>,
  modsModrinthCategories: (contentType?: ModContentType) => ipcRenderer.invoke('mods:modrinth-categories', contentType) as Promise<Array<{ slug: string; name: string }>>,
  modsCurseforgeSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, category?: string) => ipcRenderer.invoke('mods:curseforge-search', query, contentType, gameVersion, modLoader, sortBy, page, category) as Promise<ModSearchResponse>,
  modsCurseforgeDetails: (modId: number) => ipcRenderer.invoke('mods:curseforge-details', modId) as Promise<ModDetails | null>,
  modsCurseforgeDownloadUrl: (fileId: number, modId: number) => ipcRenderer.invoke('mods:curseforge-download-url', fileId, modId) as Promise<string | null>,
  modsCurseforgeCategories: (contentType?: ModContentType) => ipcRenderer.invoke('mods:curseforge-categories', contentType) as Promise<Array<{ id: number; slug: string; name: string }>>,
  modsCurseforgeFeatured: (gameVersion?: string) => ipcRenderer.invoke('mods:curseforge-featured', gameVersion) as Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }>,
  modsResolveDependencies: (version: ModVersion, source: "modrinth" | "curseforge") => ipcRenderer.invoke('mods:resolve-dependencies', version, source) as Promise<ModDependency[]>,
  getMinecraftVersions: () => ipcRenderer.invoke('minecraft:get-versions') as Promise<MinecraftVersionInfo[]>,
  getLatestRelease: () => ipcRenderer.invoke('minecraft:get-latest-release') as Promise<string | null>,
  getLatestSnapshot: () => ipcRenderer.invoke('minecraft:get-latest-snapshot') as Promise<string | null>,
  getFabricGameVersions: () => ipcRenderer.invoke('minecraft:get-fabric-game-versions') as Promise<{ version: string; stable: boolean }[]>,
  getFabricVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-fabric-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getFabricSupported: () => ipcRenderer.invoke('minecraft:get-fabric-supported') as Promise<string[]>,
  getLiteLoaderVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-liteloader-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getLiteLoaderRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-liteloader-recommended', mcVersion) as Promise<string | null>,
  getLiteLoaderSupported: () => ipcRenderer.invoke('minecraft:get-liteloader-supported') as Promise<string[]>,
  getQuiltGameVersions: () => ipcRenderer.invoke('minecraft:get-quilt-game-versions') as Promise<{ version: string; stable: boolean }[]>,
  getQuiltVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-quilt-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getQuiltSupported: () => ipcRenderer.invoke('minecraft:get-quilt-supported') as Promise<string[]>,
  getOptifineVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-optifine-versions', mcVersion) as Promise<{ filename: string; isPreview: boolean }[]>,
  getOptifineRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-optifine-recommended', mcVersion) as Promise<string | null>,
  getOptifineSupported: () => ipcRenderer.invoke('minecraft:get-optifine-supported') as Promise<string[]>,
  getNeoForgeVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-neoforge-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getNeoForgeRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-neoforge-recommended', mcVersion) as Promise<string | null>,
  getNeoForgeSupported: () => ipcRenderer.invoke('minecraft:get-neoforge-supported') as Promise<string[]>,
  getForgeVersions: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-forge-versions', mcVersion) as Promise<{ version: string; stable: boolean }[]>,
  getForgeRecommended: (mcVersion: string) => ipcRenderer.invoke('minecraft:get-forge-recommended', mcVersion) as Promise<string | null>,
  getForgeSupported: () => ipcRenderer.invoke('minecraft:get-forge-supported') as Promise<string[]>,
  getCustomVersions: () => ipcRenderer.invoke('minecraft:get-custom-versions') as Promise<string[]>,
  setOfflineAuth: (username: string) => ipcRenderer.invoke('minecraft:set-offline-auth', username) as Promise<AuthSession | null>,
  getGameDir: () => ipcRenderer.invoke('minecraft:get-game-dir') as Promise<string>,
  getAuth: () => ipcRenderer.invoke('minecraft:get-auth') as Promise<AuthSession | null>,
  launchMinecraft: (params: MinecraftLaunchParams) => ipcRenderer.invoke('minecraft:launch', params) as Promise<{ success: boolean; error?: string }>,
  stopMinecraft: () => ipcRenderer.invoke('minecraft:stop') as Promise<void>,
  isMinecraftRunning: () => ipcRenderer.invoke('minecraft:is-running') as Promise<boolean>,
  onMinecraftProgress: (callback: (progress: MinecraftProgress) => void) => subscribe('minecraft:progress', callback),
  onMinecraftJavaProgress: (callback: (progress: JavaProgress) => void) => subscribe('minecraft:java-progress', callback),
  onMinecraftDebug: (callback: (message: string) => void) => subscribe('minecraft:debug', callback),
  onMinecraftData: (callback: (message: string) => void) => subscribe('minecraft:data', callback),
  onMinecraftDownloadStatus: (callback: (progress: MinecraftProgress) => void) => subscribe('minecraft:download-progress', callback),
  onMinecraftClose: (callback: (code: number) => void) => subscribeVoid('minecraft:close', callback),
  onAuthProgress: (callback: (msg: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => callback(msg)
    ipcRenderer.on('auth:progress', handler)
    return () => ipcRenderer.removeListener('auth:progress', handler)
  },
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key) as Promise<string | undefined>,
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value) as Promise<void>,
  writeServersDat: (servers: Array<{ name: string; ip: string }>) => ipcRenderer.invoke('servers:write-dat', servers) as Promise<{ success: boolean; error?: string }>,
  checkServerStatus: (ip: string) => ipcRenderer.invoke('servers:check-status', ip) as Promise<{ success: boolean; result: unknown }>,
  checkServerStatuses: (ips: string[]) => ipcRenderer.invoke('servers:check-statuses', ips) as Promise<{ success: boolean; results: Array<{ ip: string; result: unknown; error?: string }> }>,
  searchHotmcServers: (query: string, limit?: number, maxPages?: number, exact?: boolean) => ipcRenderer.invoke('servers:hotmc-search', query, limit, maxPages, exact) as Promise<{ success: boolean; results: HotmcServerSearchResult[]; error?: string }>,
  getBuildIntentPath: (buildId: string) => ipcRenderer.invoke('build:get-intent-path', buildId) as Promise<string>,
  saveModToIntent: (buildId: string, url: string, fileName: string) => ipcRenderer.invoke('build:save-mod-to-intent', buildId, url, fileName) as Promise<string | null>,
  saveLocalModToIntent: (buildId: string, localFilePath: string) => ipcRenderer.invoke('build:save-local-mod-to-intent', buildId, localFilePath) as Promise<string | null>,
  saveContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('build:save-content-to-intent', buildId, contentType, url, fileName) as Promise<string | null>,
  saveLocalContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => ipcRenderer.invoke('build:save-local-content-to-intent', buildId, contentType, localFilePath) as Promise<string | null>,
  deleteContentFromIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => ipcRenderer.invoke('build:delete-content-from-intent', buildId, contentType, fileName) as Promise<{ success: boolean; error?: string }>,
  setBuildIntentPath: (buildId: string, intentPath: string) => ipcRenderer.invoke('build:set-intent-path', buildId, intentPath) as Promise<void>,
  deleteBuildIntent: (buildName: string) => ipcRenderer.invoke('build:delete-intent', buildName) as Promise<{ success: boolean; error?: string }>,
  installContentFile: (contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => ipcRenderer.invoke('content:install-remote', contentType, url, fileName) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string) => ipcRenderer.invoke('build:import-modrinth', buildName, projectSlug, versionId) as Promise<{ success: boolean; error?: string; cancelled?: boolean; version?: string; modLoader?: string; loaderVersion?: string; mods?: { id: string; slug: string; name: string; description: string; version: string }[]; resourcepacks?: { id: string; slug: string; name: string; description: string; version: string }[]; shaders?: { id: string; slug: string; name: string; description: string; version: string }[]; installedMods?: Record<string, string> }>,
  importCurseforgeModpack: (buildName: string, modId: number, fileId: number) => ipcRenderer.invoke('build:import-curseforge', buildName, modId, fileId) as Promise<{ success: boolean; error?: string; cancelled?: boolean; version?: string; modLoader?: string; loaderVersion?: string; mods?: { id: string; slug: string; name: string; description: string; version: string }[]; resourcepacks?: { id: string; slug: string; name: string; description: string; version: string }[]; shaders?: { id: string; slug: string; name: string; description: string; version: string }[]; installedMods?: Record<string, string> }>,
  openAndImportModpack: () => ipcRenderer.invoke('build:open-and-import') as Promise<{ success: boolean; error?: string; cancelled?: boolean; name?: string; description?: string; icon?: string; version?: string; modLoader?: string; loaderVersion?: string; source?: 'modrinth' | 'curseforge'; intentPath?: string; mods?: { id: string; slug: string; name: string; description: string; version: string }[]; resourcepacks?: { id: string; slug: string; name: string; description: string; version: string }[]; shaders?: { id: string; slug: string; name: string; description: string; version: string }[]; installedMods?: Record<string, string> }>,
  cancelImportModpack: () => ipcRenderer.invoke('build:cancel-import') as Promise<{ success: boolean }>,
  onImportProgress: (callback: (progress: { current: number; total: number; message: string; itemName?: string }) => void) => subscribe('import:progress', callback),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url) as Promise<void>,
  openLauncherFolder: () => ipcRenderer.invoke('shell:open-launcher-folder') as Promise<void>,
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:open-path', dirPath) as Promise<void>,
  shareToMclogs: (content: string) => ipcRenderer.invoke('logs:share-to-mclogs', content) as Promise<{ success: boolean; url?: string; error?: string }>,
  detectJavaInstallations: () => ipcRenderer.invoke('java:detect') as Promise<{ path: string; version: string; label: string }[]>,
  pickJavaFile: () => ipcRenderer.invoke('java:pick-file') as Promise<string | null>,
  uploadBuildToCloud: (buildName: string, cloudToken: string, category?: string) => ipcRenderer.invoke('build:upload-to-cloud', buildName, cloudToken, category) as Promise<{ success: boolean; error?: string }>,
  cloudLogin: (username: string, password: string) => ipcRenderer.invoke('cloud:login', username, password) as Promise<{ success: boolean; token?: string; error?: string }>,
  cloudRegister: (username: string, password: string, email?: string) => ipcRenderer.invoke('cloud:register', username, password, email) as Promise<{ success: boolean; error?: string }>,
  cloudGetUser: (token: string) => ipcRenderer.invoke('cloud:get-user', token) as Promise<{ success: boolean; user?: { id: string; username: string; email: string }; error?: string }>,
  cloudGetStorageInfo: (token: string) => ipcRenderer.invoke('cloud:get-storage-info', token) as Promise<{ used_bytes: number; limit_bytes: number; used_gb: number; limit_gb: number; formatted_used: string; formatted_limit: string } | null>,
  cloudGetFiles: (token: string, category?: string) => ipcRenderer.invoke('cloud:get-files', token, category) as Promise<{ success: boolean; files?: { id: string; name: string; size: number; type: string; category?: string; downloadUrl?: string; icon?: string; uploadedAt?: string; originalName?: string; _id?: string }[]; error?: string }>,
  cloudDeleteFile: (token: string, fileId: string) => ipcRenderer.invoke('cloud:delete-file', token, fileId) as Promise<{ success: boolean; error?: string }>,
  cloudDownloadFile: (token: string, fileId: string, fileName: string) => ipcRenderer.invoke('cloud:download-file', token, fileId, fileName) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  cloudGetCategories: (token: string) => ipcRenderer.invoke('cloud:get-categories', token) as Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }>,
  cloudUploadFile: (filePath: string, token: string, category: string) => ipcRenderer.invoke('cloud:upload-file', filePath, token, category) as Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>,
  uploadAccountToCloud: (token: string) => ipcRenderer.invoke('cloud:select-and-upload-account', token) as Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>,
})
