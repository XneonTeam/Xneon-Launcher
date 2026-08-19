// ============================================================
// XNLC Mods — FTB (Feed The Beast) API Client
// Minecraft modpack directory: https://api.modpacks.ch
// ============================================================

import type {
  ContentType,
  ModSearchResult,
  ModSearchResponse,
  ModDetails,
  ModVersion,
} from "./types.js";
import type {
  FTBModpackManifest,
  FTBModpackVersionManifest,
  FTBModpacksResult,
  FTBFile,
  FTBVersion,
} from "./ftb-types.js";

const FTB_BASE = "https://api.modpacks.ch";
const MAX_RETRIES = 2;
const MODS_PER_PAGE = 20;

const SEARCH_LIMIT = 8;

const manifestCache = new Map<number, FTBModpackManifest>();

async function ftbFetch(endpoint: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${FTB_BASE}${endpoint}`, {
        headers: { "User-Agent": "XNeon-Launcher/1.0 (launcher@xneon.fun)" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`FTB API ${res.status}: ${res.statusText}`);
      return await res.json();
    } catch (err: any) {
      lastError = err;
      if (err?.name === "AbortError") continue;
      if (attempt >= MAX_RETRIES) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function resolveSlug(man: FTBModpackManifest): string {
  const base = man.name
    ? man.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    : `modpack-${man.id}`;
  return `${man.id}-${base}`;
}

function normalizeFTBProject(man: FTBModpackManifest): ModSearchResult {
  const squareArt = man.art?.find(a => a.type === "square")?.url
    ?? man.art?.[0]?.url
    ?? "";
  return {
    id: String(man.id),
    slug: resolveSlug(man),
    name: man.name,
    summary: man.synopsis ?? "",
    iconUrl: squareArt,
    downloadCount: man.installs ?? 0,
    categories: (man.tags ?? []).map(t => t.name).slice(0, 5),
    source: "ftb",
    author: man.authors?.[0]?.name,
    projectId: String(man.id),
    dateCreated: man.released ? new Date(man.released * 1000).toISOString() : undefined,
    dateModified: man.updated ? new Date(man.updated * 1000).toISOString() : undefined,
  };
}

function normalizeFTBVersion(v: FTBVersion): ModVersion {
  const type = v.type ?? "";
  const versionType: ModVersion["versionType"] =
    type === "beta" ? "beta" : type === "alpha" ? "alpha" : "release";
  return {
    id: `ftb-${v.id}`,
    name: v.name ?? `v${v.id}`,
    gameVersion: "",
    downloadCount: 0,
    fileName: "",
    fileSize: 0,
    versionType,
    datePublished: v.updated ? new Date(v.updated * 1000).toISOString() : "",
  };
}

export function getFTBPath(file: FTBFile): string {
  const name = file.name.startsWith("/") ? file.name.substring(1) : file.name;
  const path = (file.path ?? "").replace("./", "");
  return path + name;
}

// ── Raw API ──────────────────────────────────────────────────

export async function ftbSearchModpacks(keyword: string): Promise<FTBModpacksResult> {
  const data = (await ftbFetch(`/public/modpack/search/${SEARCH_LIMIT}?term=${encodeURIComponent(keyword)}`)) as FTBModpacksResult;
  return { packs: data.packs ?? [], curseforge: data.curseforge ?? [], total: data.total ?? 0, limit: data.limit ?? 0, refreshed: data.refreshed ?? 0 };
}

export async function ftbFeaturedModpacks(): Promise<FTBModpacksResult> {
  const data = (await ftbFetch(`/public/modpack/featured/${SEARCH_LIMIT}`)) as FTBModpacksResult;
  return { packs: data.packs ?? [], curseforge: data.curseforge ?? [], total: data.total ?? 0, limit: data.limit ?? 0, refreshed: data.refreshed ?? 0 };
}

export async function ftbGetModpack(id: number): Promise<FTBModpackManifest | null> {
  const cached = manifestCache.get(id);
  if (cached) return cached;
  try {
    const data = (await ftbFetch(`/public/modpack/${id}`)) as FTBModpackManifest & { status?: string };
    if (!data || typeof data.id !== "number" || data.status === "error") return null;
    manifestCache.set(id, data);
    if (manifestCache.size > 100) {
      const first = manifestCache.keys().next().value;
      if (first != null) manifestCache.delete(first);
    }
    return data;
  } catch {
    return null;
  }
}

export async function ftbGetModpackVersion(id: number, versionId: number): Promise<FTBModpackVersionManifest | null> {
  try {
    const data = (await ftbFetch(`/public/modpack/${id}/${versionId}`)) as FTBModpackVersionManifest & { status?: string };
    if (!data || typeof data.id !== "number" || data.status === "error") return null;
    return data;
  } catch {
    return null;
  }
}

export async function ftbGetModpackChangelog(id: number, versionId: number): Promise<string> {
  try {
    const data = (await ftbFetch(`/public/modpack/${id}/${versionId}/changelog`)) as { content?: string };
    return data.content ?? "";
  } catch {
    return "";
  }
}

// ── Mapped API ───────────────────────────────────────────────

export async function ftbSearch(
  query: string,
  options?: { page?: number; pageSize?: number },
): Promise<ModSearchResponse> {
  const page = options?.page ?? 0;
  const pageSize = options?.pageSize ?? MODS_PER_PAGE;

  try {
    const result = query.trim()
      ? await ftbSearchModpacks(query.trim())
      : await ftbFeaturedModpacks();

    const ids = result.packs ?? [];
    const slice = ids.slice(page * pageSize, (page + 1) * pageSize);
    const manifests = (await Promise.all(slice.map(id => ftbGetModpack(id)))).filter(Boolean) as FTBModpackManifest[];
    return {
      results: manifests.map(normalizeFTBProject),
      totalCount: result.total ?? ids.length,
    };
  } catch (err) {
    console.error("FTB search error:", err);
    return { results: [], totalCount: 0 };
  }
}

export async function ftbGetDetails(id: number): Promise<ModDetails | null> {
  const man = await ftbGetModpack(id);
  if (!man) return null;
  return {
    id: String(man.id),
    slug: resolveSlug(man),
    name: man.name,
    summary: man.synopsis ?? "",
    description: man.description ?? man.synopsis ?? "",
    iconUrl: man.art?.find(a => a.type === "square")?.url ?? man.art?.[0]?.url ?? "",
    downloadCount: man.installs ?? 0,
    categories: (man.tags ?? []).map(t => t.name).slice(0, 5),
    versions: (man.versions ?? []).map(normalizeFTBVersion),
    gallery: (man.art ?? []).map(a => ({ url: a.url, title: a.type })),
    source: "ftb",
    projectId: String(man.id),
  };
}

export async function ftbGetDetailsVersion(id: number, versionId: number): Promise<FTBModpackVersionManifest | null> {
  return ftbGetModpackVersion(id, versionId);
}

// Re-export for IPC convenience
export type { FTBModpacksResult, FTBModpackManifest, FTBModpackVersionManifest, FTBVersion, FTBFile } from "./ftb-types.js";