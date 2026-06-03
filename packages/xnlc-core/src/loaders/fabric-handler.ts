// ============================================================
// XNLC — Fabric Handler
// Handles Fabric installation via Prism Meta (Prism Style)
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
import type { PrismMetaClient } from "../core/prism-meta-client.js";
import { getPrismMetaClient } from "../core/prism-meta-client-singleton.js";
import { MetaClient } from "../core/meta-client.js";
import type { ILoaderHandler } from "./types.js";

export class FabricHandler implements ILoaderHandler {
  private prismMetaClient: PrismMetaClient;

  constructor(
    private downloader: Downloader,
    private gameDir: string,
    private metaClient: MetaClient,
  ) {
    this.prismMetaClient = getPrismMetaClient();
  }

  async getGameVersions(): Promise<string[]> {
    const index = await this.prismMetaClient.getIndex("net.fabricmc.intermediary");
    return index.versions.map(v => v.version);
  }

  async getLoaderVersionsForGame(mcVersion: string): Promise<string[]> {
    const index = await this.prismMetaClient.getIndex("net.fabricmc.fabric-loader");
    return index.versions.map(v => v.version);
  }

  async install(
    mcVersion: string,
    fabricVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[FabricHandler] Installing Fabric ${fabricVersion} for Minecraft ${mcVersion}`);

    // 1. Fetch Prism Meta for Fabric Loader
    const prismFabric = await this.prismMetaClient.getVersion("net.fabricmc.fabric-loader", fabricVersion);
    const prismIntermediary = await this.prismMetaClient.getVersion("net.fabricmc.intermediary", mcVersion);

    if (!prismFabric || !prismIntermediary) {
      throw new Error(`Fabric components not found in Prism Meta for MC ${mcVersion}`);
    }

    // 2. Fetch Base Minecraft JSON
    const baseMcJson = await this.metaClient.fetchVersionJson(mcVersion);
    
    // 3. Prepare profile
    const profileName = `fabric-loader-${fabricVersion}-${mcVersion}`;
    const versionDir = path.join(this.gameDir, "versions", profileName);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

    // 4. Build VersionJson (Prism Style merging)
    const versionJson: VersionJson = {
      ...baseMcJson,
      id: profileName,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "modified",
      mainClass: prismFabric.mainClass || "net.fabricmc.loader.impl.launch.knot.KnotClient",
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(prismFabric.libraries || []),
        ...(prismIntermediary.libraries || []),
        ...((prismFabric as any)["+libraries"] || []),
      ],
      traits: [...(prismFabric["+traits"] || []), "fabric-loader"]
    };

    // Handle Prism-style arguments (base first, then patch)
    if (prismFabric.arguments) {
      versionJson.arguments = {
        game: [...(baseMcJson.arguments?.game || []), ...(prismFabric.arguments.game || [])],
        jvm: [...(baseMcJson.arguments?.jvm || []), ...(prismFabric.arguments.jvm || [])],
      };
    }

    // Pass raw Prism extensions through for VersionResolver to merge later
    if (prismFabric["+tweakers"]) {
      (versionJson as any)["+tweakers"] = prismFabric["+tweakers"];
    }
    if (prismFabric["+jvmArgs"]) {
      (versionJson as any)["+jvmArgs"] = prismFabric["+jvmArgs"];
    }
    if (prismFabric["+gameArgs"]) {
      (versionJson as any)["+gameArgs"] = prismFabric["+gameArgs"];
    }
    if ((prismFabric as any)["+libraries"]) {
      (versionJson as any)["+libraries"] = (prismFabric as any)["+libraries"];
    }

    const jsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(versionJson, null, 2));

    return {
      versionId: profileName,
      versionJson,
    };
  }
}
