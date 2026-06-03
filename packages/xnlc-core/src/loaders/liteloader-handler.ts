// ============================================================
// XNLC — LiteLoader Handler
// Handles LiteLoader installation via Prism Meta (Prism Style)
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

export class LiteLoaderHandler implements ILoaderHandler {
  private prismMetaClient: PrismMetaClient;

  constructor(
    private downloader: Downloader,
    private metaClient: MetaClient,
    private gameDir: string,
  ) {
    this.prismMetaClient = getPrismMetaClient();
  }

  async getVersions(mcVersion: string): Promise<string[]> {
    const index = await this.prismMetaClient.getIndex("com.mumfrey.liteloader");
    return index.versions
      .filter(v => v.requires.some(r => r.uid === "net.minecraft" && r.equals === mcVersion))
      .map(v => v.version);
  }

  async getSupportedMinecraftVersions(): Promise<string[]> {
    const index = await this.prismMetaClient.getIndex("com.mumfrey.liteloader");
    const mcVersions = new Set<string>();
    index.versions.forEach(v => {
      v.requires.forEach(r => {
        if (r.uid === "net.minecraft" && r.equals) mcVersions.add(r.equals);
      });
    });
    return Array.from(mcVersions).sort();
  }

  async getRecommendedVersion(mcVersion: string): Promise<string | null> {
    const versions = await this.getVersions(mcVersion);
    return versions[0] || null;
  }

  async install(
    mcVersion: string,
    liteloaderVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[LiteLoaderHandler] Installing LiteLoader ${liteloaderVersion} for Minecraft ${mcVersion}`);

    const prismLite = await this.prismMetaClient.getVersion("com.mumfrey.liteloader", liteloaderVersion);
    if (!prismLite) throw new Error(`LiteLoader ${liteloaderVersion} not found in Prism Meta`);

    const baseMcJson = await this.metaClient.fetchVersionJson(mcVersion);
    
    const profileName = `liteloader-${liteloaderVersion}-${mcVersion}`;
    const versionDir = path.join(this.gameDir, "versions", profileName);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

    const versionJson: VersionJson = {
      ...baseMcJson,
      id: profileName,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "modified",
      mainClass: prismLite.mainClass || baseMcJson.mainClass,
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(prismLite.libraries || []),
        ...(baseMcJson.libraries || [])
      ],
      traits: prismLite["+traits"]
    };

    if (prismLite.arguments) {
      versionJson.arguments = {
        game: [...(prismLite.arguments.game || []), ...(baseMcJson.arguments?.game || [])],
        jvm: [...(prismLite.arguments.jvm || []), ...(baseMcJson.arguments?.jvm || [])],
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
