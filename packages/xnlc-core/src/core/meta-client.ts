// ============================================================
// XNLC — Meta Client
// Fetches version data from Mojang API
// Author: MAINER4IK
// ============================================================

import { MojangVersionManifest, MojangVersionEntry, VersionJson } from "../types/index.js";
import { URLS } from "../constants/urls.js";
import type { LoaderMetaClient } from "./loader-meta-client.js";
import { getLoaderMetaClient } from "./loader-meta-client-singleton.js";

declare const fetch: typeof globalThis.fetch;

const VERSION_MANIFEST_V2_URL = URLS.official.mojang.versionManifestV2;

export class MetaClient {
  private cache: Map<string, VersionJson> = new Map();
  private manifestCache: MojangVersionManifest | null = null;
  private loaderClient: LoaderMetaClient;

  constructor() {
    this.loaderClient = getLoaderMetaClient();
  }

  async fetchManifest(): Promise<MojangVersionManifest> {
    if (this.manifestCache) return this.manifestCache;

    const res = await fetch(VERSION_MANIFEST_V2_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch version manifest: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as MojangVersionManifest;
    this.manifestCache = data;
    return data;
  }

  async getVersionEntry(versionId: string): Promise<MojangVersionEntry | undefined> {
    const manifest = await this.fetchManifest();
    return manifest.versions.find((v) => v.id === versionId);
  }

  async fetchVersionJson(versionId: string): Promise<VersionJson> {
    if (this.cache.has(versionId)) {
      return this.cache.get(versionId)!;
    }

    const entry = await this.getVersionEntry(versionId);
    if (!entry) {
      throw new Error(`Version "${versionId}" not found in manifest`);
    }

    const res = await fetch(entry.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch version JSON for "${versionId}": ${res.status} ${res.statusText}`);
    }

    let data = (await res.json()) as VersionJson;

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
