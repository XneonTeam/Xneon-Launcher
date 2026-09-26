// ============================================================
// @xnlc/types — Entry Point
// Single source of truth for all shared type definitions
// ============================================================

// Domain types
export type {
  DbAccount,
  DbBuild,
  DbBuildLight,
  DbBuildMod,
  WorldInfo,
  DatapackInfo,
  ScreenshotInfo,
  AuthPayload,
  ElyByPayload,
  XnSkinsPayload,
  MicrosoftPayload,
  AuthSession,
  DeviceCodeStart,
  DeviceCodePoll,
  MinecraftVersionInfo,
  VersionEntry,
  MinecraftNewsEntry,
  ImportableLauncherInstance,
  BuildExportCategory,
  CloudUploadCategory,
  JavaDetectResult,
  CleanupFn,
  CloudUser,
  CloudFile,
  CloudStorageInfo,
  BuildIntentScanResult,
  ModpackImportMod,
  ModpackImportResult,
  ModpackImportConflict,
  ImportProgress,
  ContentDownloadProgress,
  QuickPlayEntry,
  McProfile,
  MinecraftSkin,
  MinecraftCape,
  LibrarySkin,
  UpdateChannel,
  ContentUpdateInfo,
  BuildContentUpdates,
  GameSessionInfo,
  ServerSessionInfo,
  StatsOverview,
  StatsRange,
  BuildStorageEntry,
  ServerStorageEntry,
  JavaRuntimeEntry,
  StorageScanResult,
  StorageCleanTarget,
  StorageCleanResult,
} from "./domain-types.js"

// Laby (каталог скинов). Здесь не только типы, но и чистые помощники:
// адреса API, маппинг ответов и скоринг похожести нужны и main-процессу,
// и рендереру, поэтому живут в одном месте, а не дублируются.
export type {
  LabyApiError,
  LabyCatalogPage,
  LabyImportResult,
  LabyOrder,
  LabyPlayer,
  LabyPlayerSkin,
  LabySkin,
  LabyTag,
  LabyTagPreview,
} from "./laby.js"

export {
  LABY_API_BASE,
  LABY_DEFAULT_ORDER,
  LABY_MAX_PAGE_SIZE,
  LABY_ORDERS,
  LABY_PROFILE_TEXTURE_BASE,
  LABY_RENDER_BASE,
  LABY_SKIN_PAGE_BASE,
  LABY_TEXTURE_BASE,
  formatUseCount,
  isLabyHash,
  isLabyUuid,
  labyFeaturedUsersUrl,
  labyFilterSkins,
  labyHeadUrl,
  labyPagesOffset,
  labyPlayerPageUrl,
  labyPlayerSkinToSkin,
  labyProfileSkinUrl,
  labyRenderUrl,
  labySearchUrl,
  labySimilarSkins,
  labySimilarityScore,
  labySkinName,
  labySkinPageUrl,
  labyTagSkinsUrl,
  labyTagsUrl,
  labyTextureUrl,
  labyUniqueIdUrl,
  labyUserTexturesUrl,
  mapLabyFeaturedUser,
  mapLabyPlayerCapesCount,
  mapLabyPlayerSkins,
  mapLabySkin,
  mapLabyTag,
  mapLabyTagSkin,
  mapLabyUniqueId,
  parseLabyTags,
  sanitizeLabyUsername,
} from "./laby.js"

// Mod types
export type {
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModSource,
  ModEnvironment,
  ModSearchResult,
  ModSearchResponse,
  ModDependency,
  JarDeclaredDependency,
  JarDependencyInspection,
  ContentFileMetadata,
  ContentDropKind,
  ContentDropRejectReason,
  ContentDropEntry,
  ContentDropClassification,
  ModVersion,
  ModDetails,
  ModCategory,
  CurseForgeCategory,
  FTBVersionManifest,
} from "./mod-types.js"

// IPC contracts
export type {
  IpcInvokeMap,
  IpcEventMap,
  ElectronAPIExplicit,
  ElectronAPIExtra,
  ElectronAPI,
} from "./ipc-contracts.js"

// Launch types
export type {
  MinecraftLaunchParams,
  MinecraftProgress,
  MinecraftCloseInfo,
  JavaProgress,
  LaunchRequestOptions,
  ResolvedLaunchRequest,
} from "./launch-types.js"

// Worker types
export type {
  WorkerAccountPayload,
  WorkerLaunchPayload,
  WorkerMessage,
} from "./worker-types.js"

// MC Server types
export type {
  McServerInfo,
  McServerState,
  McServerMetrics,
  McPlayerEntry,
  McFsEntry,
  ResolvedPlugin,
  XnConnectState,
  XnConnectUsage,
  McServerDownloadProgress,
} from "./server-types.js"
