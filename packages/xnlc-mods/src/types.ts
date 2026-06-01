// ============================================================
// XNLC Mods — Shared Types
// Author: MAINER4IK
// ============================================================

export type ContentType = "mod" | "modpack" | "resourcepack" | "shader";
export type ModSort = "relevance" | "downloads" | "popular" | "followers" | "updated" | "published";

export interface ModSearchResult {
  id: string;
  slug: string;
  name: string;
  summary: string;
  iconUrl: string;
  downloadCount: number;
  categories: string[];
  source: "modrinth" | "curseforge";
  author?: string;
  /** Modrinth-specific */
  projectId?: string;
  /** CurseForge-specific */
  modId?: number;
  primaryFileId?: number;
  primaryFileName?: string;
  fileSize?: number;
  dateCreated?: string;
  dateModified?: string;
}

export type ModLoaderFilter = "vanilla" | "fabric" | "neoforge" | "quilt";

export interface ModSearchResponse {
  results: ModSearchResult[];
  totalCount: number;
}

export interface ModDependency {
  projectId: string;
  versionId?: string | null;
  fileName?: string | null;
  dependencyType: "required" | "optional" | "incompatible" | "embedded";
  name?: string;
  slug?: string;
  iconUrl?: string;
}

export interface ModVersion {
  id: string;
  name: string;
  gameVersion: string;
  downloadCount: number;
  fileName: string;
  fileSize: number;
  downloadUrl?: string;
  versionType?: "release" | "beta" | "alpha";
  loaders?: string[];
  changelog?: string;
  datePublished?: string;
  files?: { url: string; size: number; filename: string }[];
  dependencies?: ModDependency[];
}

export interface ModDetails {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  iconUrl: string;
  downloadCount: number;
  categories: string[];
  versions: ModVersion[];
  gallery: { url: string; title?: string }[];
  source: "modrinth" | "curseforge";
  body?: string;
  /** CurseForge-specific numeric mod ID */
  modId?: number;
  /** Modrinth-specific project ID */
  projectId?: string;
}

export interface ModSortOption {
  id: ModSort;
  modrinthIndex: string;
  cfSortField: number;
}

export const MOD_SORT_OPTIONS: ModSortOption[] = [
  { id: "relevance", modrinthIndex: "relevance", cfSortField: 2 },
  { id: "downloads", modrinthIndex: "downloads", cfSortField: 6 },
  { id: "popular", modrinthIndex: "follows", cfSortField: 2 },
  { id: "followers", modrinthIndex: "follows", cfSortField: 2 },
  { id: "updated", modrinthIndex: "updated", cfSortField: 3 },
  { id: "published", modrinthIndex: "newest", cfSortField: 11 },
];

export const CONTENT_TYPE_FACETS: Record<ContentType, { facet: string; cfClassId: number }> = {
  mod: { facet: "mod", cfClassId: 6 },
  modpack: { facet: "modpack", cfClassId: 4471 },
  resourcepack: { facet: "resourcepack", cfClassId: 12 },
  shader: { facet: "shader", cfClassId: 6552 },
};
