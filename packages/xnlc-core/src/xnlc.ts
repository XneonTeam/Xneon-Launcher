// ============================================================
// XNLC — Main Library Class (Facade)
// Delegates to extracted services for backward compatibility
// Author: MAINER4IK
// ============================================================

import {
  XnlcOptions,
  OSInfo,
  AuthSession,
  LaunchAuth,
  LoaderType,
  VersionSelection,
  VersionJson,
  DownloadProgress,
  DownloadProgressCallback,
  LaunchResult,
  LoaderInstallResult,
  MojangVersionEntry,
} from "./types/index.js";
import { MetaClient } from "./core/meta-client.js";
import { VersionResolver } from "./core/version-resolver.js";
import { Downloader } from "./core/downloader.js";
import { LibrariesManager } from "./core/libraries-manager.js";
import { AssetsManager } from "./core/assets-manager.js";
import { NativesExtractor } from "./core/natives-extractor.js";
import { LaunchBuilder } from "./core/launch-builder.js";
import { JavaRunner } from "./core/java-runner.js";
import { JavaManager } from "./core/java-manager.js";
import { LoaderResolver } from "./loaders/loader-resolver.js";
import { AuthManager } from "./auth/auth-manager.js";
import type { OptifineVersion } from "./loaders/optifine-handler.js";
import { getGameDirStructure, getOSInfo, getRequiredJavaVersion as resolveRequiredJavaVersion } from "./utils/index.js";
import { XnlcVersionService } from "./services/version-service.js";
import { XnlcLoaderService } from "./services/loader-service.js";
import { XnlcLaunchPipeline } from "./services/launch-pipeline.js";

export class Xnlc {
  // Core components (public for backward compat)
  public metaClient: MetaClient;
  public versionResolver: VersionResolver;
  public downloader: Downloader;
  public librariesManager!: LibrariesManager;
  public assetsManager: AssetsManager;
  public nativesExtractor!: NativesExtractor;
  public launchBuilder!: LaunchBuilder;
  public javaRunner: JavaRunner;
  public javaManager!: JavaManager;
  public loaderResolver!: LoaderResolver;

  // Services
  private versionService!: XnlcVersionService;
  private loaderService!: XnlcLoaderService;
  private launchPipeline!: XnlcLaunchPipeline;

  // Config
  private options: XnlcOptions;
  public osInfo: OSInfo;

  constructor(options: XnlcOptions) {
    this.options = options;
    this.osInfo = options.os ?? getOSInfo();
    getGameDirStructure(options.gameDir);

    // Initialize core components
    this.metaClient = new MetaClient();
    this.versionResolver = new VersionResolver(this.metaClient);
    this.downloader = new Downloader();
    this.assetsManager = new AssetsManager(this.downloader);
    this.javaRunner = new JavaRunner();

    // Initialize dependent components
    this.initDependentComponents();

    // Initialize services
    this.versionService = new XnlcVersionService(
      this.metaClient, this.versionResolver, this.downloader,
      this.librariesManager, this.assetsManager, this.options.gameDir, this.osInfo,
    );
    this.loaderService = new XnlcLoaderService(
      this.loaderResolver, this.versionResolver, this.osInfo,
    );
    this.launchPipeline = new XnlcLaunchPipeline(
      this.versionService, this.loaderService, this.versionResolver,
      this.librariesManager, this.assetsManager, this.nativesExtractor,
      this.launchBuilder, this.javaRunner, this.javaManager,
      this.options, this.osInfo,
    );
  }

  private initDependentComponents(): void {
    this.librariesManager = new LibrariesManager(this.options.gameDir, this.osInfo);
    this.nativesExtractor = new NativesExtractor(this.librariesManager);
    this.launchBuilder = new LaunchBuilder(
      this.options.gameDir,
      this.osInfo,
      this.options.launcherName ?? "xnlc",
      this.options.launcherVersion ?? "1.0.0",
    );
    this.javaManager = new JavaManager(this.downloader, this.options.gameDir);
    this.loaderResolver = new LoaderResolver(
      this.downloader,
      this.metaClient,
      this.options.gameDir,
      this.options.customVersionsDir,
    );
  }

  // ---------- Version Discovery (→ VersionService) ----------

  async getMojangVersions(): Promise<MojangVersionEntry[]> {
    return this.versionService.getMojangVersions();
  }

