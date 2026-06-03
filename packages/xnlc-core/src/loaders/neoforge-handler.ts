import * as path from "path";
import * as fs from "fs";
import {
  LoaderInstallResult,
  DownloadProgressCallback,
  ComponentData,
} from "../types/index.js";
import { Downloader } from "../core/downloader.js";
import type { LoaderMetaClient } from "../core/loader-meta-client.js";
import { getLoaderMetaClient } from "../core/loader-meta-client-singleton.js";
import { MetaClient } from "../core/meta-client.js";
import { ProfileBuilder } from "../core/profile-builder.js";
import { ensureDirSync, getVersionDir } from "../utils/index.js";
import type { ILoaderHandler } from "./types.js";

export class NeoForgeHandler implements ILoaderHandler {
  private loaderMetaClient: LoaderMetaClient;

  constructor(
    private downloader: Downloader,
    private metaClient: MetaClient,
    private gameDir: string,
  ) {
    this.loaderMetaClient = getLoaderMetaClient();
  }

  async getVersions(mcVersion: string): Promise<string[]> {
    const index = await this.loaderMetaClient.getIndex("net.neoforged");
    return index.versions
      .filter(v => v.requires.some(r => r.uid === "net.minecraft" && r.equals === mcVersion))
      .map(v => v.version);
  }

  async getSupportedMinecraftVersions(): Promise<string[]> {
    const index = await this.loaderMetaClient.getIndex("net.neoforged");
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
    return versions.at(-1) || null;
  }

  async install(
    mcVersion: string,
    neoforgeVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[NeoForgeHandler] Installing NeoForge ${neoforgeVersion} for Minecraft ${mcVersion}`);

    const metaNeo = await this.loaderMetaClient.getVersion("net.neoforged", neoforgeVersion);
    if (!metaNeo) throw new Error(`NeoForge ${neoforgeVersion} not found in loader meta`);

    const baseMcJson = await this.metaClient.fetchVersionJson(mcVersion);

    // Extract FML-specific args from minecraftArguments (avoids duplicating base MC placeholders)
    const forgeGameArgs: string[] = [];
    if (metaNeo.arguments?.game) {
      forgeGameArgs.push(...metaNeo.arguments.game);
    }
    if (metaNeo.minecraftArguments) {
      const parts = metaNeo.minecraftArguments.split(/\s+/);
      const fmlIdx = parts.findIndex(p => p === "--launchTarget" || p.startsWith("--fml."));
      if (fmlIdx >= 0) {
        forgeGameArgs.push(...parts.slice(fmlIdx));
      }
    }

    const neoforgeComponent: ComponentData = {
      uid: "net.neoforged",
      version: neoforgeVersion,
      name: metaNeo.name,
      requires: metaNeo.requires,
      mainClass: metaNeo.mainClass,
      arguments: {
        game: forgeGameArgs.length > 0 ? forgeGameArgs : metaNeo.arguments?.game,
        jvm: metaNeo.arguments?.jvm,
      },
      libraries: metaNeo.libraries,
      jarMods: metaNeo.jarMods,
      agents: metaNeo.agents,
      mods: metaNeo.mods,
      mavenFiles: metaNeo.mavenFiles,
      traits: metaNeo["+traits"],
      tweakers: metaNeo["+tweakers"],
      jvmArgs: metaNeo["+jvmArgs"],
      gameArgs: metaNeo["+gameArgs"],
      plusLibraries: metaNeo["+libraries"],
    };

    // Build full profile from components: net.minecraft + lwjgl3 + neoforge
    const builder = new ProfileBuilder();
    builder.setMinecraftBase(baseMcJson);

    // 1. net.minecraft libraries
    builder.applyComponent({
      uid: "net.minecraft",
      version: mcVersion,
      libraries: baseMcJson.libraries,
      mainClass: baseMcJson.mainClass,
      minecraftArguments: baseMcJson.minecraftArguments,
      arguments: baseMcJson.arguments,
      traits: baseMcJson.traits,
      compatibleJavaMajors: baseMcJson.javaVersion?.majorVersion ? [baseMcJson.javaVersion.majorVersion] : undefined,
    });

    // 2. org.lwjgl3 component (if Minecraft 1.13+)
    const lwjglVersion = await this.loaderMetaClient.resolveLwjgl3Version(mcVersion);
    if (lwjglVersion) {
      const lwjglComponent = await this.loaderMetaClient.getVersion("org.lwjgl3", lwjglVersion);
      if (lwjglComponent) {
        builder.applyComponent({
          uid: "org.lwjgl3",
          version: lwjglVersion,
          libraries: [...(lwjglComponent.libraries || []), ...((lwjglComponent as any)["+libraries"] || [])],
        });
      }
    }

    // 3. NeoForge component
    builder.applyComponent(neoforgeComponent);

    const resolvedJson = builder.build();

    // ForgeWrapper needs to find the Minecraft client jar.
    // XNLC stores it in versions/<mcVersion>/<mcVersion>.jar,
    // but the loader's file detector looks in libraries/com/mojang/minecraft/.
    // Tell it where the jar actually is via system property.
    const mcClientJar = path.join(this.gameDir, "versions", mcVersion, `${mcVersion}.jar`);
    if (!resolvedJson.arguments) resolvedJson.arguments = { game: [], jvm: [] };
    if (!resolvedJson.arguments.jvm) resolvedJson.arguments.jvm = [];
    resolvedJson.arguments.jvm.push(`-Dforgewrapper.minecraft=${mcClientJar.replace(/\\/g, "/")}`);

    const profileName = `neoforge-${neoforgeVersion}-${mcVersion}`;
    resolvedJson.id = profileName;
    resolvedJson.releaseTime = metaNeo.releaseTime;
    resolvedJson.time = new Date().toISOString();
    resolvedJson.type = "modified";

    const versionDir = getVersionDir(this.gameDir, profileName);
    ensureDirSync(versionDir);
    const jsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(resolvedJson, null, 2));

    return {
      versionId: profileName,
      componentData: neoforgeComponent,
      versionJson: resolvedJson,
    };
  }
}
