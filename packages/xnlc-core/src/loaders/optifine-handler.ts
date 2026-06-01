// ============================================================
// XNLC — OptiFine Handler
// Ports OptiFine install flow to XNLC
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type {
  LoaderInstallResult,
  DownloadProgressCallback,
  VersionJson,
  VersionJsonLibrary,
  InstallationPhase,
} from "../types/index.js";
import { Downloader } from "../core/downloader.js";
import { MetaClient } from "../core/meta-client.js";
import { ensureDirSync, getLibraryDir, getVersionDir } from "../utils/index.js";
import { URLS } from "../constants/urls.js";

const OPTIFINE_BASE = URLS.official.optifine.root;
const LAUNCHWRAPPER_URL = `${URLS.official.mojang.libraries}/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar`;
const LAUNCHWRAPPER_PATH = "net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar";
const MAIN_CLASS = "net.minecraft.launchwrapper.Launch";

const OPTIFINE_FILE_RE = /(?:preview_)?OptiFine_(\d+\.\d+(?:\.\d+)?)_([A-Z0-9_]+?)_([A-Z0-9]+)\.jar/i;

export interface OptifineVersion {
  mcVersion: string;
  edition: string;
  release: string;
  filename: string;
  downloadUrl: string;
  isPreview: boolean;
}

interface OptifineInstallerInfo {
  mcVersion: string;
  edition: string;
  release: string;
  filename: string;
  downloadUrl: string;
  isPreview: boolean;
  launchWrapperVersion?: string;
}

export function parseOptifineFilename(name: string): Omit<OptifineVersion, "downloadUrl"> | null {
  const match = name.match(OPTIFINE_FILE_RE);
  if (!match) return null;

  return {
    mcVersion: match[1]!,
    edition: match[2]!,
    release: match[3]!,
    filename: name,
    isPreview: name.startsWith("preview_"),
  };
}

export function optifineVersionId(mcVersion: string, filename: string): string {
  const parsed = parseOptifineFilename(filename);
  if (!parsed) {
    throw new Error(`Invalid OptiFine filename: ${filename}`);
  }
  if (parsed.mcVersion !== mcVersion) {
    throw new Error(`OptiFine filename Minecraft mismatch: expected ${mcVersion}, got ${parsed.mcVersion}`);
  }
  return `${mcVersion}-OptiFine_${parsed.edition}_${parsed.release}`;
}

export class OptifineHandler {
  constructor(
    private downloader: Downloader,
    private metaClient: MetaClient,
    private gameDir: string,
  ) {}

  /**
   * Fetch the OptiFine downloads page once and return all unique
   * Minecraft versions that have at least one OptiFine build available
   * (e.g. "1.7.10", "1.12.2", "1.16.5", …).
   *
   * Ported from optifine-utils getVersions() — single HTTP request
   * instead of per-mc-version polling.
   */
  async getSupportedVersions(): Promise<string[]> {
    const res = await fetch(URLS.official.optifine.downloads);
    if (!res.ok) {
      throw new Error(`Failed to fetch OptiFine downloads: ${res.status}`);
    }

    const html = await res.text();
    const linkRe = /adloadx\?f=([^"&]+)/g;
    const seen = new Set<string>();
    const mcVersions: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(html)) !== null) {
      const raw = decodeURIComponent(match[1]!);
      const parsed = parseOptifineFilename(raw);
      if (!parsed) continue;

      if (!seen.has(parsed.mcVersion)) {
        seen.add(parsed.mcVersion);
        mcVersions.push(parsed.mcVersion);
      }
    }

    return mcVersions;
  }

  /**
   * Fetch the OptiFine downloads page once and return ALL available
   * OptiFine builds across every Minecraft version.
   *
   * Ported from optifine-utils getVersions() — single HTTP request.
   */
  async getAllVersions(): Promise<OptifineVersion[]> {
    const res = await fetch(URLS.official.optifine.downloads);
    if (!res.ok) {
      throw new Error(`Failed to fetch OptiFine downloads: ${res.status}`);
    }

    const html = await res.text();
    const linkRe = /adloadx\?f=([^"&]+)/g;
    const seen = new Set<string>();
    const versions: OptifineVersion[] = [];

    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(html)) !== null) {
      const raw = decodeURIComponent(match[1]!);
      if (seen.has(raw)) continue;
      seen.add(raw);

      const parsed = parseOptifineFilename(raw);
      if (!parsed) continue;

      versions.push({
        ...parsed,
        downloadUrl: `${OPTIFINE_BASE}/download?f=${encodeURIComponent(raw)}`,
      });
    }

    return versions;
  }

