// ============================================================
// XNLC вЂ” Main Library Class
// Orchestrates all components for Minecraft launching
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import * as fs from "fs";
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
  InstallationPhase,
  MojangVersionEntry,
  FabricGameVersion,
  FabricLoaderVersion,
  QuiltGameVersion,
  QuiltLoaderVersion,
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
import { parseOptifineFilename } from "./loaders/optifine-handler.js";
import {
  getGameDirStructure,
  getVersionDir,
  getOSInfo,
  ensureDirSync,
  getRequiredJavaVersion as resolveJavaVersion,
  shouldRepairOptifineProfile as checkRepairOptifine,
  shouldRepairLiteLoaderProfile as checkRepairLiteLoader,
} from "./utils/index.js";


type PreparationPlan = {
  totalFiles: number;
  totalBytes: number;
};

class ProgressTracker {
  private completedFiles = 0;
  private completedBytes = 0;
  private activeBytes = new Map<string, number>();
  private finishedFiles = new Set<string>();

  constructor(
    private readonly plan: PreparationPlan,
    private readonly emit?: DownloadProgressCallback,
  ) {}

  onProgress = (progress: DownloadProgress): void => {
    if (!this.emit) return;

    const fileId = progress.file ?? progress.fileName ?? "__unknown__";
    const downloaded = progress.downloaded ?? progress.downloadedBytes ?? 0;
    const total = progress.total ?? 0;

    if (!this.finishedFiles.has(fileId)) {
      this.activeBytes.set(fileId, downloaded);
      if (total > 0 && downloaded >= total) {
        this.finishedFiles.add(fileId);
        this.completedFiles += 1;
        this.completedBytes += total;
        this.activeBytes.delete(fileId);
      }
    }

    const activeBytes = [...this.activeBytes.values()].reduce((sum, value) => sum + value, 0);
    const downloadedBytes = Math.min(this.plan.totalBytes, this.completedBytes + activeBytes);
    const percent = this.plan.totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / this.plan.totalBytes) * 100))
      : progress.percent;

    this.emit({
      ...progress,
      downloadedBytes,
      currentFile: Math.min(this.plan.totalFiles, this.completedFiles + this.activeBytes.size),
      totalFiles: this.plan.totalFiles,
      percent,
    });
  };
}

function withStage(stage: string, callback?: DownloadProgressCallback): DownloadProgressCallback | undefined {
  if (!callback) return undefined;
  return (progress) => callback({ ...progress, type: stage });
}

function resolveVersionId(versionJson: VersionJson, versionIdOverride?: string): string {
  return versionIdOverride ?? versionJson.inheritsFrom ?? versionJson.id;
}

function formatLibrarySummary(versionJson: VersionJson): string {
  const total = versionJson.libraries.length;
  const nativeCandidates = versionJson.libraries.filter((lib) => !!lib.natives).length;
  const classifierDownloads = versionJson.libraries.filter((lib) => !!lib.downloads?.classifiers).length;
  return `libraries=${total} nativeCandidates=${nativeCandidates} classifierDownloads=${classifierDownloads}`;
}

function compareVersionParts(a: string, b: string): number {
  const aParts = a.split(/[^0-9]+/).filter(Boolean).map((part) => parseInt(part, 10));
  const bParts = b.split(/[^0-9]+/).filter(Boolean).map((part) => parseInt(part, 10));
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}

export class Xnlc {
  // Core components
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

  // Config
  private options: XnlcOptions;
  private osInfo: OSInfo;

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

  // ---------- Version Discovery ----------

  async getMojangVersions(): Promise<MojangVersionEntry[]> {
    return this.metaClient.getAllVersions();
  }

  async getLatestRelease(): Promise<string> {
    return this.metaClient.getLatestRelease();
  }

  async getLatestSnapshot(): Promise<string> {
    return this.metaClient.getLatestSnapshot();
  }

  async getNeoForgeVersions(mcVersion: string): Promise<string[]> {
    return this.loaderResolver.getNeoForgeHandler().getVersions(mcVersion);
  }

  async getNeoForgeSupportedVersions(): Promise<string[]> {
    return this.loaderResolver.getNeoForgeHandler().getSupportedMinecraftVersions();
  }

  async getForgeSupportedVersions(): Promise<string[]> {
    return (await this.loaderResolver.getForgeHandler().getSupportedMinecraftVersions()) || [];
  }

