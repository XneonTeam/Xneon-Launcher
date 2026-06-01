export type OSType = "windows" | "linux" | "osx";
export type ArchType = "x86" | "x64" | "arm64";
export type VersionType = "release" | "snapshot" | "old_alpha" | "old_beta" | "modified";
export type AuthMode = "offline" | "microsoft";

export interface LaunchAuth extends AuthSession {
  mode: AuthMode;
}

export type LoaderType =
  | "vanilla"
  | "forge"
  | "neoforge"
  | "fabric"
  | "fabric-legacy"
  | "liteloader"
  | "quilt"
  | "optifine"
  | "custom";

export type InstallationPhase =
  | "downloading-vanilla"
  | "downloading-installer"
  | "downloading-libraries"
  | "downloading-client"
  | "installing-loader"
  | "installing";

export interface OSInfo {
  os: OSType;
  arch: ArchType;
}

export interface MojangVersionEntry {
  id: string;
  type: VersionType | string;
  url: string;
  time?: string;
  releaseTime?: string;
  sha1?: string;
  complianceLevel?: number;
}

export interface MojangVersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MojangVersionEntry[];
}

export interface VersionJsonDownload {
  sha1?: string;
  size?: number;
  url: string;
  path?: string;
}

export interface VersionJsonDownloads {
  client?: VersionJsonDownload;
  server?: VersionJsonDownload;
  client_mappings?: VersionJsonDownload;
  server_mappings?: VersionJsonDownload;
  artifact?: VersionJsonDownload;
  classifiers?: Record<string, VersionJsonDownload>;
  [key: string]: VersionJsonDownload | Record<string, VersionJsonDownload> | undefined;
}

export interface VersionJsonAssetIndex {
  id: string;
  sha1?: string;
  size?: number;
  totalSize?: number;
  url: string;
}

export interface VersionJsonJavaVersion {
  component?: string;
  majorVersion?: number;
}

export interface VersionJsonRule {
  action: "allow" | "disallow";
  os?: {
    name?: OSType | string;
    version?: string;
    arch?: string;
  };
  features?: Record<string, boolean>;
}

export interface VersionJsonArgumentValue {
  rules?: VersionJsonRule[];
  value: string | string[];
}

export interface VersionJsonArguments {
  game?: Array<string | VersionJsonArgumentValue>;
  jvm?: Array<string | VersionJsonArgumentValue>;
}

export interface VersionJsonLogging {
  client?: {
    argument?: string;
    file?: VersionJsonDownload & { id?: string };
    type?: string;
  };
  [key: string]: unknown;
}

export interface VersionJsonLibrary {
  name: string;
  downloads?: {
    artifact?: VersionJsonDownload;
    classifiers?: Record<string, VersionJsonDownload>;
  };
  natives?: Record<string, string>;
  rules?: VersionJsonRule[];
  extract?: {
    exclude?: string[];
  };
  url?: string;
  sha1?: string;
  size?: number;
  checksum?: string;
  serverreq?: boolean;
  clientreq?: boolean;
  downloadOnly?: boolean;
  includeInClasspath?: boolean;
  [key: string]: unknown;
}

export interface VersionJson {
  id: string;
  time?: string;
  releaseTime?: string;
  type: VersionType | string;
  mainClass: string;
  inheritsFrom?: string;
  jar?: string;
  family?: string;
  minecraftArguments?: string;
  arguments?: VersionJsonArguments;
  libraries: VersionJsonLibrary[];
  jarMods?: VersionJsonLibrary[];
  mods?: VersionJsonLibrary[];
  mavenFiles?: VersionJsonLibrary[];
  agents?: VersionJsonLibrary[];
  traits?: string[];
  downloads?: VersionJsonDownloads;
  assetIndex?: VersionJsonAssetIndex;
  assets?: string;
  javaVersion?: VersionJsonJavaVersion;
  logging?: VersionJsonLogging;
  minimumLauncherVersion?: number;
  tlauncherVersion?: number;
  complianceLevel?: number;
  releaseType?: string;
  xnlcBaseVersion?: string;
  [key: string]: unknown;
}

export interface ResolvedLibrary {
  name: string;
  path: string;
  url?: string;
  sha1?: string;
  size?: number;
  natives?: Record<string, string>;
  isNative: boolean;
  classifier?: string;
  includeInClasspath?: boolean;
  downloadOnly?: boolean;
}

export interface AssetIndexEntry {
  hash: string;
  size: number;
  compressedHash?: string;
  compressedSize?: number;
}

export interface AssetIndex {
  objects: Record<string, AssetIndexEntry>;
  virtual?: boolean;
  map_to_resources?: boolean;
}

export interface AuthSession {
  username: string;
  uuid: string;
  accessToken: string;
  profileId?: string;
  profileName?: string;
  userProperties?: string;
  meta?: Record<string, unknown>;
}

