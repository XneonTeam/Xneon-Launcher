// ============================================================
// XNLC Mods — Modrinth API Client
// Author: MAINER4IK
// ============================================================

import type {
  ContentType,
  ModSort,
  ModLoaderFilter,
  ModSearchResult,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModProjectInfo,
  ModrinthVersionDetail,
  ModCategory,
} from "./types.js";
import { MOD_SORT_OPTIONS, CONTENT_TYPE_FACETS } from "./types.js";

const MODRINTH_API = "https://api.modrinth.com/v2";
const MODS_PER_PAGE = 20;
const MAX_RETRIES = 2;

async function mrFetch(endpoint: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${MODRINTH_API}${endpoint}`, {
        headers: { "User-Agent": "XNeon-Launcher/1.0 (launcher@xneon.fun)" },
        signal: controller.signal,
      });
      if (res.status === 429) {
        clearTimeout(timer);
        const retryAfter = Math.min(Number(res.headers.get("retry-after") ?? "3") || 3, 8);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`Modrinth API ${res.status}: ${res.statusText}`);
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

function normalizeMrProject(item: any): ModSearchResult {
  return {
    id: item.slug ?? item.project_id ?? String(item.id ?? ""),
    slug: item.slug ?? item.project_id ?? "",
    name: item.title ?? "Unknown",
    summary: item.description ?? "",
    iconUrl: item.icon_url ?? "",
    downloadCount: item.downloads ?? 0,
    categories: (item.categories ?? []).slice(0, 5),
    source: "modrinth",
    author: item.author ?? (Array.isArray(item.authors) ? item.authors.map((a: any) => a.user?.username ?? a.name).filter(Boolean).join(", ") : undefined),
    projectId: item.project_id ?? item.slug,
    dateCreated: item.date_created ?? undefined,
    dateModified: item.date_modified ?? undefined,
  };
}

function normalizeMrVersion(v: any): ModVersion {
  return {
    id: v.id ?? "",
    name: v.name ?? v.version_number ?? "",
    gameVersion: (v.game_versions ?? []).join(", "),
    downloadCount: v.downloads ?? 0,
    fileName: v.files?.[0]?.filename ?? "",
    fileSize: v.files?.[0]?.size ?? 0,
    downloadUrl: v.files?.[0]?.url ?? "",
    versionType: v.version_type ?? "release",
    loaders: v.loaders ?? [],
    changelog: v.changelog ?? "",
    datePublished: v.date_published ?? "",
    files: (v.files ?? []).map((f: any) => ({
      url: f.url ?? "",
      size: f.size ?? 0,
      filename: f.filename ?? "",
    })),
    dependencies: (v.dependencies ?? []).map((d: any) => ({
      projectId: d.project_id ?? "",
      versionId: d.version_id ?? null,
      fileName: d.file_name ?? null,
      dependencyType: d.dependency_type ?? "required",
    })),
  };
}

export async function modrinthSearch(
  query: string,
  options?: {
    contentType?: ContentType;
    gameVersion?: string;
    modLoader?: ModLoaderFilter;
    category?: string;
    categories?: string[];
    sortBy?: ModSort;
    page?: number;
  },
): Promise<ModSearchResponse> {
  const contentType = options?.contentType ?? "mod";
  const gameVersion = options?.gameVersion;
  const modLoader = options?.modLoader;
  const categories = options?.categories ?? (options?.category ? [options.category] : []);
  const sortBy = options?.sortBy ?? "downloads";
  const page = options?.page ?? 0;

  const facet = CONTENT_TYPE_FACETS[contentType].facet;
  const facets: string[][] = [[`project_type:${facet}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (modLoader && modLoader !== "vanilla") facets.push([`categories:${modLoader}`]);
  for (const c of categories) {
    if (!c) continue;
    facets.push([`categories:${c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`]);
  }

  const sortOption = MOD_SORT_OPTIONS.find(o => o.id === sortBy);
  const params = new URLSearchParams();
  params.set("query", query.trim());
  params.set("facets", JSON.stringify(facets));
  params.set("index", sortOption?.modrinthIndex ?? "downloads");
  params.set("limit", String(MODS_PER_PAGE));
  params.set("offset", String(page * MODS_PER_PAGE));
  const url = `/search?${params.toString()}`;

  const data = (await mrFetch(url)) as { hits?: any[]; total_hits?: number };
  return {
    results: (data.hits ?? []).map(normalizeMrProject),
    totalCount: data.total_hits ?? 0,
  };
}

