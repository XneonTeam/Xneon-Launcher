// ============================================================
// @xnlc/types — Entry Point
// Single source of truth for all shared type definitions
// ============================================================

// Domain types
export type {
  DbAccount,
  DbBuild,
  DbBuildMod,
  WorldInfo,
  DatapackInfo,
  ScreenshotInfo,
  AuthPayload,
  ElyByPayload,
  XnSkinsPayload,
  MicrosoftPayload,
  AuthSession,
  MinecraftVersionInfo,
  VersionEntry,
  MinecraftNewsEntry,
  ImportableLauncherInstance,
  BuildExportCategory,
  JavaDetectResult,
  CleanupFn,
  CloudUser,
  CloudFile,
  CloudStorageInfo,
  BuildIntentScanResult,
  ModpackImportMod,
  ModpackImportResult,
  ImportProgress,
  ContentDownloadProgress,
  P2PRoom,
  P2PRoomMember,
  P2PLogLevel,
  P2PLogEntry,
  P2PConnState,
  P2PLanServer,
  P2PRole,
  P2PAuthResult,
  P2PRoomOpResult,
  P2PChatMessage,
  QuickPlayEntry,
  McProfile,
  MinecraftSkin,
  MinecraftCape,
  LibrarySkin,
} from "./domain-types.js"

// Mod types
export type {
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModSource,
  ModSearchResult,
  ModSearchResponse,
  ModDependency,
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
} from "./ipc-contracts.js"

// Launch types
export type {
  MinecraftLaunchParams,
  MinecraftProgress,
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