export interface OfflineAuth extends AuthSession {
  mode: "offline";
}

export type LoaderVersion = string;

export interface LoaderInstallResult {
  versionId: string;
  versionJson?: VersionJson;
  componentData?: ComponentData;
}

export interface PrismMetaVersionSummary {
  version: string;
  releaseTime: string;
  requires: Array<{ uid: string; equals?: string; suggests?: string }>;
  sha256: string;
  recommended?: boolean;
}

export interface PrismMetaIndex {
  formatVersion: number;
  name: string;
  uid: string;
  versions: PrismMetaVersionSummary[];
}

export interface PrismMetaLibrary {
  name: string;
  downloads?: {
    artifact?: VersionJsonDownload;
    classifiers?: Record<string, VersionJsonDownload>;
  };
  rules?: VersionJsonRule[];
  natives?: Record<string, string>;
  extract?: {
    exclude?: string[];
  };
  [key: string]: unknown;
}

export interface ComponentRequire {
  uid: string;
  equals?: string;
  suggests?: string;
}

export interface ComponentData {
  uid: string;
  version: string;
  name?: string;
  requires?: ComponentRequire[];
  mainClass?: string;
  minecraftArguments?: string;
  arguments?: VersionJsonArguments;
  libraries?: VersionJsonLibrary[];
  jarMods?: VersionJsonLibrary[];
  agents?: VersionJsonLibrary[];
  mods?: VersionJsonLibrary[];
  mavenFiles?: VersionJsonLibrary[];
  traits?: string[];
  tweakers?: string[];
  jvmArgs?: string[];
  gameArgs?: string[];
  plusLibraries?: VersionJsonLibrary[];
  order?: number;
  compatibleJavaMajors?: number[];
}

export interface PrismMetaVersion {
  uid: string;
  version: string;
  name: string;
  releaseTime: string;
  requires: Array<{ uid: string; equals?: string }>;
  libraries?: PrismMetaLibrary[];
  jarMods?: PrismMetaLibrary[];
  agents?: PrismMetaLibrary[];
  mods?: PrismMetaLibrary[];
  mavenFiles?: PrismMetaLibrary[];
  mainClass?: string;
  minecraftArguments?: string;
  arguments?: {
    game?: string[];
    jvm?: string[];
  };
  "+traits"?: string[];
  "+tweakers"?: string[];
  "+jvmArgs"?: string[];
  "+gameArgs"?: string[];
  "+libraries"?: PrismMetaLibrary[];
  order?: number;
}

export interface LaunchConfig {
  javaPath?: string;
  jvmArgs?: string[];
  gameArgs?: string[];
  memoryMin?: string;
  memoryMax?: string;
  width?: number;
  height?: number;
}
export interface LaunchResult {
  pid: number;
  process: import("child_process").ChildProcess;
  wait: () => Promise<number>;
}
export interface DownloadProgress {
  type?: string;
  file?: string;
  fileName?: string;
  currentFile?: number;
  totalFiles?: number;
  downloaded?: number;
  downloadedBytes?: number;
  total?: number;
  percent?: number;
  installationPhase?: InstallationPhase;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export interface XnlcOptions {
  gameDir: string;
  os?: OSInfo;
  javaPath?: string;
  launcherName?: string;
  launcherVersion?: string;
  defaultJvmArgs?: string[];
  customVersionsDir?: string;
}

export interface VersionSelection {
  mcVersion: string;
  loaderType?: LoaderType;
  loaderVersion?: string;
  customVersionPath?: string;
}

export interface InstallerProfileLibrary extends VersionJsonLibrary {
  url?: string;
}

export interface InstallerProcessor {
  jar: string;
  sides?: string[];
  classpath?: string[];
  args?: string[];
  outputs?: Record<string, string>;
}

export interface InstallerProfile {
  spec?: number;
  profile?: string;
  version?: string;
  icon?: string;
  json?: string;
  path?: string;
  minecraft?: string;
  welcome?: string;
  data?: Record<string, { client?: string; server?: string }>;
  processors?: InstallerProcessor[];
  libraries?: InstallerProfileLibrary[];
  versionInfo?: VersionJson;
  mirrorList?: string;
  logo?: string;
  install?: {
    profileName?: string;
    target?: string;
    path?: string;
  };
  [key: string]: unknown;
}

export interface FabricGameVersion {
  version: string;
  stable: boolean;
}

export interface FabricLoaderVersion {
  version: string;
  stable: boolean;
}

export interface FabricProfileJson extends VersionJson {}

export interface QuiltGameVersion {
  version: string;
  stable: boolean;
}

export interface QuiltLoaderVersion {
  version: string;
  separator?: string;
  build?: number;
  maven?: string;
}

export interface QuiltLoaderMetadata {
  loader: QuiltLoaderVersion;
  intermediary?: {
    version?: string;
    stable?: boolean;
  };
  hashed?: {
    version?: string;
  };
}
