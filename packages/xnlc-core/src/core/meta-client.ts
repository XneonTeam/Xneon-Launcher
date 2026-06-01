// ============================================================
// XNLC — Meta Client
// Fetches version data from Mojang API
// Author: MAINER4IK
// ============================================================

import { MojangVersionManifest, MojangVersionEntry, VersionJson } from "../types/index.js";
import { URLS } from "../constants/urls.js";
import { PrismMetaClient } from "./prism-meta-client.js";

declare const fetch: typeof globalThis.fetch;

const VERSION_MANIFEST_V2_URL = URLS.official.mojang.versionManifestV2;

export class MetaClient {
  private cache: Map<string, VersionJson> = new Map();
  private manifestCache: MojangVersionManifest | null = null;
  private prismClient: PrismMetaClient;

  constructor() {
    this.prismClient = new PrismMetaClient();
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

    // Try to "Prism-ify" the version data for better stability
    try {
      const prismVersion = await this.prismClient.getVersion("net.minecraft", versionId);
      if (prismVersion) {
        console.log(`[MetaClient] Prism-ifying Minecraft ${versionId} for better stability`);

        // DON'T replace all libraries. Prism's net.minecraft component only contains 
        // the main jar and some specific libraries. Mojang's JSON contains everything.
        // We only want to update libraries that Prism also has (to get their fixed URLs).
        if (prismVersion.libraries && prismVersion.libraries.length > 0) {
          const prismLibs = new Map(prismVersion.libraries.map((lib: any) => [lib.name, lib]));
          
          data.libraries = data.libraries.map(lib => {
            const prismLib = prismLibs.get(lib.name);
            if (prismLib) {
              return {
                ...lib,
                downloads: prismLib.downloads || lib.downloads,
                rules: prismLib.rules || lib.rules,
                natives: prismLib.natives || lib.natives,
                extract: prismLib.extract || lib.extract,
              };
            }
            return lib;
          });

          // Add libraries that are in Prism but NOT in Mojang
          for (const [name, pLib] of prismLibs) {
            if (!data.libraries.some(l => l.name === name)) {
              data.libraries.push({
                name: pLib.name,
                downloads: pLib.downloads,
                rules: pLib.rules,
                natives: pLib.natives,
                extract: pLib.extract,
              });
            }
          }
        }

        // Merge arguments if present
        if (prismVersion.arguments) {
          data.arguments = {
            game: [...(prismVersion.arguments.game || []), ...(data.arguments?.game || [])],
            jvm: [...(prismVersion.arguments.jvm || []), ...(data.arguments?.jvm || [])],
          };
        }

        // Use Prism's mainClass if available
        if (prismVersion.mainClass) {
          data.mainClass = prismVersion.mainClass;
        }

        // Copy traits
        if (prismVersion["+traits"]) {
          (data as any).traits = Array.from(new Set([...((data as any).traits || []), ...prismVersion["+traits"]]));
        }
      }
    } catch (e) {
      console.warn(`[MetaClient] Failed to fetch Prism Meta for Minecraft ${versionId}; using raw Mojang data`);
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
