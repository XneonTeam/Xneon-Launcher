// ============================================================
// XNLC — Launch Pipeline
// Handles the full launch flow: resolve, prepare, build, run
// Extracted from xnlc.ts monolith
// ============================================================

import * as path from "path";
import * as fs from "fs";
import {
  XnlcOptions,
  OSInfo,
  LaunchAuth,
  VersionSelection,
  LaunchResult,
  VersionJson,
  DownloadProgressCallback,
} from "../types/index.js";
import { VersionResolver } from "../core/version-resolver.js";
import { LibrariesManager } from "../core/libraries-manager.js";
import { AssetsManager } from "../core/assets-manager.js";
import { NativesExtractor } from "../core/natives-extractor.js";
import { LaunchBuilder } from "../core/launch-builder.js";
import { JavaRunner } from "../core/java-runner.js";
import { JavaManager } from "../core/java-manager.js";
import { getVersionDir } from "../utils/index.js";
import {
  shouldRepairOptifineProfile as checkRepairOptifine,
  shouldRepairLiteLoaderProfile as checkRepairLiteLoader,
  getRequiredJavaVersion as resolveJavaVersion,
} from "../utils/index.js";
import {
  ProgressTracker,
  withStage,
  formatLibrarySummary,
} from "./shared-helpers.js";
import { XnlcVersionService } from "./version-service.js";
import { XnlcLoaderService } from "./loader-service.js";

export class XnlcLaunchPipeline {
  constructor(
    private versionService: XnlcVersionService,
    private loaderService: XnlcLoaderService,
    private versionResolver: VersionResolver,
    private librariesManager: LibrariesManager,
    private assetsManager: AssetsManager,
    private nativesExtractor: NativesExtractor,
    private launchBuilder: LaunchBuilder,
    private javaRunner: JavaRunner,
    private javaManager: JavaManager,
    private options: XnlcOptions,
    private osInfo: OSInfo,
  ) {}

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

    const resolvedSelection = await this.loaderService.resolveSelection(selection);
    const { loaderType, customVersionPath } = resolvedSelection;
    let javaRuntime: Awaited<ReturnType<JavaManager["findOrDownloadJava"]>> | null = null;

    // Order requirement: Java -> Vanilla -> Modloader.
    // For non-custom launches we can resolve required Java from base vanilla metadata first.
    if (!customVersionPath && loaderType !== "custom") {
      const baseVersionJson = await this.versionResolver.resolveVersion(resolvedSelection.mcVersion, this.osInfo);
      console.log(`[XNLC] Base version metadata resolved id=${baseVersionJson.id} javaComponent=${baseVersionJson.javaVersion?.majorVersion ?? "unknown"} ${formatLibrarySummary(baseVersionJson)}`);
      const requiredJavaVersion = resolveJavaVersion(baseVersionJson);
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

    const plan = await this.versionService.buildPreparationPlan(resolvedJson);
    const tracker = new ProgressTracker(plan, onProgress);

    // Step 4: Ensure the client jar exists for the launch target.
    await this.versionService.ensureClientJar(resolvedJson, withStage("game", tracker.onProgress));
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

  // ---------- Private Helpers ----------

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
    
    if (customVersionPath) {
      const result = await this.loaderService.installLoader(mcVersion, "custom", customVersionPath, onProgress);
      return result.versionJson!;
    }

    if (loaderType === "vanilla") {
      return this.versionService.downloadVanilla(mcVersion, onProgress);
    }

    if (loaderType === "custom") {
      if (!customVersionPath) {
        throw new Error("Custom version path is required for custom loaders");
      }
      const result = await this.loaderService.installLoader(mcVersion, "custom", customVersionPath, onProgress);
      return result.versionJson!;
    }

    await this.versionService.ensureBaseVanillaInstalled(mcVersion, onProgress);

    if (!loaderVersion) {
      throw new Error(`Failed to resolve ${loaderType} version for Minecraft ${mcVersion}`);
    }

    const profileName = this.loaderService.getProfileName(mcVersion, loaderType, loaderVersion);
    const versionJsonPath = this.getVersionJsonPath(profileName);
    await this.ensureInstalledVersion(selection, versionJsonPath, onProgress);
    if (!fs.existsSync(versionJsonPath)) {
      throw new Error(`Version JSON not found at ${versionJsonPath}`);
    }
    return this.readVersionJson(versionJsonPath);
  }

  private async ensureInstalledVersion(
    selection: VersionSelection,
    versionJsonPath: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const { mcVersion, loaderType = "vanilla", loaderVersion } = selection;
    if (!loaderVersion) return;

    if (!fs.existsSync(versionJsonPath)) {
      await this.loaderService.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
    }

    if (!fs.existsSync(versionJsonPath)) {
      return;
    }

    const current = this.readVersionJson(versionJsonPath);
    if (loaderType === "optifine" && this.shouldRepairOptifineProfile(current)) {
      await this.loaderService.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
      return;
    }

    if (loaderType === "liteloader" && this.shouldRepairLiteLoaderProfile(current)) {
      await this.loaderService.installLoader(mcVersion, loaderType, loaderVersion, onProgress);
      return;
    }
  }

  private readVersionJson(versionJsonPath: string): VersionJson {
    return JSON.parse(fs.readFileSync(versionJsonPath, "utf-8")) as VersionJson;
  }

  private getVersionJsonPath(profileName: string): string {
    return path.join(getVersionDir(this.options.gameDir, profileName), `${profileName}.json`);
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

  private logJavaRuntime(runtime: any): void {
    console.log(`[XNLC] Resolved Java runtime ready: ${runtime.path} (version ${runtime.version}, vendor ${runtime.vendor})`);
  }
}
