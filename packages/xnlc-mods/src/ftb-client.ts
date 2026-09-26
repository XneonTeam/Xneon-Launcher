// ============================================================
// XNLC Mods — FTB (Feed The Beast) API Client
// Minecraft modpack directory: https://api.modpacks.ch
// ============================================================

import type {
  ContentType,
  ModSearchResult,
  ModSearchResponse,
  ModSort,
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

/**
 * Сколько паков тянем из поискового эндпоинта. У FTB нет параметра страницы
 * (`/public/modpack/search/{limit}?term=`), поэтому берём с запасом и листаем сами.
 */
const SEARCH_LIMIT = 50;

/** Каталог FTB меняется медленно: держим его в памяти, чтобы не качать 90+ манифестов. */
const CATALOG_TTL_MS = 30 * 60 * 1000;
const CATALOG_CONCURRENCY = 12;

const manifestCache = new Map<number, FTBModpackManifest>();
let catalogCache: CachedCatalog | null = null;
/**
 * Файл дискового кэша каталога. Каталог — это ~90 запросов манифестов, и держать
 * его только в памяти мало: после перезапуска лаунчера пользователь снова ждал бы.
 * Путь задаёт main-процесс (`setFtbCatalogCacheFile`).
 */
let catalogCacheFile: string | null = null;

export function setFtbCatalogCacheFile(file: string | null): void {
  catalogCacheFile = file;
}

interface CachedCatalog {
  at: number;
  /** Версия формата кэша: старые файлы без загрузчиков/версий считаем устаревшими. */
  v: number;
  items: ModSearchResult[];
}

const CATALOG_CACHE_VERSION = 4;

async function readCatalogCacheFile(): Promise<CachedCatalog | null> {
  if (!catalogCacheFile) return null;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(catalogCacheFile, "utf-8");
    const parsed = JSON.parse(raw) as CachedCatalog;
    if (!parsed?.at || !Array.isArray(parsed.items)) return null;
    if (parsed.v !== CATALOG_CACHE_VERSION) return null;
    if (Date.now() - parsed.at > CATALOG_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCatalogCacheFile(value: CachedCatalog): Promise<void> {
  if (!catalogCacheFile) return;
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(catalogCacheFile, JSON.stringify(value), "utf-8");
  } catch {
    // кэш не критичен: при ошибке просто скачаем каталог в следующий раз
  }
}

async function ftbFetch(endpoint: string, options?: { timeoutMs?: number; retries?: number }): Promise<unknown> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const maxRetries = options?.retries ?? MAX_RETRIES;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      if (attempt >= maxRetries) throw err;
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
    // Загрузчик и версия Minecraft у FTB лежат не в тэгах, а в targets версий
    // (`neoforge:21.1.51`, `minecraft:1.21.1`). Версию берём только новейшую:
    // у старых паков в targets набрались бы все версии за всю историю (900+).
    gameVersions: newestFtbGameVersion(man),
    loaders: collectFtbTargetNames(man, LOADER_TARGET_NAMES),
  };
}

/** Имена таргетов FTB, которые означают загрузчик (у ванильных паков их нет). */
const LOADER_TARGET_NAMES = ["forge", "neoforge", "fabric", "quilt", "liteloader"];

/**
 * Каталог FTB (`/public/modpack/all`) содержит не только модпаки: там же лежат
 * базовые «дистрибутивы» — Vanilla, MinecraftForge, Fabric, NeoForge — и мёртвые
 * заглушки (например MindCrack Pack: 0 версий, 0 загрузок). У настоящих паков
 * всегда есть тэги-категории (Tech, Magic, Skyblock…), у этих записей их нет.
 */
function isFtbModpack(man: FTBModpackManifest): boolean {
  return (man.tags ?? []).length > 0;
}

/** Новейшая версия Minecraft пака (или пустой массив, если таргетов нет). */
function newestFtbGameVersion(man: FTBModpackManifest): string[] {
  const versions = collectFtbTargetValues(man, "minecraft");
  if (versions.length === 0) return [];
  return [versions.reduce((best, current) => (compareGameVersions(current, best) < 0 ? current : best))];
}

/** Уникальные `version` у таргетов с указанным именем (например, версии Minecraft). */
function collectFtbTargetValues(man: FTBModpackManifest, targetName: string): string[] {
  const wanted = targetName.toLowerCase();
  const found = new Set<string>();
  for (const version of man.versions ?? []) {
    for (const target of version.targets ?? []) {
      if ((target?.name ?? "").toLowerCase() === wanted && target.version) found.add(target.version);
    }
  }
  return [...found];
}

