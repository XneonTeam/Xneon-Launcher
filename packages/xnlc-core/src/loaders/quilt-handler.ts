// Handles Quilt installation via loader meta
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

export class QuiltHandler implements ILoaderHandler {
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
    const index = await this.loaderMetaClient.getIndex("org.quiltmc.quilt-loader");
    return index.versions.map(v => v.version);
  }

  async install(
    mcVersion: string,
    quiltVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[QuiltHandler] Installing Quilt ${quiltVersion} for Minecraft ${mcVersion}`);

    // 1. Fetch loader meta for Quilt
    const metaQuilt = await this.loaderMetaClient.getVersion("org.quiltmc.quilt-loader", quiltVersion);
    const metaIntermediary = await this.loaderMetaClient.getVersion("net.fabricmc.intermediary", mcVersion);

    if (!metaQuilt || !metaIntermediary) {
      throw new Error(`Quilt components not found in loader meta for MC ${mcVersion}`);
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
      mainClass: metaQuilt.mainClass || "org.quiltmc.loader.impl.launch.knot.KnotClient",
      inheritsFrom: mcVersion,
      jar: mcVersion,
      libraries: [
        ...(metaQuilt.libraries || []),
        ...(metaIntermediary.libraries || [])
      ],
      traits: [...(metaQuilt["+traits"] || []), "quilt-loader"]
    };

    if (metaQuilt.arguments) {
      versionJson.arguments = {
        game: [...(metaQuilt.arguments.game || []), ...(baseMcJson.arguments?.game || [])],
        jvm: [...(metaQuilt.arguments.jvm || []), ...(baseMcJson.arguments?.jvm || [])],
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
