// ============================================================
// XNLC Mods — CurseForge API Client
// Author: MAINER4IK
// ============================================================

import type {
  ContentType,
  ModSort,
  ModEnvironment,
  ModSearchResult,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  ModProjectInfo,
  ModCategory,
} from "./types.js";
import { MOD_SORT_OPTIONS, CONTENT_TYPE_FACETS } from "./types.js";

const CF_API_KEY = process.env.CF_API_KEY || "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm";
const CF_BASE = "https://api.curseforge.com/v1";
const CF_GAME_ID_MINECRAFT = 432;
const MODS_PER_PAGE = 20;
const MAX_RETRIES = 2;
let cfCategoriesCache: Array<{ id: number; slug: string; name: string; classId: number }> | null = null;

const CF_CLASSID_TO_PROJECTTYPE: Record<number, ContentType> = {
  6: "mod",
  12: "resourcepack",
  17: "world",
  6552: "shader",
  4471: "modpack",
  6945: "datapack",
  5: "plugin",
};
let cfCategoriesFullCache: ModCategory[] | null = null;

const CF_MOD_LOADER_TYPES: Record<string, number> = {
  forge: 1,
  cauldron: 2,
  liteloader: 3,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

export async function cfFetch(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
    const url = new URL(`${CF_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url.toString(), {
        headers: { "x-api-key": CF_API_KEY },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`CF API ${res.status}: ${res.statusText}`);
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
    if (normalized === "forge") loaders.add("forge");
    if (normalized === "neoforge" || normalized === "neo forge") loaders.add("neoforge");
  }

  return Array.from(loaders);
}

async function getCachedCFCategories(contentType?: ContentType): Promise<Array<{ id: number; slug: string; name: string }>> {
  if (!cfCategoriesCache) {
    const data = (await cfFetch("/categories", { gameId: String(CF_GAME_ID_MINECRAFT) })) as {
      data?: Array<{ id: number; slug: string; name: string; classId: number }>;
    };
    cfCategoriesCache = (data.data ?? []).map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      classId: category.classId,
    }));
  }

  if (contentType) {
    const classId = CONTENT_TYPE_FACETS[contentType].cfClassId;
    return cfCategoriesCache
      .filter((category) => category.classId === classId)
      .map(({ id, slug, name }) => ({ id, slug, name }));
  }
  return cfCategoriesCache.map(({ id, slug, name }) => ({ id, slug, name }));
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

const CF_TYPE_TO_LOADER_NAME: Record<number, string> = {
  1: "forge",
  2: "cauldron",
  3: "liteloader",
  4: "fabric",
  5: "quilt",
  6: "neoforge",
};

function normalizeCFSearchItem(item: any): ModSearchResult {
  const primaryFile = item.latestFiles?.find((f: any) => f.isAvailable) ?? item.latestFiles?.[0];
  const indexes: any[] = Array.isArray(item.latestFilesIndexes) ? item.latestFilesIndexes : [];
  const versionsSet = new Set<string>();
  const loadersSet = new Set<string>();

  for (const idx of indexes) {
    if (idx.gameVersion) versionsSet.add(String(idx.gameVersion).trim());
    const loaderName = CF_TYPE_TO_LOADER_NAME[Number(idx.modLoader)];
    if (loaderName) loadersSet.add(loaderName);
  }

  if (Array.isArray(item.latestFiles)) {
    for (const f of item.latestFiles) {
      if (Array.isArray(f.gameVersions)) {
        for (const gv of f.gameVersions) {
          const s = String(gv).trim();
          const lower = s.toLowerCase();
          if (["forge", "fabric", "neoforge", "quilt"].includes(lower)) {
            loadersSet.add(lower);
          } else if (s) {
            versionsSet.add(s);
          }
        }
      }
    }
  }

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
    gameVersions: Array.from(versionsSet),
    loaders: Array.from(loadersSet),
  };
}

function sortCFSearchItems(items: any[], sortBy: ModSort): any[] {
  const sorted = [...items];

  switch (sortBy) {
    case "downloads":
      sorted.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));
      break;
    case "follows":
      sorted.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));
      break;
    case "updated":
      sorted.sort((a, b) => (
        new Date(b.dateModified ?? b.dateReleased ?? 0).getTime() -
        new Date(a.dateModified ?? a.dateReleased ?? 0).getTime()
      ));
      break;
    case "newest":
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
  const releaseType = Number(f.releaseType ?? 1);
  return {
    id: String(f.id ?? ""),
    name: f.displayName ?? f.fileName ?? `v${f.id}`,
    versionNumber: f.displayName ?? undefined,
    gameVersion: gameVersions.join(", "),
    downloadCount: f.downloadCount ?? 0,
    fileName: f.fileName ?? "",
    fileSize: f.fileLength ?? 0,
    loaders: detectCFLoaders(gameVersions),
    versionType: releaseType === 1 ? "release" : releaseType === 2 ? "beta" : "alpha",
    datePublished: typeof f.fileDate === "string" ? f.fileDate : undefined,
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
    categories?: string[];
    sortBy?: ModSort;
    page?: number;
    environment?: ModEnvironment;
  },
): Promise<ModSearchResponse> {
  const contentType = options?.contentType ?? "mod";
  const gameVersion = options?.gameVersion;
  const modLoader = options?.modLoader;
  const categories = options?.categories ?? (options?.category ? [options.category] : []);
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
  if (modLoaderType) params.modLoaderType = String(modLoaderType);
  if (categories.length > 0) {
    const categoryIds: number[] = [];
    for (const cat of categories) {
      const id = await resolveCFCategoryId(cat, contentType);
      if (id) categoryIds.push(id);
    }
    if (categoryIds.length > 0) params.categoryId = categoryIds.join(",");
  }
  if (page > 0) params.index = String(page * MODS_PER_PAGE);

  try {
    const data = (await cfFetch("/mods/search", params)) as {
      data?: any[];
      pagination?: { totalCount?: number };
    };
    return {
      results: (data.data ?? []).map(normalizeCFSearchItem),
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
      links: {
        websiteUrl: mod.links?.websiteUrl || undefined,
        wikiUrl: mod.links?.wikiUrl || undefined,
        issuesUrl: mod.links?.issuesUrl || undefined,
        sourceUrl: mod.links?.sourceUrl || undefined,
      },
    };
  } catch (err) {
    console.error("CF mod-details error:", err);
    return null;
  }
}

export async function curseforgeGetChangelog(modId: number, fileId: number): Promise<string> {
  try {
    const res = (await cfFetch(`/mods/${modId}/files/${fileId}/changelog`)) as { data?: string };
    return res.data ?? "";
  } catch (err) {
    console.warn("CF changelog error:", err);
    return "";
  }
}

export async function curseforgeGetDescription(modId: number): Promise<string> {
  try {
    const res = (await cfFetch(`/mods/${modId}/description`)) as { data?: string };
    return res.data ?? "";
  } catch (err) {
    console.warn("CF description error:", err);
    return "";
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

export interface CurseForgeFileInfo {
  id: number;
  modId: number;
  fileName: string;
  downloadUrl: string;
  fileLength?: number;
}

/**
 * Batch retrieves files info and download URLs via POST /v1/mods/files
 * Reduces 100+ individual requests down to 1-2 requests during modpack import!
 */
export async function curseforgeGetFiles(fileIds: number[]): Promise<Record<number, CurseForgeFileInfo>> {
  const cleaned = [...new Set(fileIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (cleaned.length === 0) return {};

  const result: Record<number, CurseForgeFileInfo> = {};
  const CHUNK_SIZE = 150;

  for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
    const chunk = cleaned.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(`${CF_BASE}/mods/files`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "x-api-key": CF_API_KEY,
        },
        body: JSON.stringify({ fileIds: chunk }),
      });

      if (res.ok) {
        const json = (await res.json()) as { data?: any[] };
        const list = Array.isArray(json.data) ? json.data : [];
        for (const file of list) {
          if (!file || !file.id) continue;
          let downloadUrl = file.downloadUrl;
          const fileName = file.fileName || `mod-${file.id}.jar`;
          // Fallback to official CurseForge edge CDN if direct downloadUrl is null
          if (!downloadUrl && fileName) {
            const part1 = Math.floor(file.id / 1000);
            const part2 = file.id % 1000;
            downloadUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${encodeURIComponent(fileName)}`;
          }

          if (downloadUrl) {
            result[file.id] = {
              id: file.id,
              modId: file.modId,
              fileName,
              downloadUrl,
              fileLength: file.fileLength,
            };
          }
        }
      }
    } catch (err) {
      console.warn("CurseForge getFiles batch error:", err);
    }
  }

  return result;
}

