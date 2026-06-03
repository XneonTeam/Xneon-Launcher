// ============================================================
// XNLC Mods — CurseForge API Client
// Author: MAINER4IK
// ============================================================

import type {
  ContentType,
  ModSort,
  ModSearchResult,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  ModProjectInfo,
} from "./types.js";
import { MOD_SORT_OPTIONS, CONTENT_TYPE_FACETS } from "./types.js";

const CF_API_KEY = process.env.CF_API_KEY || "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm";
const CF_BASE = "https://api.curseforge.com/v1";
const CF_GAME_ID_MINECRAFT = 432;
const MODS_PER_PAGE = 10;
let cfCategoriesCache: Array<{ id: number; slug: string; name: string }> | null = null;

const CF_MOD_LOADER_TYPES: Record<string, number> = {
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

export async function cfFetch(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${CF_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { "x-api-key": CF_API_KEY } });
  if (!res.ok) throw new Error(`CF API ${res.status}: ${res.statusText}`);
  return await res.json();
}

function normalizeCFCategories(categories: unknown[]): string[] {
  return categories?.map((c: any) => c.name ?? c.slug ?? "").filter(Boolean) ?? [];
}

function detectCFLoaders(gameVersions: unknown[]): string[] {
  const values = Array.isArray(gameVersions) ? gameVersions : [];
  const loaders = new Set<string>();

  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "fabric") loaders.add("fabric");
    if (normalized === "quilt") loaders.add("quilt");
    if (normalized === "neoforge" || normalized === "neo forge") loaders.add("neoforge");
  }

  return Array.from(loaders);
}

async function getCachedCFCategories(contentType?: ContentType): Promise<Array<{ id: number; slug: string; name: string }>> {
  const cacheKey = contentType ?? "all";
  if (cfCategoriesCache && cacheKey === "all") {
    return cfCategoriesCache;
  }

  const params: Record<string, string> = { gameId: String(CF_GAME_ID_MINECRAFT) };
  if (contentType) {
    params.classId = String(CONTENT_TYPE_FACETS[contentType].cfClassId);
  }

  const data = (await cfFetch("/mods/categories", params)) as {
    data?: Array<{ id: number; slug: string; name: string }>;
  };
  const normalized = (data.data ?? []).map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
  }));
  if (cacheKey === "all") {
    cfCategoriesCache = normalized;
  }
  return normalized;
}

async function resolveCFCategoryId(category: string, contentType?: ContentType): Promise<number | null> {
  const normalized = category.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return null;
  }

  const categories = await getCachedCFCategories(contentType);
  const match = categories.find((entry) => (
    entry.slug.toLowerCase() === normalized || entry.name.toLowerCase() === normalized
  ));
  return match?.id ?? null;
}

function normalizeCFSearchItem(item: any): ModSearchResult {
  const primaryFile = item.latestFiles?.find((f: any) => f.isAvailable) ?? item.latestFiles?.[0];
  return {
    id: `cf-${item.id}`,
    slug: item.slug ?? item.name?.toLowerCase().replace(/\s+/g, "-") ?? `mod-${item.id}`,
    name: item.name ?? "Unknown",
    summary: item.summary ?? "",
    iconUrl: item.links?.iconUrl ?? item.logo?.thumbnailUrl ?? "",
    downloadCount: item.downloadCount ?? 0,
    categories: normalizeCFCategories(item.categories ?? []).slice(0, 5),
    source: "curseforge",
    author: Array.isArray(item.authors) ? item.authors.map((a: any) => a.name).filter(Boolean).join(", ") : undefined,
    modId: item.id,
    primaryFileId: primaryFile?.id ?? 0,
    primaryFileName: primaryFile?.fileName ?? "",
    fileSize: primaryFile?.fileLength ?? 0,
    dateCreated: item.dateCreated ?? primaryFile?.fileDate ?? undefined,
    dateModified: item.dateModified ?? primaryFile?.fileDate ?? undefined,
  };
}

function sortCFSearchItems(items: any[], sortBy: ModSort): any[] {
  const sorted = [...items];

  switch (sortBy) {
    case "downloads":
      sorted.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));
      break;
    case "popular":
      sorted.sort((a, b) => {
        const aRank = a.gamePopularityRank ?? Number.MAX_SAFE_INTEGER;
        const bRank = b.gamePopularityRank ?? Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
      });
      break;
    case "updated":
      sorted.sort((a, b) => (
        new Date(b.dateModified ?? b.dateReleased ?? 0).getTime() -
        new Date(a.dateModified ?? a.dateReleased ?? 0).getTime()
      ));
      break;
    case "published":
      sorted.sort((a, b) => (
        new Date(b.dateReleased ?? b.dateCreated ?? 0).getTime() -
        new Date(a.dateReleased ?? a.dateCreated ?? 0).getTime()
      ));
      break;
    default:
      break;
  }

  return sorted;
}

const CF_DEP_TYPE_MAP: Record<number, ModDependency["dependencyType"]> = {
  1: "required",
  2: "optional",
  3: "incompatible",
  4: "embedded",
}