export async function modrinthGetDetails(slug: string): Promise<ModDetails | null> {
  try {
    const [projectData, versionsData] = await Promise.all([
      mrFetch(`/project/${slug}`),
      mrFetch(`/project/${slug}/version?limit=100`),
    ]);

    const p = projectData as any;
    const versions = Array.isArray(versionsData) ? versionsData : [];

    return {
      id: p.slug ?? "",
      slug: p.slug ?? "",
      name: p.title ?? "Unknown",
      summary: p.description ?? "",
      description: p.description ?? "",
      iconUrl: p.icon_url ?? "",
      downloadCount: p.downloads ?? 0,
      categories: (p.categories ?? []).slice(0, 5),
      versions: versions.map(normalizeMrVersion),
      gallery: (p.gallery ?? []).map((g: any) => ({ url: g.url ?? "", title: g.title ?? "" })),
      source: "modrinth",
      body: p.body ?? "",
      projectId: p.id ?? p.slug,
    };
  } catch (err) {
    console.error("Modrinth get-details error:", err);
    return null;
  }
}

export async function modrinthGetVersions(slug: string): Promise<ModVersion[]> {
  try {
    const data = (await mrFetch(`/project/${slug}/version?limit=100`)) as any[];
    return (Array.isArray(data) ? data : []).map(normalizeMrVersion);
  } catch {
    return [];
  }
}

export async function modrinthGetProjectInfo(slug: string): Promise<ModProjectInfo | null> {
  try {
    const data = await mrFetch(`/project/${encodeURIComponent(slug)}`) as Record<string, unknown>;
    return {
      name: typeof data.title === "string" ? data.title : slug,
      iconUrl: typeof data.icon_url === "string" ? data.icon_url : "",
      slug: typeof data.slug === "string" ? data.slug : slug,
    };
  } catch {
    return null;
  }
}

export async function modrinthGetRawVersions(slug: string): Promise<ModrinthVersionDetail[]> {
  try {
    const data = (await mrFetch(`/project/${encodeURIComponent(slug)}/version`)) as ModrinthVersionDetail[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function modrinthGetFileByHash(sha1: string): Promise<{ projectId: string; versionId: string } | null> {
  try {
    const data = (await mrFetch(`/version_file/${sha1}`)) as {
      project_id?: string;
      id?: string;
    };
    if (data?.project_id && data?.id) {
      return { projectId: data.project_id, versionId: data.id };
    }
    return null;
  } catch {
    return null;
  }
}

export async function modrinthGetFilesByHash(sha1s: string[]): Promise<Record<string, { projectId: string; versionId: string }>> {
  const result: Record<string, { projectId: string; versionId: string }> = {}
  if (!sha1s.length) return result

  const BATCH_SIZE = 80
  for (let i = 0; i < sha1s.length; i += BATCH_SIZE) {
    const batch = sha1s.slice(i, i + BATCH_SIZE)
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
      try {
        const res = await fetch(`${MODRINTH_API}/version_files`, {
          method: "POST",
          headers: { "User-Agent": "XNeon-Launcher/1.0 (launcher@xneon.fun)", "Content-Type": "application/json" },
          body: JSON.stringify({ hashes: batch, algorithm: "sha1" }),
        })
        if (res.status === 429) {
          const retryAfter = Math.min(Number(res.headers.get("retry-after") ?? "5") || 5, 8)
          await new Promise(r => setTimeout(r, retryAfter * 1000))
          continue
        }
        if (!res.ok) throw new Error(`Modrinth API ${res.status}: ${res.statusText}`)
        const data = (await res.json()) as Record<string, { project_id?: string; id?: string }>
        for (const [sha1, entry] of Object.entries(data)) {
          if (entry?.project_id && entry?.id) {
            result[sha1] = { projectId: entry.project_id, versionId: entry.id }
          }
        }
        break
      } catch (err: any) {
        lastError = err;
        if (attempt >= MAX_RETRIES) {
          console.error("Modrinth getFilesByHash error:", err);
        }
      }
    }
    if (i + BATCH_SIZE < sha1s.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  return result
}

let modrinthCategoriesCache: ModCategory[] | null = null;

export async function modrinthGetCategories(): Promise<ModCategory[]> {
  if (modrinthCategoriesCache) return modrinthCategoriesCache;
  try {
    const data = (await mrFetch("/tag/category")) as any[];
    const categories: ModCategory[] = [];
    const validTypes = new Set<string>(["mod", "modpack", "resourcepack", "shader", "datapack"]);
    for (const cat of data) {
      const pt = String(cat.project_type);
      if (!validTypes.has(pt)) continue;
      categories.push({
        name: cat.name,
        icon: cat.icon ?? "",
        header: cat.header,
        projectType: pt as ContentType,
      });
    }
    modrinthCategoriesCache = categories;
    return categories;
  } catch {
    return [];
  }
}

export async function modrinthGetLoaders(): Promise<string[]> {
  try {
    const data = (await mrFetch("/tag/loader")) as any[];
    return data.map((l: any) => l.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function modrinthGetGameVersions(): Promise<string[]> {
  try {
    const data = (await mrFetch("/tag/game_version")) as string[];
    return Array.isArray(data) ? data.filter(Boolean) : [];
  } catch {
    return [];
  }
}