/** Уникальные имена таргетов из списка (например, загрузчики: forge/neoforge/fabric). */
function collectFtbTargetNames(man: FTBModpackManifest, names: string[]): string[] {
  const wanted = names.map((name) => name.toLowerCase());
  const found = new Set<string>();
  for (const version of man.versions ?? []) {
    for (const target of version.targets ?? []) {
      const name = (target?.name ?? "").toLowerCase();
      if (wanted.includes(name)) found.add(name);
    }
  }
  return [...found];
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

/**
 * Весь каталог FTB: `/public/modpack/all` отдаёт около сотни id, манифесты тянем
 * пачками. У поиска FTB нет ни сортировки, ни страниц (`?term=` и всё), поэтому
 * именно каталог — единственный способ отсортировать паки по загрузкам, дате
 * выпуска или обновления. Результат кэшируется в памяти main-процесса.
 */
export async function ftbCatalog(): Promise<ModSearchResult[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.items;

  const fromDisk = await readCatalogCacheFile();
  if (fromDisk) {
    catalogCache = fromDisk;
    for (const item of fromDisk.items) {
      const id = Number(item.projectId ?? item.id);
      if (Number.isFinite(id)) void ftbGetModpack(id).catch(() => null);
    }
    return fromDisk.items;
  }

  const listing = (await ftbFetch("/public/modpack/all", { timeoutMs: 10_000 })) as { packs?: number[] };
  const ids = listing.packs ?? [];
  const items: ModSearchResult[] = [];

  for (let index = 0; index < ids.length; index += CATALOG_CONCURRENCY) {
    const batch = ids.slice(index, index + CATALOG_CONCURRENCY);
    const manifests = await Promise.all(batch.map((id) =>
      ftbFetch(`/public/modpack/${id}`, { timeoutMs: 5_000, retries: 1 })
        .then((data) => {
          const manifest = data as FTBModpackManifest & { status?: string };
          if (!manifest || typeof manifest.id !== "number" || manifest.status === "error") return null;
          manifestCache.set(manifest.id, manifest);
          return manifest;
        })
        .catch(() => null),
    ));
    for (const manifest of manifests) {
      if (manifest && isFtbModpack(manifest)) items.push(normalizeFTBProject(manifest));
    }
  }

  catalogCache = { at: Date.now(), v: CATALOG_CACHE_VERSION, items };
  void writeCatalogCacheFile(catalogCache);
  return items;
}

/**
 * Тэги FTB — это и версии Minecraft, и категории в одном списке
 * («1.12.2», «Tech», «Skyblock»). Разделяем их для фильтров поиска.
 */
export function splitFtbTags(items: ModSearchResult[]): { gameVersions: string[]; categories: string[] } {
  const versions = new Set<string>();
  const categories = new Set<string>();
  for (const item of items) {
    for (const tag of item.categories ?? []) {
      if (/^\d+\.\d+(\.\d+)?$/.test(tag)) versions.add(tag);
      else categories.add(tag);
    }
  }
  const byVersion = (a: string, b: string) => {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const diff = (right[i] ?? 0) - (left[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  return {
    gameVersions: [...versions].sort(byVersion),
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
  };
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
  options?: { page?: number; pageSize?: number; sortBy?: ModSort; categories?: string[]; gameVersion?: string; loader?: string },
): Promise<ModSearchResponse> {
  const page = options?.page ?? 0;
  const pageSize = options?.pageSize ?? MODS_PER_PAGE;

  try {
    // Без запроса показываем весь каталог FTB (вместо короткого списка featured):
    // только так сортировка и фильтры работают по всем пакам, а не по одной странице.
    const trimmed = query.trim();
    const items = trimmed
      ? (await Promise.all((await ftbSearchModpacks(trimmed)).packs.map((id) => ftbGetModpack(id))))
          .filter((manifest): manifest is FTBModpackManifest => !!manifest && isFtbModpack(manifest))
          .map((manifest) => normalizeFTBProject(manifest))
      : await ftbCatalog();

    const filtered = items.filter((item) => {
      if (options?.gameVersion && !(item.gameVersions ?? []).includes(options.gameVersion)) return false;
      if (options?.loader && options.loader !== "all") {
        // «vanilla» = пак без загрузчика: у него в targets только minecraft/java.
        const loaders = item.loaders ?? [];
        if (options.loader === "vanilla" ? loaders.length > 0 : !loaders.includes(options.loader)) return false;
      }
      if (options?.categories?.length) {
        return options.categories.every((category) => (item.categories ?? []).includes(category));
      }
      return true;
    });

    const sorted = [...filtered];
    const timestamp = (value?: string) => {
      const parsed = value ? Date.parse(value) : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    if (options?.sortBy === "downloads") sorted.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));
    else if (options?.sortBy === "newest") sorted.sort((a, b) => timestamp(b.dateCreated) - timestamp(a.dateCreated));
    else if (options?.sortBy === "updated") sorted.sort((a, b) => timestamp(b.dateModified) - timestamp(a.dateModified));

    return {
      results: sorted.slice(page * pageSize, (page + 1) * pageSize),
      totalCount: sorted.length,
    };
  } catch (err) {
    console.error("FTB search error:", err);
    return { results: [], totalCount: 0 };
  }
}

/**
 * Фильтры каталога FTB: версии Minecraft (из targets версий), загрузчики и
 * категории (из тэгов). Категории для модалки приходят без версий.
 */
export async function ftbCatalogFacets(): Promise<{ gameVersions: string[]; categories: string[]; loaders: string[] }> {
  const catalog = await ftbCatalog();
  const loaders = new Set<string>();
  const versions = new Set<string>();
  let vanillaPacks = 0;
  for (const item of catalog) {
    const itemLoaders = item.loaders ?? [];
    if (itemLoaders.length === 0) vanillaPacks += 1;
    for (const loader of itemLoaders) loaders.add(loader);
    for (const version of item.gameVersions ?? []) versions.add(version);
  }
  // «Ванила» = пак без загрузчика; в списке фильтров она уместна только если такие есть.
  if (vanillaPacks > 0) loaders.add("vanilla");
  return {
    ...splitFtbTags(catalog),
    loaders: [...loaders].sort((a, b) => a.localeCompare(b)),
    gameVersions: [...versions].sort(compareGameVersions),
  };
}

/** Сортировка версий Minecraft: 1.21 выше 1.7.10 (числовое сравнение по сегментам). */
function compareGameVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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