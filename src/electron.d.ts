export {}

interface DbBuildMod {
  id: string
  slug: string
  name: string
  description: string
  icon_url?: string
  version: string
  source?: 'local' | 'modrinth' | 'curseforge'
  projectId?: string
  modId?: number
  author?: string
  enabled?: boolean
}

interface DbBuild {
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

interface DbAccount {
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

interface MinecraftNewsEntry {
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

interface ImportableLauncherInstance {
  id: string
  name: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon?: string
  path: string
  source: 'gdlauncher' | 'prism' | 'multimc' | 'polymc' | 'astralrinth' | 'xlauncher'
  modCount?: number
  resourcepackCount?: number
  shaderCount?: number
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

interface CleanupFn {
  (): void
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
  gameDir?: string
  authlibInjectorEnabled?: boolean
  retroauthInjectorEnabled?: boolean
  buildName?: string
}

type MinecraftVersionInfo = {
  version: string
  stable: boolean
  type: string
}

interface VersionEntry {
  id: string
  type: 'release' | 'snapshot' | 'old_alpha' | 'old_beta'
  url?: string
  releaseTime?: string
}

interface AuthSession {
  uuid: string
  username: string
  accessToken: string
  profileId: string
  profileName?: string
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
  name?: string
  breakdown?: {
    classes: { current: number; total: number }
    assets: { current: number; total: number }
    natives: { current: number; total: number }
  }
}

type JavaProgress = {
  type: 'download' | 'extract'
  percent: number
  message: string
  downloaded?: number
  total?: number
}

declare global {
  type ImportableLauncherInstance = {
    id: string
    name: string
    version: string
    modLoader: string
    loaderVersion?: string
    icon?: string
    path: string
    source: 'gdlauncher' | 'prism' | 'multimc' | 'polymc' | 'astralrinth' | 'xlauncher'
    modCount?: number
    resourcepackCount?: number
    shaderCount?: number
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

  interface Window {
    electronAPI?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      loginElyBy: () => Promise<{
        id: string
        username: string
        uuid: string
        accessToken: string
        refreshToken: string
      }>
      loginXnSkins: () => Promise<{
        id: string
        username: string
        uuid: string
        accessToken: string
        refreshToken: string
      }>
      loginMicrosoft: () => Promise<{
        id: string
        username: string
        uuid: string
        accessToken: string
        refreshToken: string
      }>
      fetchMinecraftNews: () => Promise<MinecraftNewsEntry[]>
      loadAccounts: () => Promise<DbAccount[]>
      saveAccount: (account: DbAccount) => Promise<void>
      removeAccount: (id: string) => Promise<void>
      loadBuilds: () => Promise<DbBuild[]>
      saveBuilds: (builds: DbBuild[]) => Promise<void>
      dbIsFallbackStorage: () => Promise<{ isFallback: boolean }>
      scanBuildIntentContent: (buildName: string) => Promise<{ mods: DbBuildMod[]; resourcepacks: DbBuildMod[]; shaders: DbBuildMod[]; installedMods: Record<string, string> }>
      discoverImportableInstances: () => Promise<ImportableLauncherInstance[]>
      importGdLauncherInstances: (ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>
      importLauncherInstances: (ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>
      onAuthProgress: (callback: (msg: string) => void) => () => void
      // ── Unified Mods API (via xnlc/mods) ──────────────────
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
      getSetting: (key: string) => Promise<string | undefined>
      setSetting: (key: string, value: string) => Promise<void>
      writeServersDat: (servers: Array<{ name: string; ip: string }>) => Promise<{ success: boolean; error?: string }>
      checkServerStatus: (ip: string) => Promise<{ success: boolean; result: unknown }>
      checkServerStatuses: (ips: string[]) => Promise<{ success: boolean; results: Array<{ ip: string; result: unknown; error?: string }> }>
      searchHotmcServers: (query: string, limit?: number, maxPages?: number, exact?: boolean) => Promise<{ success: boolean; results: HotmcServerSearchResult[]; error?: string }>
      getBuildIntentPath: (buildName: string) => Promise<string>
      saveModToIntent: (buildName: string, url: string, fileName: string) => Promise<string | null>
      saveLocalModToIntent: (buildName: string, localFilePath: string) => Promise<string | null>
      saveContentToIntent: (buildName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => Promise<string | null>
      saveLocalContentToIntent: (buildName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => Promise<string | null>
      deleteContentFromIntent: (buildName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => Promise<{ success: boolean; error?: string }>
      setBuildIntentPath: (buildName: string) => Promise<void>
      deleteBuildIntent: (buildName: string) => Promise<{ success: boolean; error?: string }>
      installContentFile: (contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
      importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string) => Promise<{ success: boolean; error?: string; cancelled?: boolean; version?: string; modLoader?: string; loaderVersion?: string; mods?: { id: string; slug: string; name: string; description: string; version: string }[]; resourcepacks?: { id: string; slug: string; name: string; description: string; version: string }[]; shaders?: { id: string; slug: string; name: string; description: string; version: string }[]; installedMods?: Record<string, string> }>
      importCurseforgeModpack: (buildName: string, modId: number, fileId: number) => Promise<{ success: boolean; error?: string; cancelled?: boolean; version?: string; modLoader?: string; loaderVersion?: string; mods?: { id: string; slug: string; name: string; description: string; version: string }[]; resourcepacks?: { id: string; slug: string; name: string; description: string; version: string }[]; shaders?: { id: string; slug: string; name: string; description: string; version: string }[]; installedMods?: Record<string, string> }>
      openAndImportModpack: () => Promise<{ success: boolean; error?: string; cancelled?: boolean; name?: string; description?: string; icon?: string; version?: string; modLoader?: string; loaderVersion?: string; source?: 'modrinth' | 'curseforge'; intentPath?: string; mods?: { id: string; slug: string; name: string; description: string; version: string }[]; resourcepacks?: { id: string; slug: string; name: string; description: string; version: string }[]; shaders?: { id: string; slug: string; name: string; description: string; version: string }[]; installedMods?: Record<string, string> }>
      cancelImportModpack: () => Promise<{ success: boolean }>
      onImportProgress: (callback: (progress: { current: number; total: number; message: string; itemName?: string }) => void) => CleanupFn
      openExternal: (url: string) => Promise<void>
      openLauncherFolder: () => Promise<void>
      openPath: (dirPath: string) => Promise<void>
      shareToMclogs: (content: string) => Promise<{ success: boolean; url?: string; error?: string }>
      detectJavaInstallations: () => Promise<{ path: string; version: string; label: string }[]>
      pickJavaFile: () => Promise<string | null>
      exportBuildArchive: (buildName: string) => Promise<{ success: boolean; archivePath?: string; fileName?: string; error?: string }>
      uploadBuildToCloud: (buildName: string, cloudToken: string, category?: string) => Promise<{ success: boolean; error?: string }>
      cloudLogin: (username: string, password: string) => Promise<{ success: boolean; token?: string; error?: string }>
      cloudRegister: (username: string, password: string, email?: string) => Promise<{ success: boolean; error?: string }>
      cloudGetUser: (token: string) => Promise<{ success: boolean; user?: { id: string; username: string; email: string }; error?: string }>
      cloudGetStorageInfo: (token: string) => Promise<{ used_bytes: number; limit_bytes: number; used_gb: number; limit_gb: number; formatted_used: string; formatted_limit: string } | null>
      cloudGetFiles: (token: string, category?: string) => Promise<{ success: boolean; files?: { id: string; name: string; size: number; type: string; category?: string; downloadUrl?: string; icon?: string; uploadedAt?: string; originalName?: string; _id?: string }[]; error?: string }>
      cloudDeleteFile: (token: string, fileId: string) => Promise<{ success: boolean; error?: string }>
      cloudDownloadFile: (token: string, fileId: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
      cloudGetCategories: (token: string) => Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }>
      cloudUploadFile: (filePath: string, token: string, category: string) => Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>
      uploadAccountToCloud: (token: string) => Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>
      // XNLC Methods
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
      getCustomVersions: () => Promise<string[]>
      setOfflineAuth: (username: string) => Promise<AuthSession | null>
      getGameDir: () => Promise<string>
      getAuth: () => Promise<AuthSession | null>
      onDownloadProgress: (callback: (progress: { fileName: string; downloaded: number; total: number; percent: number }) => void) => CleanupFn
    }
  }
}
