// ============================================================
// @xnlc/types — Entry Point
// Single source of truth for all shared type definitions
// ============================================================

// Domain types
export type { AgentToolCall, AgentWireMessage, AgentToolSpec, AgentTurnRequest, AgentTurnResult, AgentAttachment, AgentTimelineItem, AgentChatSummary, AgentChat, AgentBuildFileRequest } from "./agent-types.js"
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
  LauncherNewsEntry,
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
  ImportProgressFile,
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

// Authlib-Injector (Yggdrasil) — контракты третьего типа аккаунта.
// Реализация (resolve сервера, Yggdrasil-клиент, javaagent) — в main.
export type {
  AuthlibInjectorMetadata,
  AuthlibInjectorServer,
  AuthlibInjectorServerSummary,
  AuthlibInjectorAccountData,
  AuthlibInjectorLoginResult,
  AuthlibInjectorErrorPayload,
  AuthlibInjectorErrorOutcome,
  AuthlibProbeOutcome,
  AuthlibAddServerOutcome,
  AuthlibLoginOutcome,
  AuthlibLoginPhase,
  AuthlibLoginProgress,
  AuthlibSessionStatus,
  AuthlibSessionOutcome,
  AuthlibRemoveServerResult,
  YggdrasilGameProfile,
  YggdrasilTextures,
  YggdrasilProfileWithTextures,
  YggdrasilAuthenticationResponse,
} from "./authlib-types.js"

// Laby (каталог скинов) — только контракты, которые пересекают границу
// main ↔ renderer. Реализация (запросы, маппинг, кэш, фильтры) — в `@xnlc/skins`.
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
  BuildLoaderRequirementIssue,
  BuildLoaderRequirementReport,
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
  WorkerAuthlibInjectorPayload,
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
  ServerStatusResult,
} from "./server-types.js"

export type { AiProtocol, AiModelConfig, AiConfig, AiModelDiscovery } from "./agent-types.js"
export type { AgentHardware } from "./agent-types.js"

export type { Theme, ThemeColorKey, ThemeGlow, ThemeFont, ThemeBackground, ThemeAppearance } from "./theme-types.js"
export type { LocalThemeFile, LocalThemeSnapshot, LocalThemeImport } from "./theme-types.js"
