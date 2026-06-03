// ============================================================
// XNLC — Quilt Handler
// Handles Quilt installation via Prism Meta (Prism Style)
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

export class QuiltHandler implements ILoaderHandler {
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
    const index = await this.prismMetaClient.getIndex("org.quiltmc.quilt-loader");
    return index.versions.map(v => v.version);
  }

  async install(
    mcVersion: string,
    quiltVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[QuiltHandler] Installing Quilt ${quiltVersion} for Minecraft ${mcVersion}`);

    // 1. Fetch Prism Meta for Quilt
    const prismQuilt = await this.prismMetaClient.getVersion("org.quiltmc.quilt-loader", quiltVersion);
    const prismIntermediary = await this.prismMetaClient.getVersion("net.fabricmc.intermediary", mcVersion);

    if (!prismQuilt || !prismIntermediary) {
      throw new Error(`Quilt components not found in Prism Meta for MC ${mcVersion}`);
    }

    // 2. Fetch Base Minecraft JSON
    const baseMcJson = await this.metaClient.fetchVersionJson(mcVersion);
    
    // 3. Prepare profile
    const profileName = `quilt-loader-${quiltVersion}-${mcVersion}`;
    const versionDir = path.join(this.gameDir, "versions", profileName);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

    // 4. Build VersionJson
    const versionJson: VersionJson = {
      ...baseMcJson,
      id: profileName,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "modified",
      mainClass: prismQuilt.mainClass || "org.quiltmc.loader.impl.launch.knot.KnotClient",
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(prismQuilt.libraries || []),
        ...(prismIntermediary.libraries || [])
      ],
      traits: [...(prismQuilt["+traits"] || []), "quilt-loader"]
    };

    if (prismQuilt.arguments) {
      versionJson.arguments = {
        game: [...(prismQuilt.arguments.game || []), ...(baseMcJson.arguments?.game || [])],
        jvm: [...(prismQuilt.arguments.jvm || []), ...(baseMcJson.arguments?.jvm || [])],
      };
    }

    const jsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(versionJson, null, 2));

    return {
      versionId: profileName,
      versionJson,
    };
  }
}
