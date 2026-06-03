// ============================================================
// XNLC — Version Service
// Handles vanilla version discovery, downloading, and preparation
// Extracted from xnlc.ts monolith
// ============================================================

import * as path from "path";
import * as fs from "fs";
import {
  OSInfo,
  MojangVersionEntry,
  VersionJson,
  DownloadProgressCallback,
} from "../types/index.js";
import { MetaClient } from "../core/meta-client.js";
import { VersionResolver } from "../core/version-resolver.js";
import { Downloader } from "../core/downloader.js";
import { LibrariesManager } from "../core/libraries-manager.js";
import { AssetsManager } from "../core/assets-manager.js";
import { getVersionDir, ensureDirSync } from "../utils/index.js";
import {
  PreparationPlan,
  ProgressTracker,
  withStage,
  resolveVersionId,
} from "./shared-helpers.js";

export class XnlcVersionService {
  constructor(
    private metaClient: MetaClient,
    private versionResolver: VersionResolver,
    private downloader: Downloader,
    private librariesManager: LibrariesManager,
    private assetsManager: AssetsManager,
    private gameDir: string,
    private osInfo: OSInfo,
  ) {}

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

  // ---------- Download & Install ----------

  async downloadVanilla(mcVersion: string, onProgress?: DownloadProgressCallback): Promise<VersionJson> {
    const versionJson = await this.versionResolver.resolveVersion(mcVersion, this.osInfo);
    const plan = await this.buildPreparationPlan(versionJson, mcVersion);
    const tracker = new ProgressTracker(plan, onProgress);

    // Download client jar
    const clientDownload = versionJson.downloads?.client;
    if (clientDownload?.url) {
      const versionDir = getVersionDir(this.gameDir, mcVersion);
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
    const versionDir = getVersionDir(this.gameDir, mcVersion);
    ensureDirSync(versionDir);
    const versionJsonPath = path.join(versionDir, `${mcVersion}.json`);
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));

    // Download libraries
    await this.librariesManager.downloadLibraries(versionJson, withStage("libraries", tracker.onProgress));

    // Download assets
    await this.assetsManager.downloadAssets(versionJson, this.gameDir, withStage("assets", tracker.onProgress));

    return versionJson;
  }

  async buildPreparationPlan(versionJson: VersionJson, versionIdOverride?: string): Promise<PreparationPlan> {
    const vanillaMeta = this.countVanillaMeta(versionJson, versionIdOverride);
    const libraries = {
      totalFiles: this.librariesManager.countTotalFiles(versionJson),
      totalBytes: this.librariesManager.countTotalSize(versionJson),
    };
    const assets = {
      totalFiles: await this.assetsManager.countAssets(versionJson, this.gameDir),
      totalBytes: await this.assetsManager.countTotalSize(versionJson, this.gameDir),
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
      const clientDest = path.join(getVersionDir(this.gameDir, versionId), `${versionId}.jar`);
      if (!fs.existsSync(clientDest)) {
        totalFiles += 1;
        totalBytes += clientDownload.size ?? 0;
      }
    }

    return { totalFiles, totalBytes };
  }

  async ensureClientJar(
    versionJson: VersionJson,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const clientDownload = versionJson.downloads?.client;
    if (!clientDownload?.url) {
      return;
    }

    const versionId = versionJson.jar ?? resolveVersionId(versionJson);
    const versionDir = getVersionDir(this.gameDir, versionId);
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

  async ensureBaseVanillaInstalled(
    mcVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const baseVersionDir = getVersionDir(this.gameDir, mcVersion);
    const baseVersionJsonPath = path.join(baseVersionDir, `${mcVersion}.json`);
    const baseClientJarPath = path.join(baseVersionDir, `${mcVersion}.jar`);

    if (fs.existsSync(baseVersionJsonPath) && fs.existsSync(baseClientJarPath)) {
      return;
    }

    await this.downloadVanilla(mcVersion, onProgress);
  }
}
