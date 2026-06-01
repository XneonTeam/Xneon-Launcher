// ============================================================
// XNLC — Assets Manager
// Downloads and manages Minecraft assets
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import * as fs from "fs";
import { VersionJson, AssetIndex, DownloadProgressCallback } from "../types/index.js";
import { Downloader } from "./downloader.js";
import { getAssetIndexDir, getAssetObjectsDir, ensureDirSync, sha1HashSync } from "../utils/index.js";
import { URLS } from "../constants/urls.js";
import { gunzipSync } from "zlib";

export class AssetsManager {
  constructor(private downloader: Downloader) {}

  private async ensureAssetIndex(versionJson: VersionJson, gameDir: string): Promise<{ assetIndex: NonNullable<VersionJson["assetIndex"]>; indexDest: string; indexData: AssetIndex; hadIndexFile: boolean }> {
    const { assetIndex } = versionJson;
    if (!assetIndex) {
      throw new Error("No asset index in version JSON");
    }

    const indexDest = path.join(getAssetIndexDir(gameDir), `${assetIndex.id}.json`);
    const hadIndexFile = fs.existsSync(indexDest);
    ensureDirSync(path.dirname(indexDest));
    try {
      const indexUrl = assetIndex.url?.trim()
        ? assetIndex.url
        : `${URLS.official.mojang.meta}/mc/assets/indexes/${assetIndex.id}.json`;

      await this.downloader.download({
        url: indexUrl,
        dest: indexDest,
        sha1: assetIndex.sha1,
        size: assetIndex.size,
      });
    } catch (error) {
      if (!hadIndexFile) {
        throw error;
      }
      console.warn(`[AssetsManager] Failed to refresh asset index ${assetIndex.id}, using cached copy at ${indexDest}`);
    }

    if (!fs.existsSync(indexDest)) {
      throw new Error(`Asset index file not found after download: ${indexDest}`);
    }
    const indexData = JSON.parse(fs.readFileSync(indexDest, "utf-8")) as AssetIndex;
    return { assetIndex, indexDest, indexData, hadIndexFile };
  }

  async countAssets(versionJson: VersionJson, gameDir: string): Promise<number> {
    const { hadIndexFile, indexData } = await this.ensureAssetIndex(versionJson, gameDir);
    let count = hadIndexFile ? 0 : 1;

    for (const entry of Object.values(indexData.objects)) {
      if (!this.isAssetObjectReady(gameDir, entry)) {
        count++;
      }
    }

    return count;
  }

  async countTotalSize(versionJson: VersionJson, gameDir: string): Promise<number> {
    const { assetIndex, hadIndexFile, indexData } = await this.ensureAssetIndex(versionJson, gameDir);
    let totalSize = hadIndexFile ? 0 : (assetIndex.size ?? 0);

    for (const entry of Object.values(indexData.objects)) {
      if (!this.isAssetObjectReady(gameDir, entry)) {
        totalSize += entry.size;
      }
    }

    return totalSize;
  }

  async downloadAssets(
    versionJson: VersionJson,
    gameDir: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const { assetIndex } = versionJson;
    if (!assetIndex) return;

    // Download asset index (reuses ensureAssetIndex to skip if already present)
    const { indexData } = await this.ensureAssetIndex(versionJson, gameDir);

    // Download all asset objects
    const items = Object.entries(indexData.objects)
      .map(([, entry]) => {
        if (this.isAssetObjectReady(gameDir, entry)) {
          return null;
        }

        const hash = entry.hash;
        const prefix = hash.slice(0, 2);
        const dest = path.join(getAssetObjectsDir(gameDir), prefix, hash);

        return {
          url: `${URLS.official.mojang.assets}/${prefix}/${hash}`,
          dest,
          sha1: hash,
          size: entry.size,
          onProgress,
        };
      })
      .filter(Boolean) as Array<{
        url: string;
        dest: string;
        sha1: string;
        size: number;
        onProgress?: DownloadProgressCallback;
      }>;

    await this.downloader.downloadMultiple(items, 10);
  }

  async getAssetIndex(versionJson: VersionJson, gameDir: string): Promise<AssetIndex> {
    return (await this.ensureAssetIndex(versionJson, gameDir)).indexData;
  }

  getAssetId(versionJson: VersionJson): string {
    return versionJson.assets ?? versionJson.assetIndex?.id ?? "legacy";
  }

  private isAssetObjectReady(gameDir: string, entry: AssetIndex["objects"][string]): boolean {
    if (this.checkAssetObject(gameDir, entry)) {
      return true;
    }

    if (!entry.compressedHash || !entry.compressedSize) {
      return false;
    }

    return this.restoreCompressedAsset(gameDir, entry);
  }

  private checkAssetObject(gameDir: string, entry: AssetIndex["objects"][string]): boolean {
    const dest = this.getAssetObjectPath(gameDir, entry.hash);
    if (!fs.existsSync(dest)) {
      return false;
    }

    const stats = fs.statSync(dest);
    if (stats.size !== entry.size) {
      return false;
    }

    return sha1HashSync(dest) === entry.hash;
  }

  private restoreCompressedAsset(gameDir: string, entry: AssetIndex["objects"][string]): boolean {
    const compressedPath = this.getAssetObjectPath(gameDir, entry.compressedHash!);
    if (!fs.existsSync(compressedPath)) {
      return false;
    }

    const stats = fs.statSync(compressedPath);
    if (stats.size !== entry.compressedSize) {
      return false;
    }

    try {
      const restored = gunzipSync(fs.readFileSync(compressedPath));
      const dest = this.getAssetObjectPath(gameDir, entry.hash);
      ensureDirSync(path.dirname(dest));
      fs.writeFileSync(dest, restored);
      return this.checkAssetObject(gameDir, entry);
    } catch {
      return false;
    }
  }

  private getAssetObjectPath(gameDir: string, hash: string): string {
    return path.join(getAssetObjectsDir(gameDir), hash.slice(0, 2), hash);
  }
}