  async getLatestRelease(): Promise<string> {
    return this.versionService.getLatestRelease();
  }

  async getLatestSnapshot(): Promise<string> {
    return this.versionService.getLatestSnapshot();
  }

  // ---------- Loader Version Queries (→ LoaderService) ----------

  async getNeoForgeVersions(mcVersion: string): Promise<string[]> {
    return this.loaderService.getNeoForgeVersions(mcVersion);
  }

  async getNeoForgeSupportedVersions(): Promise<string[]> {
    return this.loaderService.getNeoForgeSupportedVersions();
  }

  async getForgeSupportedVersions(): Promise<string[]> {
    return this.loaderService.getForgeSupportedVersions();
  }

  async getNeoForgeRecommended(mcVersion: string): Promise<string | undefined> {
    return this.loaderService.getNeoForgeRecommended(mcVersion);
  }

  async getForgeVersions(mcVersion: string): Promise<string[]> {
    return this.loaderService.getForgeVersions(mcVersion);
  }

  async getForgeRecommended(mcVersion: string): Promise<string | undefined> {
    return this.loaderService.getForgeRecommended(mcVersion);
  }

  async getFabricGameVersions(): Promise<string[]> {
    return this.loaderService.getFabricGameVersions();
  }

  async getFabricLoaderVersions(mcVersion: string): Promise<string[]> {
    return this.loaderService.getFabricLoaderVersions(mcVersion);
  }

  async getQuiltGameVersions(): Promise<string[]> {
    return this.loaderService.getQuiltGameVersions();
  }

  async getLiteLoaderVersions(mcVersion: string): Promise<string[]> {
    return this.loaderService.getLiteLoaderVersions(mcVersion);
  }

  async getLiteLoaderSupportedVersions(): Promise<string[]> {
    return this.loaderService.getLiteLoaderSupportedVersions();
  }

  async getLiteLoaderRecommended(mcVersion: string): Promise<string | undefined> {
    return this.loaderService.getLiteLoaderRecommended(mcVersion);
  }

  async getQuiltLoaderVersions(mcVersion: string): Promise<string[]> {
    return this.loaderService.getQuiltLoaderVersions(mcVersion);
  }

  async getOptifineVersions(mcVersion: string): Promise<OptifineVersion[]> {
    return this.loaderService.getOptifineVersions(mcVersion);
  }

  async getOptifineSupportedVersions(): Promise<string[]> {
    return this.loaderService.getOptifineSupportedVersions();
  }

  async getOptifineAllVersions(): Promise<OptifineVersion[]> {
    return this.loaderService.getOptifineAllVersions();
  }

  async getOptifineRecommended(mcVersion: string): Promise<OptifineVersion | undefined> {
    return this.loaderService.getOptifineRecommended(mcVersion);
  }

  async getCustomVersions(): Promise<string[]> {
    return this.loaderService.getCustomVersions();
  }

  // ---------- Download & Install (→ VersionService / LoaderService) ----------

  async downloadVanilla(mcVersion: string, onProgress?: DownloadProgressCallback): Promise<VersionJson> {
    return this.versionService.downloadVanilla(mcVersion, onProgress);
  }

  async installLoader(
    mcVersion: string,
    loaderType: LoaderType,
    loaderVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    return this.loaderService.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
  }

  // ---------- Launch (→ LaunchPipeline) ----------

  async launch(
    selection: VersionSelection,
    auth: LaunchAuth,
    config: {
      javaPath?: string;
      jvmArgs?: string[];
      gameArgs?: string[];
      memoryMin?: string;
      memoryMax?: string;
      width?: number;
      height?: number;
    } = {},
    onProgress?: DownloadProgressCallback,
  ): Promise<LaunchResult> {
    return this.launchPipeline.launch(selection, auth, config, onProgress);
  }

  // ---------- Auth Helpers ----------

  createOfflineAuth(username: string): LaunchAuth {
    return AuthManager.createOfflineAuth(username);
  }

  // ---------- Getters ----------

  getGameDir(): string {
    return this.options.gameDir;
  }

  getOSInfo(): OSInfo {
    return this.osInfo;
  }

  getRequiredJavaVersion(versionJson: VersionJson, _opts?: { mcVersion?: string; loaderType?: string; loaderVersion?: string }): number {
    return resolveRequiredJavaVersion(versionJson);
  }
}
