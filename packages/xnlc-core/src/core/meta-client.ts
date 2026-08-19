// ============================================================
// XNLC — Meta Client
// Fetches version data from Mojang API
// Author: MAINER4IK
// ============================================================

import { MojangVersionManifest, MojangVersionEntry, VersionJson } from "../types/index.js";
import { URLS } from "../constants/urls.js";
import type { LoaderMetaClient } from "./loader-meta-client.js";
import { getLoaderMetaClient } from "./loader-meta-client-singleton.js";
import { withRetry } from "../retry.js";
import * as path from "path";
import * as fs from "fs/promises";

declare const fetch: typeof globalThis.fetch;

const VERSION_MANIFEST_V2_URL = URLS.official.mojang.versionManifestV2;

// Disk TTL cache for the version manifest, so the full Mojang manifest isn't
// re-downloaded on every app start. Directory is provided by the host app via
// the XNLC_META_CACHE_DIR env var (set by the Electron main process).
const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;

function getManifestCacheFile(): string | null {
  const dir = process.env.XNLC_META_CACHE_DIR;
  if (!dir) return null;
  return path.join(dir, "version_manifest_v2.json");
}

async function persistManifest(data: MojangVersionManifest): Promise<void> {
  const file = getManifestCacheFile();
  if (!file) return;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data), "utf-8");
  } catch {
    // ignore cache write failures
  }
}

interface CachedManifest {
  data: MojangVersionManifest;
  fresh: boolean;
}

async function loadCachedManifest(): Promise<CachedManifest | null> {
  const file = getManifestCacheFile();
  if (!file) return null;
  try {
    const stat = await fs.stat(file);
    const data = JSON.parse(await fs.readFile(file, "utf-8")) as MojangVersionManifest;
    return { data, fresh: Date.now() - stat.mtimeMs <= MANIFEST_TTL_MS };
  } catch {
    return null;
  }
}

export class MetaClient {
  private cache: Map<string, VersionJson> = new Map();
  private manifestCache: MojangVersionManifest | null = null;
  private loaderClient: LoaderMetaClient;

  constructor() {
    this.loaderClient = getLoaderMetaClient();
  }

  async fetchManifest(): Promise<MojangVersionManifest> {
    if (this.manifestCache) return this.manifestCache;

    const cached = await loadCachedManifest();
    if (cached?.fresh) {
      this.manifestCache = cached.data;
      return cached.data;
    }

    try {
      const res = await withRetry(async () => fetch(VERSION_MANIFEST_V2_URL));
      if (!res.ok) {
        throw new Error(`Failed to fetch version manifest: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as MojangVersionManifest;
      this.manifestCache = data;
      await persistManifest(data);
      return data;
    } catch (err) {
      // Network is unavailable but we have an older cached manifest — use it
      // as a fallback so installed versions can still be shown and launched offline.
      if (cached?.data) {
        console.warn("[MetaClient] Network unavailable — using stale cached version manifest");
        this.manifestCache = cached.data;
        return cached.data;
      }
      throw err;
    }
  }

  async getVersionEntry(versionId: string): Promise<MojangVersionEntry | undefined> {
    const manifest = await this.fetchManifest();
    return manifest.versions.find((v) => v.id === versionId);
  }

  async fetchVersionJson(versionId: string): Promise<VersionJson> {
    if (this.cache.has(versionId)) {
      return this.cache.get(versionId)!;
    }

    const installedJson = await this.readInstalledVersionJson(versionId);
    if (installedJson) {
      this.cache.set(versionId, installedJson);
      return installedJson;
    }

    const entry = await this.getVersionEntry(versionId);
    if (!entry) {
      throw new Error(`Version "${versionId}" not found in manifest`);
    }

    let data: VersionJson;
    try {
      const res = await withRetry(async () => fetch(entry.url));
      if (!res.ok) {
        throw new Error(`Failed to fetch version JSON for "${versionId}": ${res.status} ${res.statusText}`);
      }
      data = (await res.json()) as VersionJson;
    } catch (err) {
      // Offline: fall back to the locally installed version JSON, if present,
      // so already-downloaded versions can still be launched without a network.
      const fallback = await this.readInstalledVersionJson(versionId);
      if (fallback) {
        this.cache.set(versionId, fallback);
        return fallback;
      }
      throw err;
    }

    // Try to enrich version data with loader meta for better stability
    try {
      const metaVersion = await this.loaderClient.getVersion("net.minecraft", versionId);
      if (metaVersion) {
        console.log(`[MetaClient] Enriching Minecraft ${versionId} with loader meta for better stability`);

        // DON'T replace all libraries. Loader meta net.minecraft component only contains 
        // the main jar and some specific libraries. Mojang's JSON contains everything.
        // We only want to update libraries that loader meta also has (to get their fixed URLs).
        if (metaVersion.libraries && metaVersion.libraries.length > 0) {
          const metaLibs = new Map(metaVersion.libraries.map((lib: any) => [lib.name, lib]));
          
          data.libraries = data.libraries.map(lib => {
            const metaLib = metaLibs.get(lib.name);
            if (metaLib) {
              return {
                ...lib,
                downloads: metaLib.downloads || lib.downloads,
                rules: metaLib.rules || lib.rules,
                natives: metaLib.natives || lib.natives,
                extract: metaLib.extract || lib.extract,
              };
            }
            return lib;
          });

          // Add libraries that are in loader meta but NOT in Mojang
          for (const [name, mLib] of metaLibs) {
            if (!data.libraries.some(l => l.name === name)) {
              data.libraries.push({
                name: mLib.name,
                downloads: mLib.downloads,
                rules: mLib.rules,
                natives: mLib.natives,
                extract: mLib.extract,
              });
            }
          }
        }

        // Merge arguments if present
        if (metaVersion.arguments) {
          data.arguments = {
            game: [...(metaVersion.arguments.game || []), ...(data.arguments?.game || [])],
            jvm: [...(metaVersion.arguments.jvm || []), ...(data.arguments?.jvm || [])],
          };
        }

        // Use loader meta's mainClass if available
        if (metaVersion.mainClass) {
          data.mainClass = metaVersion.mainClass;
        }

        // Copy traits
        if (metaVersion["+traits"]) {
          (data as any).traits = Array.from(new Set([...((data as any).traits || []), ...metaVersion["+traits"]]));
        }
      }
    } catch (e) {
      console.warn(`[MetaClient] Failed to fetch loader meta for Minecraft ${versionId}; using raw Mojang data`);
    }

    this.cache.set(versionId, data);
    return data;
  }

  async getLatestRelease(): Promise<string> {
    const manifest = await this.fetchManifest();
    return manifest.latest.release;
  }

  async getLatestSnapshot(): Promise<string> {
    const manifest = await this.fetchManifest();
    return manifest.latest.snapshot;
  }

  private async readInstalledVersionJson(versionId: string): Promise<VersionJson | null> {
    const root = process.env.XNLC_GAME_DIR;
    if (!root) return null;
    const file = path.join(root, "versions", versionId, `${versionId}.json`);
    try {
      return JSON.parse(await fs.readFile(file, "utf-8")) as VersionJson;
    } catch {
      return null;
    }
  }

  async getVersionsByType(type: string): Promise<MojangVersionEntry[]> {
    const manifest = await this.fetchManifest();
    return manifest.versions.filter((v) => v.type === type);
  }

  async getAllVersions(): Promise<MojangVersionEntry[]> {
    const manifest = await this.fetchManifest();
    return manifest.versions;
  }

  clearCache(): void {
    this.cache.clear();
    this.manifestCache = null;
  }
}
