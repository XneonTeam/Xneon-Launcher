// ============================================================
// XNLC — Fabric Legacy Handler (loader < 0.14.0)
// Older Fabric may have different profile structure
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import * as fs from "fs";
import { VersionJson, FabricLoaderVersion, LoaderInstallResult, DownloadProgressCallback } from "../types/index.js";
import { Downloader, DownloadOptions } from "../core/downloader.js";
import { getVersionDir, getLibraryDir, ensureDirSync } from "../utils/index.js";
import { URLS } from "../constants/urls.js";

const FABRIC_META = URLS.official.fabric.metaV2;

export class FabricLegacyHandler {
  constructor(
    private downloader: Downloader,
    private gameDir: string,
  ) {}

  async getLoaderVersionsForGame(mcVersion: string): Promise<FabricLoaderVersion[]> {
    const res = await fetch(`${FABRIC_META}/versions/loader/${mcVersion}`);
    if (!res.ok) throw new Error(`Failed to fetch Fabric loader versions for ${mcVersion}: ${res.status}`);
    const data = await res.json() as Array<{ loader: FabricLoaderVersion }>;
    return data.map((item) => item.loader);
  }

  async install(
    mcVersion: string,
    loaderVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    const profileName = `fabric-loader-${loaderVersion}-${mcVersion}`;
    const versionDir = getVersionDir(this.gameDir, profileName);
    ensureDirSync(versionDir);

    // Fetch installer JSON from Fabric API
    const res = await fetch(`${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`);
    if (!res.ok) {
      throw new Error(`Failed to fetch Fabric profile: ${res.status}`);
    }

    const profileJson = await res.json() as Record<string, unknown>;

    // Legacy Fabric profiles may have different structure
    // Ensure compatibility with older profile format
    const versionJson: VersionJson = this.normalizeLegacyProfile(profileJson, mcVersion, loaderVersion);

    // Write version.json
    const versionJsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));

    // Download Fabric-specific libraries
    const libs = versionJson.libraries ?? [];
    const items = libs.map((lib) => {
      const artifact = lib.downloads?.artifact;
      if (!artifact?.url) return null;

      const libPath = artifact.path ?? this.libraryNameToPath(lib.name);
      const dest = path.join(getLibraryDir(this.gameDir), libPath);

      return {
        url: artifact.url,
        dest,
        sha1: artifact.sha1,
        size: artifact.size,
        onProgress,
      };
    }).filter(Boolean) as DownloadOptions[];

    if (items.length > 0) {
      await this.downloader.downloadMultiple(items, 5);
    }

    return {
      versionJson,
      versionId: profileName,
    };
  }

  private normalizeLegacyProfile(
    profile: Record<string, unknown>,
    mcVersion: string,
    loaderVersion: string,
  ): VersionJson {
    // Legacy profiles may use minecraftArguments instead of arguments
    const hasArguments = "arguments" in profile;
    const hasMinecraftArguments = "minecraftArguments" in profile;

    if (!hasArguments && hasMinecraftArguments) {
      // Convert legacy format
      return {
        id: (profile.id as string) ?? `fabric-loader-${loaderVersion}-${mcVersion}`,
        time: (profile.time as string) ?? new Date().toISOString(),
        releaseTime: (profile.releaseTime as string) ?? new Date().toISOString(),
        type: "release",
        mainClass: (profile.mainClass as string) ?? "net.fabricmc.loader.impl.launch.knot.KnotClient",
        minecraftArguments: profile.minecraftArguments as string,
        libraries: (profile.libraries as VersionJson["libraries"]) ?? [],
        // Inherited metadata must come from the vanilla parent.
        // Writing empty placeholders here would override the parent's
        // real client download and asset index during resolveInheritance().
        inheritsFrom: mcVersion,
      };
    }

    return profile as unknown as VersionJson;
  }

  private libraryNameToPath(name: string): string {
    const parts = name.split(":");
    const groupId = (parts[0] ?? "").replace(/\./g, "/");
    const artifactId = parts[1] ?? "";
    const version = parts[2] ?? "";
    const classifier = parts[3] ?? "";
    const ext = parts[4] ?? "jar";

    let fileName = `${artifactId}-${version}`;
    if (classifier) fileName += `-${classifier}`;
    fileName += `.${ext}`;

    return `${groupId}/${artifactId}/${version}/${fileName}`;
  }
}
