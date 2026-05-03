export {}

interface DbBuildMod {
  id: string
  slug: string
  name: string
  description: string
  icon_url?: string
  version: string
}

interface DbBuild {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  icon: string
  coverImage?: string
  mods: DbBuildMod[]
  createdAt: string
  source: 'local' | 'modrinth' | 'curseforge'
  projectSlug?: string
  intentPath?: string
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

// ── Unified Mod Types (from xnlc/mods) ────────────────────
type ModContentType = "mod" | "modpack" | "resourcepack" | "shader"
type ModSort = "downloads" | "popular" | "updated" | "published"

interface ModSearchResult {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string
  downloadCount: number
  categories: string[]
  source: "modrinth" | "curseforge"
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

interface CleanupFn {
  (): void
}

type MinecraftLaunchParams = {
  version: string
  modLoader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine'
  loaderVersion?: string
  account: { type: string; username: string; uuid?: string; accessToken?: string }
  memory: { min: string; max: string }
  javaPath?: string
  width?: number
  height?: number
  gameDirectory?: string
  authlibInjectorEnabled?: boolean
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
      onAuthProgress: (callback: (msg: string) => void) => () => void
      // ── Unified Mods API (via xnlc/mods) ──────────────────
      modsModrinthSearch: (query: string, contentType?: ModContentType, gameVersion?: string, sortBy?: ModSort, page?: number) => Promise<ModSearchResponse>
      modsModrinthDetails: (slug: string) => Promise<ModDetails | null>
      modsModrinthVersions: (slug: string) => Promise<ModVersion[]>
      modsCurseforgeSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number) => Promise<ModSearchResponse>
      modsCurseforgeDetails: (modId: number) => Promise<ModDetails | null>
      modsCurseforgeDownloadUrl: (fileId: number, modId: number) => Promise<string | null>
      modsCurseforgeCategories: () => Promise<Array<{ id: number; slug: string; name: string }>>
      modsCurseforgeFeatured: (gameVersion?: string) => Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }>
      getMinecraftVersions: () => Promise<MinecraftVersionInfo[]>
      getLatestRelease: () => Promise<string | null>
      getLatestSnapshot: () => Promise<string | null>
      getForgeVersions: (mcVersion: string) => Promise<string[]>
      getForgeRecommended: (mcVersion: string) => Promise<string | null>
      getForgeSupported: () => Promise<string[]>
      getNeoForgeVersions: (mcVersion: string) => Promise<string[]>
      getNeoForgeRecommended: (mcVersion: string) => Promise<string | null>
      getNeoForgeSupported: () => Promise<string[]>
      getFabricGameVersions: () => Promise<{ version: string; stable: boolean }[]>
      getFabricVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
      getFabricSupported: () => Promise<string[]>
      getQuiltGameVersions: () => Promise<{ version: string; stable: boolean }[]>
      getQuiltVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
      getQuiltSupported: () => Promise<string[]>
      getOptifineVersions: (mcVersion: string) => Promise<{ filename: string; isPreview: boolean }[]>
      getOptifineRecommended: (mcVersion: string) => Promise<string | null>
      getOptifineSupported: () => Promise<string[]>
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
      getBuildIntentPath: (buildName: string) => Promise<string>
      saveModToIntent: (buildName: string, url: string, fileName: string) => Promise<string | null>
      saveLocalModToIntent: (buildName: string, localFilePath: string) => Promise<string | null>
      setBuildIntentPath: (buildName: string) => Promise<void>
      importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string) => Promise<{ success: boolean; error?: string; version?: string; modLoader?: string }>
      importCurseforgeModpack: (buildName: string, modId: number, fileId: number) => Promise<{ success: boolean; error?: string; version?: string; modLoader?: string }>
      openAndImportModpack: () => Promise<{ success: boolean; error?: string; name?: string; description?: string; icon?: string; version?: string; modLoader?: string; source?: 'modrinth' | 'curseforge'; intentPath?: string }>
      onImportProgress: (callback: (progress: { current: number; total: number; message: string }) => void) => CleanupFn
      openExternal: (url: string) => Promise<void>
      openLauncherFolder: () => Promise<void>
      shareToMclogs: (content: string) => Promise<{ success: boolean; url?: string; error?: string }>
      detectJavaInstallations: () => Promise<{ path: string; version: string; label: string }[]>
      pickJavaFile: () => Promise<string | null>
      exportBuildArchive: (buildName: string) => Promise<{ success: boolean; archivePath?: string; fileName?: string; error?: string }>
      uploadBuildToCloud: (buildName: string, cloudToken: string, category?: string) => Promise<{ success: boolean; error?: string }>
      cloudLogin: (username: string, password: string) => Promise<{ success: boolean; token?: string; error?: string }>
      cloudRegister: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
      cloudGetUser: (token: string) => Promise<{ success: boolean; user?: { id: string; username: string; email: string }; error?: string }>
      cloudGetStorageInfo: (token: string) => Promise<{ used_bytes: number; limit_bytes: number; used_gb: number; limit_gb: number; formatted_used: string; formatted_limit: string } | null>
      cloudGetFiles: (token: string, category?: string) => Promise<{ success: boolean; files?: any[]; error?: string }>
      cloudDeleteFile: (token: string, fileId: string) => Promise<{ success: boolean; error?: string }>
      cloudDownloadFile: (token: string, fileId: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
      cloudGetCategories: (token: string) => Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }>
      cloudUploadFile: (filePath: string, token: string, category: string) => Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }>
      // XNLC Methods
      getMinecraftVersions: () => Promise<MinecraftVersionInfo[]>
      getLatestRelease: () => Promise<string | null>
      getLatestSnapshot: () => Promise<string | null>
      getForgeVersions: (mcVersion: string) => Promise<string[]>
      getForgeRecommended: (mcVersion: string) => Promise<string | null>
      getForgeSupported: () => Promise<string[]>
      getNeoForgeVersions: (mcVersion: string) => Promise<string[]>
      getNeoForgeRecommended: (mcVersion: string) => Promise<string | null>
      getNeoForgeSupported: () => Promise<string[]>
      getFabricGameVersions: () => Promise<{ version: string; stable: boolean }[]>
      getFabricVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
      getFabricSupported: () => Promise<string[]>
      getQuiltGameVersions: () => Promise<{ version: string; stable: boolean }[]>
      getQuiltVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
      getQuiltSupported: () => Promise<string[]>
      getOptifineVersions: (mcVersion: string) => Promise<{ filename: string; isPreview: boolean }[]>
      getOptifineRecommended: (mcVersion: string) => Promise<string | null>
      getOptifineSupported: () => Promise<string[]>
      getCustomVersions: () => Promise<string[]>
      setOfflineAuth: (username: string) => Promise<AuthSession | null>
      getGameDir: () => Promise<string>
      getAuth: () => Promise<AuthSession | null>
      onDownloadProgress: (callback: (progress: { fileName: string; downloaded: number; total: number; percent: number }) => void) => CleanupFn
    }
  }
}
