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
} from "./types.js";
import { MOD_SORT_OPTIONS, CONTENT_TYPE_FACETS } from "./types.js";

const MODRINTH_API = "https://api.modrinth.com/v2";
const MODS_PER_PAGE = 10;

async function mrFetch(endpoint: string): Promise<unknown> {
  const res = await fetch(`${MODRINTH_API}${endpoint}`, {
    headers: { "User-Agent": "XNeon-Launcher/1.0 (launcher@xneon.fun)" },
  });
  if (!res.ok) throw new Error(`Modrinth API ${res.status}: ${res.statusText}`);
  return await res.json();
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
    sortBy?: ModSort;
    page?: number;
  },
): Promise<ModSearchResponse> {
  const contentType = options?.contentType ?? "mod";
  const gameVersion = options?.gameVersion;
  const modLoader = options?.modLoader;
  const category = options?.category;
  const sortBy = options?.sortBy ?? "downloads";
  const page = options?.page ?? 0;

  const facet = CONTENT_TYPE_FACETS[contentType].facet;
  const facets: string[][] = [[`project_type:${facet}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (modLoader && modLoader !== "vanilla") facets.push([`categories:${modLoader}`]);
  if (category && category !== "all") facets.push([`categories:${category}`]);

  const sortOption = MOD_SORT_OPTIONS.find(o => o.id === sortBy);
  const url = `/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${sortOption?.modrinthIndex ?? "downloads"}&limit=${MODS_PER_PAGE}&offset=${page * MODS_PER_PAGE}`;

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

export async function modrinthCategories(
  options?: {
    contentType?: ContentType;
  },
): Promise<Array<{ slug: string; name: string }>> {
  try {
    const contentType = options?.contentType ?? "mod";
    const facet = CONTENT_TYPE_FACETS[contentType].facet;
    const data = (await mrFetch("/tag/category")) as Array<{
      name?: string;
      project_type?: string;
      header?: string;
    }>;

    return (Array.isArray(data) ? data : [])
      .filter((entry) => !entry.header)
      .filter((entry) => !entry.project_type || entry.project_type === facet)
      .map((entry) => {
        const rawName = String(entry.name ?? "").trim();
        return { slug: rawName, name: rawName };
      })
      .filter((entry) => entry.slug.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error("Modrinth categories error:", err);
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
