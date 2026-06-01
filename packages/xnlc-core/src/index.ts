// ============================================================
// XNLC — Library Entry Point
// Author: MAINER4IK
// ============================================================

export { Xnlc } from "./xnlc.js";

// Types
export type {
  OSType,
  ArchType,
  OSInfo,
  VersionType,
  MojangVersionEntry,
  MojangVersionManifest,
  VersionJson,
  VersionJsonLibrary,
  VersionJsonDownload,
  VersionJsonDownloads,
  VersionJsonAssetIndex,
  VersionJsonJavaVersion,
  VersionJsonRule,
  VersionJsonArguments,
  VersionJsonLogging,
  ResolvedLibrary,
  AssetIndex,
  AssetIndexEntry,
  AuthMode,
  AuthSession,
  OfflineAuth,
  LoaderType,
  LoaderVersion,
  LoaderInstallResult,
  LaunchConfig,
  LaunchResult,
  DownloadProgress,
  DownloadProgressCallback,
  XnlcOptions,
  VersionSelection,
  FabricGameVersion,
  FabricLoaderVersion,
  FabricProfileJson,
  QuiltGameVersion,
  QuiltLoaderVersion,
  QuiltLoaderMetadata,
} from "./types/index.js";

// Core
export { MetaClient } from "./core/meta-client.js";
export { VersionResolver } from "./core/version-resolver.js";
export { Downloader } from "./core/downloader.js";
export { LibrariesManager } from "./core/libraries-manager.js";
export { AssetsManager } from "./core/assets-manager.js";
export { NativesExtractor } from "./core/natives-extractor.js";
export { LaunchBuilder } from "./core/launch-builder.js";
export { JavaRunner } from "./core/java-runner.js";
export { JavaManager } from "./core/java-manager.js";

// Loaders
export { NeoForgeHandler } from "./loaders/neoforge-handler.js";
export { FabricHandler } from "./loaders/fabric-handler.js";
export { FabricLegacyHandler } from "./loaders/fabric-legacy-handler.js";
export { LiteLoaderHandler } from "./loaders/liteloader-handler.js";
export { QuiltHandler } from "./loaders/quilt-handler.js";
export { OptifineHandler } from "./loaders/optifine-handler.js";
export type { OptifineVersion } from "./loaders/optifine-handler.js";
export { LoaderResolver } from "./loaders/loader-resolver.js";

// Auth
export { AuthManager } from "./auth/auth-manager.js";
export {
  collectSupportedVersions,
  createLaunchAuth,
  ensureAuthlibInjector,
  ensureRetroAuthInjector,
  getDefaultMinecraftRoot,
  getDefaultMinecraftRootFromEnv,
  resolveLaunchRequest,
} from "./launch-utils.js";
export type {
  AuthorizationAccount,
  LaunchRequestOptions,
  MinecraftRootOptions,
  MinecraftRootEnvOptions,
  ResolvedLaunchRequest,
  XnlcHandlerLike,
} from "./launch-utils.js";

// Utils
export {
  getOSInfo,
  getNativesClassifier,
  getNativesClassifierOld,
  getOSRuleName,
  getArchRule,
  libraryNameToPath,
  libraryNameToParts,
  sha1Hash,
  sha1HashSync,
  generateOfflineUUID,
  ensureDirSync,
  getGameDirStructure,
  getVersionDir,
  getLibraryDir,
  getNativesDir,
  getAssetsDir,
  getAssetIndexDir,
  getAssetObjectsDir,
  getLogsDir,
  getRuntimeDir,
  getModsDir,
  getConfigDir,
  getResourcepacksDir,
  getSavesDir,
  getScreenshotsDir,
  getShaderpacksDir,
  getCrashReportsDir,
  parseMavenCoordinate,
  mavenCoordinateToPath,
  checkRules,
  formatBytes,
  isLegacyVersion,
  isLegacyFabric,
} from "./utils/index.js";

// Handler - Simple API
export { XnlcHandler, createDefaultHandler } from "./handler.js";
export type { DefaultHandlerOptions, HandlerOptions, LaunchOptions, VersionInfo, ModLoaderInfo } from "./handler.js";