function normalizeCFVersion(f: any): ModVersion {
  const gameVersions = Array.isArray(f.gameVersions) ? f.gameVersions : [];
  return {
    id: String(f.id ?? ""),
    name: f.displayName ?? f.fileName ?? `v${f.id}`,
    gameVersion: gameVersions.join(", "),
    downloadCount: f.downloadCount ?? 0,
    fileName: f.fileName ?? "",
    fileSize: f.fileLength ?? 0,
    loaders: detectCFLoaders(gameVersions),
    dependencies: (f.dependencies ?? []).map((d: any) => ({
      projectId: String(d.modId ?? ""),
      versionId: null,
      fileName: null,
      dependencyType: CF_DEP_TYPE_MAP[d.relationType] ?? "required",
    })),
  };
}

export async function curseforgeSearch(
  query: string,
  options?: {
    contentType?: ContentType;
    gameVersion?: string;
    modLoader?: string;
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

  const classId = CONTENT_TYPE_FACETS[contentType].cfClassId;
  const sortOption = MOD_SORT_OPTIONS.find(o => o.id === sortBy);
  const modLoaderType = modLoader ? CF_MOD_LOADER_TYPES[modLoader] : undefined;

  const params: Record<string, string> = {
    gameId: String(CF_GAME_ID_MINECRAFT),
    classId: String(classId),
    pageSize: String(MODS_PER_PAGE),
    sortField: String(sortOption?.cfSortField ?? 2),
    sortOrder: "desc",
  };
  if (query.trim()) params.searchFilter = query.trim();
  if (gameVersion) params.gameVersion = gameVersion;
  if (gameVersion && modLoaderType) params.modLoaderType = String(modLoaderType);
  if (category && category !== "all") {
    const categoryId = await resolveCFCategoryId(category, contentType);
    if (categoryId) params.categoryId = String(categoryId);
  }
  if (page > 0) params.index = String(page * MODS_PER_PAGE);

  try {
    const data = (await cfFetch("/mods/search", params)) as {
      data?: any[];
      pagination?: { totalCount?: number };
    };
    const rawResults = sortCFSearchItems(data.data ?? [], sortBy);
    return {
      results: rawResults.map(normalizeCFSearchItem),
      totalCount: data.pagination?.totalCount ?? 0,
    };
  } catch (err) {
    console.error("CF search error:", err);
    return { results: [], totalCount: 0 };
  }
}

export async function curseforgeGetDetails(modId: number): Promise<ModDetails | null> {
  try {
    const modRes = (await cfFetch(`/mods/${modId}`)) as { data?: any };
    const filesRes = (await cfFetch(`/mods/${modId}/files`, { pageSize: "30" })) as { data?: any[] };
    const mod = modRes.data;
    if (!mod) return null;

    return {
      id: `cf-${mod.id}`,
      slug: mod.slug ?? `mod-${mod.id}`,
      name: mod.name,
      summary: mod.summary ?? "",
      description: mod.description ?? mod.summary ?? "",
      iconUrl: mod.links?.iconUrl ?? mod.logo?.thumbnailUrl ?? "",
      downloadCount: mod.downloadCount ?? 0,
      categories: normalizeCFCategories(mod.categories ?? []).slice(0, 5),
      versions: (filesRes.data ?? []).map(normalizeCFVersion),
      gallery: (mod.screenshots ?? []).map((s: any) => ({
        url: s.url ?? s.thumbnailUrl ?? "",
        title: s.title ?? "",
      })),
      source: "curseforge",
      modId: mod.id,
    };
  } catch (err) {
    console.error("CF mod-details error:", err);
    return null;
  }
}

export async function curseforgeGetFileDownloadUrl(fileId: number, modId: number): Promise<string | null> {
  try {
    const data = (await cfFetch(`/mods/${modId}/files/${fileId}/download-url`)) as { data?: string };
    return data.data ?? null;
  } catch {
    return null;
  }
}

export async function curseforgeCategories(contentType?: ContentType): Promise<Array<{ id: number; slug: string; name: string }>> {
  try {
    return await getCachedCFCategories(contentType);
  } catch {
    return [];
  }
}

export async function curseforgeFeatured(gameVersion?: string): Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }> {
  try {
    const params: Record<string, string> = { gameId: String(CF_GAME_ID_MINECRAFT) };
    if (gameVersion) params.gameVersion = gameVersion;
    const data = (await cfFetch("/mods/featured", params)) as {
      data?: { popular?: any[]; trending?: any[] };
    };
    const popular = (data.data?.popular ?? []).map(item => normalizeCFSearchItem(item));
    const trending = (data.data?.trending ?? []).map(item => normalizeCFSearchItem(item));
    return { popular, trending };
  } catch {
    return { popular: [], trending: [] };
  }
}

export async function curseforgeGetDownloadUrl(modId: number, fileId: number): Promise<string | null> {
  try {
    const data = (await cfFetch(`/mods/${modId}/files/${fileId}/download-url`)) as { data?: string };
    return data.data ?? null;
  } catch {
    return null;
  }
}

export async function curseforgeGetProjectInfo(modId: number | string): Promise<ModProjectInfo | null> {
  try {
    const data = await cfFetch(`/mods/${modId}`) as { data?: Record<string, unknown> };
    if (!data.data) return null;
    const d = data.data;
    const logo = d.logo as Record<string, unknown> | undefined;
    const links = d.links as Record<string, unknown> | undefined;
    return {
      name: (d.name as string) ?? String(modId),
      iconUrl: (logo?.thumbnailUrl as string) ?? (links?.iconUrl as string) ?? "",
      slug: (d.slug as string) ?? `mod-${modId}`,
    };
  } catch {
    return null;
  }
}
