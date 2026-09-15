import type { ModSort, SearchSource } from "./types"

// Виды сортировки — их реально поддерживает API каждой платформы:
// Modrinth:   index=relevance | downloads | follows | newest | updated
// CurseForge: sortField=1 Featured | 2 Popularity | 3 LastUpdated | 6 TotalDownloads
export function getSortLabels(t: (key: string) => string): Record<ModSort, string> {
  return {
    relevance: t("sort.relevance"),
    downloads: t("sort.downloads"),
    follows: t("sort.follows"),
    newest: t("sort.newest"),
    updated: t("sort.updated"),
    featured: t("sort.featured"),
    rating: t("sort.rating"),
  }
}

export const SORT_OPTIONS_BY_SOURCE: Record<SearchSource, ModSort[]> = {
  modrinth: ["relevance", "downloads", "follows", "newest", "updated"],
  curseforge: ["featured", "follows", "downloads", "updated"],
  both: ["downloads", "follows", "updated", "newest"],
  ftb: ["downloads", "follows", "updated", "newest"],
}