export type CurseforgeFingerprintMatch = {
  fileFingerprint: number
  modId: number
  fileId: number
  sha1: string
}

export type CurseforgeFingerprintsResult = {
  exactMatches: CurseforgeFingerprintMatch[]
}

/**
 * Identifies files by their CurseForge fileFingerprint (POST /v1/fingerprints/{gameId}).
 * The API returns exact matches only when its fingerprint cache is built;
 * each exact match is keyed back to the local file by `fileFingerprint`,
 * with the file's SHA-1 (hash algo 1) available as a fallback key.
 */
export async function curseforgeGetFingerprintsMatches(
  fingerprints: number[],
  signal?: AbortSignal,
): Promise<CurseforgeFingerprintsResult> {
  const cleaned = Array.isArray(fingerprints)
    ? [...new Set(fingerprints.filter((n) => Number.isFinite(n) && n > 0))]
    : []
  if (cleaned.length === 0) return { exactMatches: [] }

  const exactMatches: CurseforgeFingerprintMatch[] = []
  const CHUNK = 50
  for (let i = 0; i < cleaned.length; i += CHUNK) {
    const chunk = cleaned.slice(i, i + CHUNK)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
      try {
        const res = await fetch(`${CF_BASE}/fingerprints/${CF_GAME_ID_MINECRAFT}`, {
          method: "POST",
          headers: {
            "x-api-key": CF_API_KEY,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ fingerprints: chunk }),
          signal,
        })
        if (!res.ok) throw new Error(`CF API ${res.status}: ${res.statusText}`)
        const json = (await res.json()) as { data?: { exactMatches?: unknown[] } }
        for (const m of json.data?.exactMatches ?? []) {
          const file = (m as Record<string, unknown>)?.file as Record<string, unknown> | undefined
          if (!file) continue
          const hashes = Array.isArray(file.hashes) ? (file.hashes as Record<string, unknown>[]) : []
          const sha1Hash = hashes.find((hash) => hash?.algo === 1)
          exactMatches.push({
            fileFingerprint: Number(file.fileFingerprint ?? 0),
            modId: Number(file.modId ?? 0),
            fileId: Number(file.id ?? 0),
            sha1: typeof sha1Hash?.value === "string" ? sha1Hash.value : "",
          })
        }
        break
      } catch (err: any) {
        lastError = err;
        if (attempt >= MAX_RETRIES) {
          console.error("CF fingerprints error:", err);
        }
      }
    }
  }
  return { exactMatches }
}