  async getNeoForgeRecommended(mcVersion: string): Promise<string | undefined> {
    return (await this.loaderResolver.getNeoForgeHandler().getRecommendedVersion(mcVersion)) || undefined;
  }

  async getForgeVersions(mcVersion: string): Promise<string[]> {
    return this.loaderResolver.getForgeHandler().getVersions(mcVersion);
  }

  async getForgeRecommended(mcVersion: string): Promise<string | undefined> {
    return (await this.loaderResolver.getForgeHandler().getRecommendedVersion(mcVersion)) || undefined;
  }

  async getFabricGameVersions(): Promise<string[]> {
    return this.loaderResolver.getFabricHandler().getGameVersions();
  }

  async getFabricLoaderVersions(mcVersion: string): Promise<string[]> {
    return this.loaderResolver.getFabricHandler().getLoaderVersionsForGame(mcVersion);
  }

  async getQuiltGameVersions(): Promise<string[]> {
    return this.loaderResolver.getQuiltHandler().getGameVersions();
  }

  async getLiteLoaderVersions(mcVersion: string): Promise<string[]> {
    return this.loaderResolver.getLiteLoaderHandler().getVersions(mcVersion);
  }

  async getLiteLoaderSupportedVersions(): Promise<string[]> {
    return this.loaderResolver.getLiteLoaderHandler().getSupportedMinecraftVersions();
  }

  async getLiteLoaderRecommended(mcVersion: string): Promise<string | undefined> {
    return (await this.loaderResolver.getLiteLoaderHandler().getRecommendedVersion(mcVersion)) || undefined;
  }

  async getQuiltLoaderVersions(mcVersion: string): Promise<string[]> {
    return this.loaderResolver.getQuiltHandler().getLoaderVersionsForGame(mcVersion);
  }

  async getOptifineVersions(mcVersion: string): Promise<import("./loaders/optifine-handler.js").OptifineVersion[]> {
    return this.loaderResolver.getOptifineHandler().getVersions(mcVersion);
  }

  async getOptifineSupportedVersions(): Promise<string[]> {
    return this.loaderResolver.getOptifineHandler().getSupportedVersions();
  }

  async getOptifineAllVersions(): Promise<import("./loaders/optifine-handler.js").OptifineVersion[]> {
    return this.loaderResolver.getOptifineHandler().getAllVersions();
  }

  async getOptifineRecommended(mcVersion: string): Promise<import("./loaders/optifine-handler.js").OptifineVersion | undefined> {
    return this.loaderResolver.getOptifineHandler().getRecommendedVersion(mcVersion);
  }

  async getCustomVersions(): Promise<string[]> {
    return this.loaderResolver.getCustomVersionHandler().getVersions();
  }

  // ---------- Download & Install ----------

