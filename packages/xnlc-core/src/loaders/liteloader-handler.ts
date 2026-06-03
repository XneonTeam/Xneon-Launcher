// Handles LiteLoader installation via loader meta
// Author: MAINER4IK
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

export class LiteLoaderHandler implements ILoaderHandler {
  private loaderMetaClient: LoaderMetaClient;

  constructor(
    private downloader: Downloader,
    private metaClient: MetaClient,
    private gameDir: string,
  ) {
    this.loaderMetaClient = getLoaderMetaClient();
  }

  async getVersions(mcVersion: string): Promise<string[]> {
    const index = await this.loaderMetaClient.getIndex("com.mumfrey.liteloader");
    return index.versions
      .filter(v => v.requires.some(r => r.uid === "net.minecraft" && r.equals === mcVersion))
      .map(v => v.version);
  }

  async getSupportedMinecraftVersions(): Promise<string[]> {
    const index = await this.loaderMetaClient.getIndex("com.mumfrey.liteloader");
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

    const metaLite = await this.loaderMetaClient.getVersion("com.mumfrey.liteloader", liteloaderVersion);
    if (!metaLite) throw new Error(`LiteLoader ${liteloaderVersion} not found in loader meta`);

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
      mainClass: metaLite.mainClass || baseMcJson.mainClass,
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(metaLite.libraries || []),
        ...(baseMcJson.libraries || [])
      ],
      traits: metaLite["+traits"]
    };

    if (metaLite.arguments) {
      versionJson.arguments = {
        game: [...(metaLite.arguments.game || []), ...(baseMcJson.arguments?.game || [])],
        jvm: [...(metaLite.arguments.jvm || []), ...(baseMcJson.arguments?.jvm || [])],
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
