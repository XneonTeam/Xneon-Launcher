// ============================================================
// XNLC — Loader Service
// Handles mod loader version queries, installation, and resolution
// Extracted from xnlc.ts monolith
// ============================================================

import * as fs from "fs";
import {
  OSInfo,
  LoaderType,
  VersionSelection,
  VersionJson,
  DownloadProgressCallback,
  LoaderInstallResult,
  InstallationPhase,
} from "../types/index.js";
import { LoaderResolver } from "../loaders/loader-resolver.js";
import { parseOptifineFilename, OptifineVersion } from "../loaders/optifine-handler.js";
import {
  getRequiredJavaVersion as resolveJavaVersion,
} from "../utils/index.js";
import { VersionResolver } from "../core/version-resolver.js";
import { compareVersionParts } from "./shared-helpers.js";

export class XnlcLoaderService {
  constructor(
    private loaderResolver: LoaderResolver,
    private versionResolver: VersionResolver,
    private osInfo: OSInfo,
  ) {}

  // ---------- Loader Version Queries ----------

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

  async getOptifineVersions(mcVersion: string): Promise<OptifineVersion[]> {
    return this.loaderResolver.getOptifineHandler().getOptifineVersions(mcVersion);
  }

  async getOptifineSupportedVersions(): Promise<string[]> {
    return this.loaderResolver.getOptifineHandler().getSupportedVersions();
  }

  async getOptifineAllVersions(): Promise<OptifineVersion[]> {
    return this.loaderResolver.getOptifineHandler().getAllVersions();
  }

  async getOptifineRecommended(mcVersion: string): Promise<OptifineVersion | undefined> {
    return this.loaderResolver.getOptifineHandler().getOptifineRecommended(mcVersion);
  }

  async getCustomVersions(): Promise<string[]> {
    return this.loaderResolver.getCustomVersionHandler().listCustomVersions();
  }

  // ---------- Loader Installation ----------

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

  // ---------- Version Resolution ----------

  async resolveSelection(selection: VersionSelection): Promise<VersionSelection> {
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

  getProfileName(
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

  // ---------- Private Helpers ----------

  private async getRequiredJavaVersionForMinecraft(mcVersion: string): Promise<number> {
    const baseVersionJson = await this.versionResolver.resolveVersion(mcVersion, this.osInfo);
    return resolveJavaVersion(baseVersionJson);
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
}