  async getVersions(mcVersion: string): Promise<OptifineVersion[]> {
    const res = await fetch(URLS.official.optifine.downloads);
    if (!res.ok) {
      throw new Error(`Failed to fetch OptiFine downloads: ${res.status}`);
    }

    const html = await res.text();
    const linkRe = /adloadx\?f=([^"&]+)/g;
    const seen = new Set<string>();
    const versions: OptifineVersion[] = [];

    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(html)) !== null) {
      const raw = decodeURIComponent(match[1]!);
      if (seen.has(raw)) continue;
      seen.add(raw);

      const parsed = parseOptifineFilename(raw);
      if (!parsed || parsed.mcVersion !== mcVersion) continue;

      versions.push({
        ...parsed,
        downloadUrl: `${OPTIFINE_BASE}/download?f=${encodeURIComponent(raw)}`,
      });
    }

    return versions;
  }

  async getRecommendedVersion(mcVersion: string): Promise<OptifineVersion | undefined> {
    return this.findVersion(mcVersion, (version) => !version.isPreview);
  }

  async getLatestVersion(mcVersion: string): Promise<OptifineVersion | undefined> {
    return this.findVersion(mcVersion, () => true);
  }

  private withPhase(phase: InstallationPhase, onProgress?: DownloadProgressCallback): DownloadProgressCallback | undefined {
    if (!onProgress) return undefined;
    return (progress) => onProgress({ ...progress, installationPhase: phase });
  }

