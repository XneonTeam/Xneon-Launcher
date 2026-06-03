// ============================================================
// XNLC — Loader Meta Client
// Client for component metadata (version manifests, libraries)
// ============================================================

import { URLS } from "../constants/urls.js";
import { LoaderMetaIndex, LoaderMetaVersion } from "../types/index.js";

declare const fetch: typeof globalThis.fetch;

export class LoaderMetaClient {
  private baseUrl: string = URLS.official.loader.meta;

  async getIndex(uid: string): Promise<LoaderMetaIndex> {
    const res = await fetch(`${this.baseUrl}/${uid}/index.json`);
    if (!res.ok) throw new Error(`Failed to fetch component index for ${uid}: ${res.status}`);
    return res.json() as Promise<LoaderMetaIndex>;
  }

  async getVersion(uid: string, version: string): Promise<LoaderMetaVersion> {
    const res = await fetch(`${this.baseUrl}/${uid}/${version}.json`);
    if (!res.ok) throw new Error(`Failed to fetch component version ${uid}:${version}: ${res.status}`);
    return res.json() as Promise<LoaderMetaVersion>;
  }

  async resolveLwjgl3Version(mcVersion: string): Promise<string | null> {
    const index = await this.getIndex("net.minecraft");
    const entry = index.versions.find(v => v.version === mcVersion);
    if (!entry) return null;
    const lwjglReq = entry.requires.find(r => r.uid === "org.lwjgl3");
    if (!lwjglReq) return null;
    return lwjglReq.suggests || lwjglReq.equals || null;
  }

  async fetchLwjgl3Component(mcVersion: string): Promise<{ libraries: any[]; version: string } | null> {
    const lwjglVersion = await this.resolveLwjgl3Version(mcVersion);
    if (!lwjglVersion) return null;
    const component = await this.getVersion("org.lwjgl3", lwjglVersion);
    return {
      libraries: [...(component.libraries || []), ...((component as any)["+libraries"] || [])],
      version: lwjglVersion,
    };
  }
}
