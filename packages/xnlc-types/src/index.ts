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
  DeviceCodeStart,
  DeviceCodePoll,
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
  ModEnvironment,
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
  ElectronAPIExtra,
  ElectronAPI,
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
