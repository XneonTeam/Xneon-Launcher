// ============================================================
// XNLC — Fabric Handler
// Handles Fabric installation via loader meta
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import * as fs from "fs";
import { 
  LoaderInstallResult, 
  DownloadProgressCallback, 
  VersionJson 
} from "../types/index.js";
import { Downloader } from "../core/downloader.js";
import type { LoaderMetaClient } from "../core/loader-meta-client.js";
import { getLoaderMetaClient } from "../core/loader-meta-client-singleton.js";
import { MetaClient } from "../core/meta-client.js";
import type { ILoaderHandler } from "./types.js";

export class FabricHandler implements ILoaderHandler {
  private loaderMetaClient: LoaderMetaClient;

  constructor(
    private downloader: Downloader,
    private gameDir: string,
    private metaClient: MetaClient,
  ) {
    this.loaderMetaClient = getLoaderMetaClient();
  }

  async getGameVersions(): Promise<string[]> {
    const index = await this.loaderMetaClient.getIndex("net.fabricmc.intermediary");
    return index.versions.map(v => v.version);
  }

  async getLoaderVersionsForGame(mcVersion: string): Promise<string[]> {
    const index = await this.loaderMetaClient.getIndex("net.fabricmc.fabric-loader");
    return index.versions.map(v => v.version);
  }

  async install(
    mcVersion: string,
    fabricVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[FabricHandler] Installing Fabric ${fabricVersion} for Minecraft ${mcVersion}`);

    // 1. Fetch loader meta for Fabric Loader
    const metaFabric = await this.loaderMetaClient.getVersion("net.fabricmc.fabric-loader", fabricVersion);
    const metaIntermediary = await this.loaderMetaClient.getVersion("net.fabricmc.intermediary", mcVersion);

    if (!metaFabric || !metaIntermediary) {
      throw new Error(`Fabric components not found in loader meta for MC ${mcVersion}`);
    }

    // 2. Fetch Base Minecraft JSON
    const baseMcJson = await this.metaClient.fetchVersionJson(mcVersion);
    
    // 3. Prepare profile
    const profileName = `fabric-loader-${fabricVersion}-${mcVersion}`;
    const versionDir = path.join(this.gameDir, "versions", profileName);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

    // 4. Build VersionJson (loader-style merging)
    const versionJson: VersionJson = {
      ...baseMcJson,
      id: profileName,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "modified",
      mainClass: metaFabric.mainClass || "net.fabricmc.loader.impl.launch.knot.KnotClient",
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(metaFabric.libraries || []),
        ...(metaIntermediary.libraries || []),
        ...((metaFabric as any)["+libraries"] || []),
      ],
      traits: [...(metaFabric["+traits"] || []), "fabric-loader"]
    };

    // Handle loader-style arguments (base first, then patch)
    if (metaFabric.arguments) {
      versionJson.arguments = {
        game: [...(baseMcJson.arguments?.game || []), ...(metaFabric.arguments.game || [])],
        jvm: [...(baseMcJson.arguments?.jvm || []), ...(metaFabric.arguments.jvm || [])],
      };
    }

    // Pass raw loader extensions through for VersionResolver to merge later
    if (metaFabric["+tweakers"]) {
      (versionJson as any)["+tweakers"] = metaFabric["+tweakers"];
    }
    if (metaFabric["+jvmArgs"]) {
      (versionJson as any)["+jvmArgs"] = metaFabric["+jvmArgs"];
    }
    if (metaFabric["+gameArgs"]) {
      (versionJson as any)["+gameArgs"] = metaFabric["+gameArgs"];
    }
    if ((metaFabric as any)["+libraries"]) {
      (versionJson as any)["+libraries"] = (metaFabric as any)["+libraries"];
    }

    const jsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(versionJson, null, 2));

    return {
      versionId: profileName,
      versionJson,
    };
  }
}