  async downloadVanilla(mcVersion: string, onProgress?: DownloadProgressCallback): Promise<VersionJson> {
    const versionJson = await this.versionResolver.resolveVersion(mcVersion, this.osInfo);
    const plan = await this.buildPreparationPlan(versionJson, mcVersion);
    const tracker = new ProgressTracker(plan, onProgress);

    // Download client jar
    const clientDownload = versionJson.downloads?.client;
    if (clientDownload?.url) {
      const versionDir = getVersionDir(this.options.gameDir, mcVersion);
      ensureDirSync(versionDir);
      const clientDest = path.join(versionDir, `${mcVersion}.jar`);

      await this.downloader.download({
        url: clientDownload.url,
        dest: clientDest,
        sha1: clientDownload.sha1,
        size: clientDownload.size,
        onProgress: withStage("game", tracker.onProgress),
      });
    }

    // Write version.json
    const versionDir = getVersionDir(this.options.gameDir, mcVersion);
    ensureDirSync(versionDir);
    const versionJsonPath = path.join(versionDir, `${mcVersion}.json`);
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));

    // Download libraries
    await this.librariesManager.downloadLibraries(versionJson, withStage("libraries", tracker.onProgress));

    // Download assets
    await this.assetsManager.downloadAssets(versionJson, this.options.gameDir, withStage("assets", tracker.onProgress));

    return versionJson;
  }

  private getLoaderInstallationPhase(loaderType: LoaderType): InstallationPhase {
    switch (loaderType) {
      case "neoforge":
        return "installing-loader";
      case "fabric":
      case "fabric-legacy":
      case "liteloader":
      case "quilt":
        return "downloading-libraries";
      case "optifine":
        return "installing-loader";
      default:
        return "installing";
    }
  }

  async installLoader(
    mcVersion: string,
    loaderType: LoaderType,
    loaderVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    const actualLoaderType = this.loaderResolver.determineLoaderType(mcVersion, loaderType, loaderVersion);
    const installPhase = this.getLoaderInstallationPhase(actualLoaderType);
    
    onProgress?.({
      type: actualLoaderType,
      installationPhase: installPhase,
      percent: 0,
    });

    return this.loaderResolver.installLoader(
      mcVersion,
      actualLoaderType,
      loaderVersion,
      onProgress,
    );
  }

  private async buildPreparationPlan(versionJson: VersionJson, versionIdOverride?: string): Promise<PreparationPlan> {
    const vanillaMeta = this.countVanillaMeta(versionJson, versionIdOverride);
    const libraries = {
      totalFiles: this.librariesManager.countTotalFiles(versionJson),
      totalBytes: this.librariesManager.countTotalSize(versionJson),
    };
    const assets = {
      totalFiles: await this.assetsManager.countAssets(versionJson, this.options.gameDir),
      totalBytes: await this.assetsManager.countTotalSize(versionJson, this.options.gameDir),
    };

    const plan = {
      totalFiles: vanillaMeta.totalFiles + libraries.totalFiles + assets.totalFiles,
      totalBytes: vanillaMeta.totalBytes + libraries.totalBytes + assets.totalBytes,
    };
    console.log(`[XNLC] Preparation plan for ${resolveVersionId(versionJson, versionIdOverride)}: gameFiles=${vanillaMeta.totalFiles} libraryFiles=${libraries.totalFiles} assetFiles=${assets.totalFiles} totalFiles=${plan.totalFiles} totalBytes=${plan.totalBytes}`);
    return plan;
  }

  private countVanillaMeta(versionJson: VersionJson, versionIdOverride?: string): PreparationPlan {
    let totalFiles = 0;
    let totalBytes = 0;
    const versionId = versionJson.jar ?? resolveVersionId(versionJson, versionIdOverride);

    const clientDownload = versionJson.downloads?.client;
    if (clientDownload?.url) {
      const clientDest = path.join(getVersionDir(this.options.gameDir, versionId), `${versionId}.jar`);
      if (!fs.existsSync(clientDest)) {
        totalFiles += 1;
        totalBytes += clientDownload.size ?? 0;
      }
    }

    return { totalFiles, totalBytes };
  }

  private async ensureClientJar(
    versionJson: VersionJson,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const clientDownload = versionJson.downloads?.client;
    if (!clientDownload?.url) {
      return;
    }

    const versionId = versionJson.jar ?? resolveVersionId(versionJson);
    const versionDir = getVersionDir(this.options.gameDir, versionId);
    ensureDirSync(versionDir);

    const clientDest = path.join(versionDir, `${versionId}.jar`);
    if (fs.existsSync(clientDest)) {
      return;
    }

    await this.downloader.download({
      url: clientDownload.url,
      dest: clientDest,
      sha1: clientDownload.sha1,
      size: clientDownload.size,
      onProgress,
    });
  }

  private async ensureBaseVanillaInstalled(
    mcVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const baseVersionDir = getVersionDir(this.options.gameDir, mcVersion);
    const baseVersionJsonPath = path.join(baseVersionDir, `${mcVersion}.json`);
    const baseClientJarPath = path.join(baseVersionDir, `${mcVersion}.jar`);

    if (fs.existsSync(baseVersionJsonPath) && fs.existsSync(baseClientJarPath)) {
      return;
    }

    await this.downloadVanilla(mcVersion, onProgress);
  }



  // ---------- Launch ----------

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
    this.ensureLauncherProfiles();
    console.log(`[XNLC] Launch requested selection=${JSON.stringify(selection)} config=${JSON.stringify({
      javaPath: config.javaPath ?? "",
      memoryMin: config.memoryMin ?? "",
      memoryMax: config.memoryMax ?? "",
      width: config.width ?? 0,
      height: config.height ?? 0,
      jvmArgs: config.jvmArgs?.length ?? 0,
      gameArgs: config.gameArgs?.length ?? 0,
    })}`);

    const resolvedSelection = await this.resolveSelection(selection);
    const { loaderType, customVersionPath } = resolvedSelection;
    let javaRuntime: Awaited<ReturnType<JavaManager["findOrDownloadJava"]>> | null = null;

    // Order requirement: Java -> Vanilla -> Modloader.
    // For non-custom launches we can resolve required Java from base vanilla metadata first.
    if (!customVersionPath && loaderType !== "custom") {
      const baseVersionJson = await this.versionResolver.resolveVersion(resolvedSelection.mcVersion, this.osInfo);
      console.log(`[XNLC] Base version metadata resolved id=${baseVersionJson.id} javaComponent=${baseVersionJson.javaVersion?.majorVersion ?? "unknown"} ${formatLibrarySummary(baseVersionJson)}`);
      const requiredJavaVersion = this.getRequiredJavaVersion(baseVersionJson, resolvedSelection);
      console.log(`[XNLC] Required Java version before install: ${requiredJavaVersion}`);
      javaRuntime = await this.javaManager.findOrDownloadJava(
        requiredJavaVersion,
        config.javaPath ?? this.options.javaPath,
        undefined,
        baseVersionJson.javaVersion,
      );
      this.logJavaRuntime(javaRuntime);
    }

    const versionJson = await this.resolveLaunchVersion(resolvedSelection, onProgress);
    console.log(`[XNLC] Launch version resolved id=${versionJson.id} inheritsFrom=${versionJson.inheritsFrom ?? ""} mainClass=${versionJson.mainClass} ${formatLibrarySummary(versionJson)}`);
    
    // For custom versions with inheritsFrom, resolve inheritance to get base Minecraft libraries
    // Otherwise use the resolved versionJson directly
    const resolvedJson = customVersionPath
      ? (versionJson.inheritsFrom
        ? await this.versionResolver.resolveVersionFromJson(versionJson, this.osInfo)
        : versionJson)
      : loaderType === "vanilla"
        ? await this.versionResolver.resolveVersion(versionJson.id, this.osInfo)
        : await this.versionResolver.resolveVersionFromJson(versionJson, this.osInfo);
    console.log(`[XNLC] Final resolved JSON id=${resolvedJson.id} inheritsFrom=${resolvedJson.inheritsFrom ?? ""} mainClass=${resolvedJson.mainClass} assetIndex=${resolvedJson.assetIndex?.id ?? ""} ${formatLibrarySummary(resolvedJson)}`);

    const plan = await this.buildPreparationPlan(resolvedJson);
    const tracker = new ProgressTracker(plan, onProgress);

    // Step 4: Ensure the client jar exists for the launch target.
    // Inherited profiles such as Fabric/Quilt need the base Minecraft jar
    // present under the parent version directory for the runtime classpath.
    await this.ensureClientJar(resolvedJson, withStage("game", tracker.onProgress));
    console.log(`[XNLC] Client jar ensured for ${resolvedJson.id}`);

    // Step 5: Download libraries for resolved version
    await this.librariesManager.downloadLibraries(resolvedJson, withStage("libraries", tracker.onProgress));
    const libraries = this.librariesManager.resolveLibraries(resolvedJson);

    // Step 6: Download assets
    await this.assetsManager.downloadAssets(resolvedJson, this.options.gameDir, withStage("assets", tracker.onProgress));
    console.log(`[XNLC] Assets download stage completed for assetIndex=${resolvedJson.assetIndex?.id ?? ""}`);

    // Step 7: Extract natives
    const nativesDir = await this.nativesExtractor.extractNatives(resolvedJson, this.options.gameDir);
    console.log(`[XNLC] Natives extracted to ${nativesDir}`);

    // Fallback for custom version paths where required Java is unknown before resolving version JSON.
    if (!javaRuntime) {
      const requiredJavaVersion = resolveJavaVersion(resolvedJson);
      console.log(`[XNLC] Required Java version after full resolve: ${requiredJavaVersion}`);
      javaRuntime = await this.javaManager.findOrDownloadJava(
        requiredJavaVersion,
        config.javaPath ?? this.options.javaPath,
        undefined,
        resolvedJson.javaVersion,
      );
    }

    const javaPath = javaRuntime.path;

    // Step 9: Build launch command
    const fullCommand = this.launchBuilder.build(
      resolvedJson,
      libraries,
      auth,
      {
        javaPath,
        memoryMin: config.memoryMin,
        memoryMax: config.memoryMax,
        width: config.width,
        height: config.height,
        extraJvmArgs: config.jvmArgs ?? this.options.defaultJvmArgs ?? [],
        extraGameArgs: config.gameArgs ?? [],
      }
    );
    console.log(`[XNLC] Launch command built with ${fullCommand.length} segments`);

    // Step 10: Launch
    return this.javaRunner.launch(fullCommand, this.options.gameDir);
  }

  private async resolveLaunchVersion(
    selection: VersionSelection,
    onProgress?: DownloadProgressCallback,
  ): Promise<VersionJson> {
    const {
      mcVersion,
      loaderType = "vanilla",
      loaderVersion,
      customVersionPath,
    } = selection;
    
    // Handle custom version path (when user enters a path instead of MC version)
    if (customVersionPath) {
      const result = await this.loaderResolver.getCustomVersionHandler().install(customVersionPath, "", onProgress);
      return result.versionJson!;
    }

    if (loaderType === "vanilla") {
      return this.downloadVanilla(mcVersion, onProgress);
    }

    if (loaderType === "custom") {
      if (!customVersionPath) {
        throw new Error("Custom version path is required for custom loaders");
      }
      const result = await this.loaderResolver.getCustomVersionHandler().install(customVersionPath, "", onProgress);
      return result.versionJson!;
    }

    await this.ensureBaseVanillaInstalled(mcVersion, onProgress);

    if (!loaderVersion) {
      throw new Error(`Failed to resolve ${loaderType} version for Minecraft ${mcVersion}`);
    }

    const profileName = this.getProfileName(mcVersion, loaderType, loaderVersion);
    const versionJsonPath = this.getVersionJsonPath(profileName);
    await this.ensureInstalledVersion(selection, versionJsonPath, onProgress);
    if (!fs.existsSync(versionJsonPath)) {
      throw new Error(`Version JSON not found at ${versionJsonPath}`);
    }
    return this.readVersionJson(versionJsonPath);
  }

  private async resolveSelection(selection: VersionSelection): Promise<VersionSelection> {
    const loaderType = selection.loaderType ?? "vanilla";
    if (loaderType === "vanilla" || loaderType === "custom") {
      return { ...selection, loaderType };
    }

    if (selection.loaderVersion) {
      return this.normalizeExplicitLoaderSelection({
        ...selection,
        loaderType,
      });
    }

    return {
      ...selection,
      loaderType,
      loaderVersion: await this.resolveDefaultLoaderVersion(selection.mcVersion, loaderType),
    };
  }

  private async normalizeExplicitLoaderSelection(selection: VersionSelection): Promise<VersionSelection> {
    if (selection.loaderType !== "quilt" || !selection.loaderVersion) {
      return selection;
    }

    const requiredJavaVersion = await this.getRequiredJavaVersionForMinecraft(selection.mcVersion);
    if (this.isCompatibleQuiltLoaderVersion(selection.loaderVersion, requiredJavaVersion)) {
      return selection;
    }

    const fallbackVersion = await this.resolveDefaultLoaderVersion(selection.mcVersion, "quilt");
    console.log(`[XNLC] Quilt loader ${selection.loaderVersion} is incompatible with Minecraft ${selection.mcVersion} on Java ${requiredJavaVersion}; using ${fallbackVersion} instead`);
    return {
      ...selection,
      loaderVersion: fallbackVersion,
    };
  }

  private async resolveDefaultLoaderVersion(
    mcVersion: string,
    loaderType: LoaderType,
  ): Promise<string> {
    switch (loaderType) {
      case "neoforge": {
        const recommended = await this.getNeoForgeRecommended(mcVersion);
        if (recommended) return recommended;
        const versions = await this.getNeoForgeVersions(mcVersion);
        if (versions.length > 0) return versions.at(-1)!;
        break;
      }
      case "fabric": {
        const versions = await this.getFabricLoaderVersions(mcVersion);
        if (versions[0]) return versions[0];
        break;
      }
      case "liteloader": {
        const recommended = await this.getLiteLoaderRecommended(mcVersion);
        if (recommended) return recommended;
        const versions = await this.getLiteLoaderVersions(mcVersion);
        if (versions[0]) return versions[0];
        break;
      }
      case "quilt": {
        const versions = await this.getQuiltLoaderVersions(mcVersion);
        const stable = versions.find((v) => !v.includes("-beta") && !v.includes("-pre") && !v.includes("-rc"));
        if (stable) return stable;
        if (versions[0]) return versions[0];
        break;
      }
      case "optifine": {
        const recommended = await this.getOptifineRecommended(mcVersion);
        if (recommended?.filename) return recommended.filename;
        const versions = await this.getOptifineVersions(mcVersion);
        if (versions[0]?.filename) return versions[0].filename;
        break;
      }
      default:
        break;
    }

    throw new Error(`No ${loaderType} versions found for Minecraft ${mcVersion}`);
  }

  private async ensureInstalledVersion(
    selection: VersionSelection,
    versionJsonPath: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const { mcVersion, loaderType = "vanilla", loaderVersion } = selection;
    if (!loaderVersion) return;

    if (!fs.existsSync(versionJsonPath)) {
      await this.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
    }

    if (!fs.existsSync(versionJsonPath)) {
      return;
    }

    const current = this.readVersionJson(versionJsonPath);
    if (loaderType === "optifine" && this.shouldRepairOptifineProfile(current)) {
      await this.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
      return;
    }

    if (loaderType === "liteloader" && this.shouldRepairLiteLoaderProfile(current)) {
      await this.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
      return;
    }
  }

  private readVersionJson(versionJsonPath: string): VersionJson {
    return JSON.parse(fs.readFileSync(versionJsonPath, "utf-8")) as VersionJson;
  }

  private getVersionJsonPath(profileName: string): string {
    return path.join(getVersionDir(this.options.gameDir, profileName), `${profileName}.json`);
  }

  private getProfileName(
    mcVersion: string,
    loaderType: LoaderType,
    loaderVersion: string,
  ): string {
    const actualLoaderType = this.loaderResolver.determineLoaderType(mcVersion, loaderType, loaderVersion);
    const parsedOptifine = loaderType === "optifine" ? parseOptifineFilename(loaderVersion) : null;
    switch (actualLoaderType) {
      case "neoforge":
        return `neoforge-${loaderVersion}-${mcVersion}`;
      case "forge":
        return `forge-${loaderVersion}-${mcVersion}`;
      case "fabric":
      case "fabric-legacy":
        return `fabric-loader-${loaderVersion}-${mcVersion}`;
      case "liteloader":
        return `liteloader-${loaderVersion}-${mcVersion}`;
      case "quilt":
        return `quilt-loader-${loaderVersion}-${mcVersion}`;
      case "optifine":
        return parsedOptifine
          ? `${mcVersion}-OptiFine_${parsedOptifine.edition}_${parsedOptifine.release}`
          : `${mcVersion}-OptiFine_${loaderVersion}`;
      case "custom":
        return loaderVersion;
      default:
        return mcVersion;
    }
  }

  private logJavaRuntime(runtime: any): void {
    console.log(`[XNLC] Resolved Java runtime ready: ${runtime.path} (version ${runtime.version}, vendor ${runtime.vendor})`);
  }

  private getRequiredJavaVersion(versionJson: VersionJson, selection?: VersionSelection): number {
    return resolveJavaVersion(versionJson);
  }

  private async getRequiredJavaVersionForMinecraft(mcVersion: string): Promise<number> {
    const baseVersionJson = await this.versionResolver.resolveVersion(mcVersion, this.osInfo);
    return this.getRequiredJavaVersion(baseVersionJson, { mcVersion, loaderType: "vanilla" });
  }

  private isCompatibleQuiltLoaderVersion(loaderVersion: string, requiredJavaVersion: number): boolean {
    if (requiredJavaVersion >= 25) {
      return compareVersionParts(loaderVersion, "0.29.0") >= 0;
    }

    if (requiredJavaVersion >= 24) {
      return compareVersionParts(loaderVersion, "0.27.0") >= 0;
    }

    return true;
  }

  private shouldRepairOptifineProfile(versionJson: VersionJson): boolean {
    return checkRepairOptifine(versionJson, this.osInfo);
  }

  private shouldRepairLiteLoaderProfile(versionJson: VersionJson): boolean {
    return checkRepairLiteLoader(versionJson);
  }

  private ensureLauncherProfiles(): void {
    const launcherProfilesPath = path.join(this.options.gameDir, "launcher_profiles.json");
    if (!fs.existsSync(launcherProfilesPath)) {
      fs.writeFileSync(launcherProfilesPath, JSON.stringify({ profiles: {} }, null, 2));
    }
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
}

