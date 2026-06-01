import * as path from "path";
import * as fs from "fs";
import {
  LoaderInstallResult,
  DownloadProgressCallback,
  ComponentData,
} from "../types/index.js";
import { Downloader } from "../core/downloader.js";
import { MetaClient } from "../core/meta-client.js";
import { PrismMetaClient } from "../core/prism-meta-client.js";
import { ProfileBuilder } from "../core/profile-builder.js";
import { ensureDirSync, getVersionDir } from "../utils/index.js";

export class ForgeHandler {
  constructor(
    private downloader: Downloader,
    private metaClient: MetaClient,
    private prismMetaClient: PrismMetaClient,
    private gameDir: string,
  ) {}

  async getVersions(mcVersion: string): Promise<string[]> {
    const index = await this.prismMetaClient.getIndex("net.minecraftforge");
    return index.versions
      .filter(v => v.requires.some(r => r.uid === "net.minecraft" && r.equals === mcVersion))
      .map(v => v.version);
  }

  async getSupportedMinecraftVersions(): Promise<string[]> {
    const index = await this.prismMetaClient.getIndex("net.minecraftforge");
    const mcVersions = new Set<string>();
    index.versions.forEach(v => {
      v.requires.forEach(r => {
        if (r.uid === "net.minecraft" && r.equals) mcVersions.add(r.equals);
      });
    });
    return Array.from(mcVersions).sort();
  }

  async getRecommendedVersion(mcVersion: string): Promise<string | null> {
    const index = await this.prismMetaClient.getIndex("net.minecraftforge");
    const compatible = index.versions
      .filter(v => v.requires.some(r => r.uid === "net.minecraft" && r.equals === mcVersion));
    const recommended = compatible.find(v => v.recommended);
    return recommended ? recommended.version : (compatible[0]?.version || null);
  }

  async install(
    mcVersion: string,
    forgeVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    console.log(`[ForgeHandler] Installing Forge ${forgeVersion} for Minecraft ${mcVersion}`);

    const prismForge = await this.prismMetaClient.getVersion("net.minecraftforge", forgeVersion);
    if (!prismForge) {
      throw new Error(`Forge ${forgeVersion} not found in Prism Meta`);
    }

    const baseMcJson = await this.metaClient.fetchVersionJson(mcVersion);

    // Extract FML-specific args from minecraftArguments (avoids duplicating base MC placeholders)
    const forgeGameArgs: string[] = [];
    if (prismForge.arguments?.game) {
      forgeGameArgs.push(...prismForge.arguments.game);
    }
    if (prismForge.minecraftArguments) {
      const parts = prismForge.minecraftArguments.split(/\s+/);
      const fmlIdx = parts.findIndex(p => p === "--launchTarget" || p.startsWith("--fml."));
      if (fmlIdx >= 0) {
        forgeGameArgs.push(...parts.slice(fmlIdx));
      }
    }

    const forgeComponent: ComponentData = {
      uid: "net.minecraftforge",
      version: forgeVersion,
      name: prismForge.name,
      requires: prismForge.requires,
      mainClass: prismForge.mainClass,
      arguments: {
        game: forgeGameArgs.length > 0 ? forgeGameArgs : prismForge.arguments?.game,
        jvm: prismForge.arguments?.jvm,
      },
      libraries: prismForge.libraries,
      jarMods: prismForge.jarMods,
      agents: prismForge.agents,
      mods: prismForge.mods,
      mavenFiles: prismForge.mavenFiles,
      traits: prismForge["+traits"],
      tweakers: prismForge["+tweakers"],
      jvmArgs: prismForge["+jvmArgs"],
      gameArgs: prismForge["+gameArgs"],
      plusLibraries: prismForge["+libraries"],
    };

    // Build full profile from components: net.minecraft + lwjgl3 + forge
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
    const lwjglVersion = await this.prismMetaClient.resolveLwjgl3Version(mcVersion);
    if (lwjglVersion) {
      const lwjglComponent = await this.prismMetaClient.getVersion("org.lwjgl3", lwjglVersion);
      if (lwjglComponent) {
        builder.applyComponent({
          uid: "org.lwjgl3",
          version: lwjglVersion,
          libraries: [...(lwjglComponent.libraries || []), ...((lwjglComponent as any)["+libraries"] || [])],
        });
      }
    }

    // 3. Forge component
    builder.applyComponent(forgeComponent);

    const resolvedJson = builder.build();

    // ForgeWrapper needs to find the Minecraft client jar.
    const mcClientJar = path.join(this.gameDir, "versions", mcVersion, `${mcVersion}.jar`);
    if (!resolvedJson.arguments) resolvedJson.arguments = { game: [], jvm: [] };
    if (!resolvedJson.arguments.jvm) resolvedJson.arguments.jvm = [];
    resolvedJson.arguments.jvm.push(`-Dforgewrapper.minecraft=${mcClientJar.replace(/\\/g, "/")}`);

    const profileName = `forge-${forgeVersion}-${mcVersion}`;
    resolvedJson.id = profileName;
    resolvedJson.releaseTime = prismForge.releaseTime;
    resolvedJson.time = new Date().toISOString();
    resolvedJson.type = "modified";

    // Write the resolved profile to disk for caching
    const versionDir = getVersionDir(this.gameDir, profileName);
    ensureDirSync(versionDir);
    const jsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(resolvedJson, null, 2));

    return {
      versionId: profileName,
      componentData: forgeComponent,
      versionJson: resolvedJson,
    };
  }
}