export async function curseforgeGetProjectInfo(modId: number | string): Promise<ModProjectInfo | null> {
  try {
    const data = await cfFetch(`/mods/${modId}`) as { data?: Record<string, unknown> };
    if (!data.data) return null;
    const d = data.data;
    const logo = d.logo as Record<string, unknown> | undefined;
    const links = d.links as Record<string, unknown> | undefined;
    const authors = d.authors as Array<Record<string, unknown>> | undefined;
    return {
      name: (d.name as string) ?? String(modId),
      iconUrl: (logo?.thumbnailUrl as string) ?? (links?.iconUrl as string) ?? "",
      slug: (d.slug as string) ?? `mod-${modId}`,
      author: Array.isArray(authors) ? authors.map(a => a.name).filter(Boolean).join(", ") : undefined,
    };
  } catch {
    return null;
  }
}

export async function curseforgeGetProjectsByIds(modIds: number[]): Promise<Record<number, ModProjectInfo>> {
  const result: Record<number, ModProjectInfo> = {};
  if (!modIds.length) return result;

  const uniqueIds = [...new Set(modIds.filter(n => Number.isFinite(n) && n > 0))];
  if (uniqueIds.length === 0) return result;

  const CHUNK = 50;
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    try {
      const data = await cfFetch("/mods", {
        modIds: JSON.stringify(chunk),
        gameId: String(CF_GAME_ID_MINECRAFT),
      }) as { data?: Array<Record<string, unknown>> };
      for (const mod of (data.data ?? [])) {
        const id = mod.id as number | undefined;
        if (!id) continue;
        const logo = mod.logo as Record<string, unknown> | undefined;
        const links = mod.links as Record<string, unknown> | undefined;
        const authors = mod.authors as Array<Record<string, unknown>> | undefined;
        result[id] = {
          name: (mod.name as string) ?? String(id),
          iconUrl: (logo?.thumbnailUrl as string) ?? (links?.iconUrl as string) ?? "",
          slug: (mod.slug as string) ?? `mod-${id}`,
          author: Array.isArray(authors) ? authors.map(a => a.name).filter(Boolean).join(", ") : undefined,
          isAvailable: (mod.isAvailable as boolean | undefined) ?? true,
        };
      }
    } catch {
      // skip batch on error
    }
  }
  return result;
}

export async function curseforgeGetCategories(): Promise<ModCategory[]> {
  if (cfCategoriesFullCache) return cfCategoriesFullCache;
  try {
    const data = (await cfFetch("/categories", { gameId: String(CF_GAME_ID_MINECRAFT) })) as {
      data?: Array<{ id: number; name: string; slug: string; classId: number; parentId: number; url: string; iconUrl: string }>;
    };
    const raw = (data.data ?? []).filter(c => c.classId !== 0);
    const nameMap = new Map(raw.map(c => [String(c.id), c.name]));

    cfCategoriesFullCache = raw
      .filter(c => CF_CLASSID_TO_PROJECTTYPE[c.classId] != null)
      .map(c => ({
        name: c.name,
        icon: c.iconUrl ?? "",
        header: (c.parentId ? nameMap.get(String(c.parentId)) : undefined) ?? "categories",
        projectType: CF_CLASSID_TO_PROJECTTYPE[c.classId],
        cfCategoryId: c.id,
        slug: c.slug,
      }));
    return cfCategoriesFullCache;
  } catch {
    return [];
  }
}