  async install(
    mcVersion: string,
    loaderVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    const info = await this.resolveInstallerInfo(mcVersion, loaderVersion);
    const profileName = optifineVersionId(info.mcVersion, info.filename);
    const versionDir = getVersionDir(this.gameDir, profileName);
    ensureDirSync(versionDir);
    const installerDest = await this.ensureInstallerDownloaded(info, this.withPhase("downloading-installer", onProgress));

    info.launchWrapperVersion = await this.detectLaunchwrapperVersion(installerDest, info.launchWrapperVersion);

    const vanilla = await this.metaClient.fetchVersionJson(mcVersion);
    const vanillaClientPath = await this.ensureVanillaClientJar(mcVersion, vanilla, this.withPhase("downloading-client", onProgress));

    const versionJson = this.buildVersionJson(info, vanilla);
    const versionJsonPath = path.join(versionDir, `${profileName}.json`);
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));

    await this.extractBundledLaunchwrapper(installerDest, info.launchWrapperVersion);
    await this.patchClientJar(installerDest, vanillaClientPath, path.join(versionDir, `${profileName}.jar`));

    return {
      versionJson,
      versionId: profileName,
    };
  }

  private async ensureInstallerDownloaded(
    info: OptifineInstallerInfo,
    onProgress?: DownloadProgressCallback,
  ): Promise<string> {
    const installerDest = path.join(this.gameDir, "installers", "optifine", info.filename);
    ensureDirSync(path.dirname(installerDest));
    if (!fs.existsSync(installerDest)) {
      await this.downloader.download({
        url: info.downloadUrl,
        dest: installerDest,
        onProgress,
      });
    }
    return installerDest;
  }

  private async ensureVanillaClientJar(
    mcVersion: string,
    vanilla: VersionJson,
    onProgress?: DownloadProgressCallback,
  ): Promise<string> {
    const vanillaClientPath = path.join(getVersionDir(this.gameDir, mcVersion), `${mcVersion}.jar`);
    ensureDirSync(path.dirname(vanillaClientPath));
    if (fs.existsSync(vanillaClientPath)) {
      return vanillaClientPath;
    }

    const clientUrl = vanilla.downloads?.client?.url;
    if (!clientUrl) {
      throw new Error(`No vanilla client download found for Minecraft ${mcVersion}`);
    }

    await this.downloader.download({
      url: clientUrl,
      dest: vanillaClientPath,
      sha1: vanilla.downloads?.client?.sha1,
      size: vanilla.downloads?.client?.size,
      onProgress,
    });

    return vanillaClientPath;
  }

  private async resolveInstallerInfo(mcVersion: string, loaderVersion: string): Promise<OptifineInstallerInfo> {
    const versions = await this.getVersions(mcVersion);
    const matched = versions.find((version) =>
      version.filename === loaderVersion
      || `${version.edition}_${version.release}` === loaderVersion
      || version.release === loaderVersion,
    );
    if (matched) return { ...matched };

    const parsed = parseOptifineFilename(loaderVersion);
    if (parsed && parsed.mcVersion === mcVersion) {
      return {
        ...parsed,
        downloadUrl: `${OPTIFINE_BASE}/download?f=${encodeURIComponent(loaderVersion)}`,
        launchWrapperVersion: undefined,
      };
    }

    throw new Error(`OptiFine version not found for Minecraft ${mcVersion}: ${loaderVersion}`);
  }

  private async findVersion(
    mcVersion: string,
    predicate: (version: OptifineVersion) => boolean,
  ): Promise<OptifineVersion | undefined> {
    return (await this.getVersions(mcVersion)).find(predicate);
  }

  private async extractBundledLaunchwrapper(installerJar: string, launchWrapperVersion?: string): Promise<void> {
    const AdmZip = (await import("adm-zip/adm-zip.js")).default;
    const zip = new AdmZip(installerJar);

    const bundleVersion = launchWrapperVersion?.trim();
    const candidates = bundleVersion
      ? [
          `launchwrapper-of-${bundleVersion}.jar`,
          `optifine/launchwrapper-of-${bundleVersion}.jar`,
        ]
      : [];
    candidates.push(
      "launchwrapper-of.jar",
      "optifine/launchwrapper-of.jar",
    );

    const entryName = candidates.find((name) => zip.getEntry(name));
    if (!entryName) {
      return;
    }

    const versionFromEntry = entryName.match(/launchwrapper-of-([^.]+)\.jar$/)?.[1]?.trim();
    const resolvedVersion = bundleVersion || versionFromEntry;
    const dest = resolvedVersion
      ? path.join(getLibraryDir(this.gameDir), "optifine", "launchwrapper", resolvedVersion, `launchwrapper-${resolvedVersion}.jar`)
      : path.join(getLibraryDir(this.gameDir), LAUNCHWRAPPER_PATH);

    ensureDirSync(path.dirname(dest));
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, zip.getEntry(entryName)!.getData());
    }
  }

  private async detectLaunchwrapperVersion(installerJar: string, fallback?: string): Promise<string | undefined> {
    const AdmZip = (await import("adm-zip/adm-zip.js")).default;
    const zip = new AdmZip(installerJar);

    const versionEntry = zip.getEntry("launchwrapper-of.txt") ?? zip.getEntry("optifine/launchwrapper-of.txt");
    if (versionEntry) {
      const version = zip.readAsText(versionEntry).trim();
      if (version) {
        return version;
      }
    }

    const bundledJar = zip.getEntries().find((entry) => /(?:^|\/)launchwrapper-of-[^.]+\.jar$/.test(entry.entryName));
    const versionFromEntry = bundledJar?.entryName.match(/launchwrapper-of-([^.]+)\.jar$/)?.[1]?.trim();
    return versionFromEntry || fallback;
  }

  private buildVersionJson(info: OptifineInstallerInfo, vanilla: VersionJson): VersionJson {
    const id = optifineVersionId(info.mcVersion, info.filename);
    const isLegacy = !!vanilla.minecraftArguments;
    const tweakClass = "optifine.OptiFineTweaker";

    return {
      ...vanilla,
      id,
      inheritsFrom: info.mcVersion,
      mainClass: MAIN_CLASS,
      jar: id,
      type: "release",
      javaVersion: isLegacy
        ? { component: "jre-legacy", majorVersion: 8 }
        : vanilla.javaVersion,
      minecraftArguments: isLegacy
        ? `${vanilla.minecraftArguments ?? ""} --tweakClass ${tweakClass}`.trim()
        : undefined,
      arguments: !isLegacy
        ? {
            game: ["--tweakClass", tweakClass],
          }
        : undefined,
      libraries: [
        this.buildOptifineLibrary(info),
        this.buildLaunchwrapperLibrary(info.launchWrapperVersion),
        ...(vanilla.libraries ?? []),
      ],
    };
  }

  private buildOptifineLibrary(info: OptifineInstallerInfo): VersionJsonLibrary {
    const version = `${info.mcVersion}_${info.edition}_${info.release}`;
    return {
      name: `optifine:OptiFine:${version}`,
      downloads: {
        artifact: {
          url: info.downloadUrl,
          path: path.join("optifine", "OptiFine", version, `OptiFine-${version}.jar`),
          sha1: "",
          size: 0,
        },
      },
    };
  }

  private buildLaunchwrapperLibrary(launchWrapperVersion?: string): VersionJsonLibrary {
    if (!launchWrapperVersion) {
      return {
        name: "net.minecraft:launchwrapper:1.12",
        downloads: {
          artifact: {
            url: LAUNCHWRAPPER_URL,
            path: LAUNCHWRAPPER_PATH,
            sha1: "",
            size: 0,
          },
        },
      };
    }

    return {
      name: `optifine:launchwrapper:${launchWrapperVersion}`,
      downloads: {
        artifact: {
          url: LAUNCHWRAPPER_URL,
          path: path.join("optifine", "launchwrapper", launchWrapperVersion, `launchwrapper-${launchWrapperVersion}.jar`),
          sha1: "",
          size: 0,
        },
      },
    };
  }

  private async patchClientJar(installerJar: string, vanillaClientJar: string, outputJar: string): Promise<void> {
    if (fs.existsSync(outputJar)) {
      return;
    }

    const javaPath = "java";
    execFileSync(javaPath, [
      "-cp",
      installerJar,
      "optifine.Patcher",
      vanillaClientJar,
      installerJar,
      outputJar,
    ], {
      stdio: "inherit",
      timeout: 300000,
    });

    if (!fs.existsSync(outputJar)) {
      throw new Error("OptiFine patcher completed but output jar was not created");
    }
  }
}
