// ============================================================
// XNLC Mods — Shared Types
// Author: MAINER4IK
// ============================================================

export type ContentType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack" | "plugin" | "world";
export type ModSort = "relevance" | "downloads" | "follows" | "newest" | "updated" | "featured" | "rating";
export type ModSource = "modrinth" | "curseforge" | "ftb";
export type ModEnvironment = "client" | "server";

export interface ModSearchResult {
  id: string;
  slug: string;
  name: string;
  summary: string;
  iconUrl: string;
  downloadCount: number;
  categories: string[];
  source: ModSource;
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
  gameVersions?: string[];
  loaders?: string[];
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
  versionNumber?: string;
  gameVersion: string;
  downloadCount: number;
  fileName: string;
  fileSize: number;
  downloadUrl?: string;
  versionType?: "release" | "beta" | "alpha";
  loaders?: string[];
  changelog?: string;
  datePublished?: string;
  files?: { url: string; size: number; filename: string; hashes?: { sha1?: string; sha512?: string } }[];
  dependencies?: ModDependency[];
}

export interface ModLinks {
  websiteUrl?: string;
  wikiUrl?: string;
  issuesUrl?: string;
  sourceUrl?: string;
  discordUrl?: string;
  donationUrls?: { id?: string; platform?: string; url: string }[];
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
  source: ModSource;
  body?: string;
  /** CurseForge-specific numeric mod ID */
  modId?: number;
  /** Modrinth-specific project ID */
  projectId?: string;
  links?: ModLinks;
}

export interface ModSortOption {
  id: ModSort;
  modrinthIndex: string;
  cfSortField: number;
}

export const MOD_SORT_OPTIONS: ModSortOption[] = [
  { id: "relevance", modrinthIndex: "relevance", cfSortField: 2 },
  { id: "downloads", modrinthIndex: "downloads", cfSortField: 6 },
  { id: "follows", modrinthIndex: "follows", cfSortField: 2 },
  { id: "newest", modrinthIndex: "newest", cfSortField: 3 },
  { id: "updated", modrinthIndex: "updated", cfSortField: 3 },
  { id: "featured", modrinthIndex: "relevance", cfSortField: 1 },
  { id: "rating", modrinthIndex: "relevance", cfSortField: 2 },
];

export const CONTENT_TYPE_FACETS: Record<ContentType, { facet: string; cfClassId: number }> = {
  mod: { facet: "mod", cfClassId: 6 },
  modpack: { facet: "modpack", cfClassId: 4471 },
  resourcepack: { facet: "resourcepack", cfClassId: 12 },
  shader: { facet: "shader", cfClassId: 6552 },
  datapack: { facet: "datapack", cfClassId: 6945 },
  plugin: { facet: "plugin", cfClassId: 5 },
  world: { facet: "world", cfClassId: 17 },
};

export interface ModCategory {
  name: string;
  icon: string;
  header: string;
  projectType: ContentType;
  cfCategoryId?: number;
  /** CurseForge category slug (stable filter key used by resolveCFCategoryId) */
  slug?: string;
}

export interface CurseForgeCategory {
  id: number;
  name: string;
  slug: string;
  classId: number;
  parentId: number;
  url: string;
  iconUrl: string;
}

// ── Modpack Import Types ────────────────────────────────────

export interface ModProjectInfo {
  name: string;
  iconUrl: string;
  slug: string;
  author?: string;
  /** false when the project is hidden/removed by CurseForge moderation — its
   *  API data is unreliable placeholder junk ("now"/"no") and must not be used. */
  isAvailable?: boolean;
}

export interface ModrinthVersionFile {
  filename?: string;
  url?: string;
  primary?: boolean;
}

export interface ModrinthVersionDetail {
  id: string;
  name?: string;
  version_number?: string;
  version_type?: string;
  game_versions?: string[];
  files?: ModrinthVersionFile[];
}

export interface ModrinthManifestFile {
  env?: { client?: string; server?: string };
  path?: string;
  downloads?: string[];
  hashes?: { sha512?: string; sha1?: string };
}

export interface ModrinthManifest {
  name?: string;
  summary?: string;
  slug?: string;
  version?: string;
  dependencies?: Record<string, string>;
  files?: ModrinthManifestFile[];
}

export interface CurseForgeManifestFile {
  env?: { client?: string };
  displayName?: string;
  downloadUrl?: string;
  fileLength?: number;
  projectID?: number;
  fileID?: number;
  primary?: boolean;
  id?: number;
}
