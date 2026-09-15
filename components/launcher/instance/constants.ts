import type { ModSort } from "./types"

export const MODS_PER_PAGE = 20

export const MOD_LOADERS = [
  { id: "vanilla", name: "Vanilla" },
  { id: "forge", name: "Forge" },
  { id: "fabric", name: "Fabric" },
  { id: "liteloader", name: "LiteLoader" },
  { id: "quilt", name: "Quilt" },
  { id: "neoforge", name: "NeoForge" },
  { id: "optifine", name: "OptiFine" },
  { id: "instance", name: "Instance" },
]

/**
 * Загрузчики, которые можно выбрать у сборки.
 *
 * `instance` — это не загрузчик, а режим главной страницы («запустить
 * существующую сборку»), поэтому в списках сборок его быть не должно.
 * В `MOD_LOADERS` он остаётся, чтобы корректно отображать старые сборки
 * с таким значением.
 */
export const BUILD_MOD_LOADERS = MOD_LOADERS.filter(item => item.id !== "instance")

export function getModSortOptions(t: (key: string) => string): { id: ModSort; label: string; modrinthIndex: string; cfSortField: number }[] {
  return [
    { id: "relevance", label: t("sort.relevance"), modrinthIndex: "relevance", cfSortField: 2 },
    { id: "downloads", label: t("sort.downloads"), modrinthIndex: "downloads", cfSortField: 6 },
    { id: "follows", label: t("sort.follows"), modrinthIndex: "follows", cfSortField: 2 },
    { id: "newest", label: t("sort.newest"), modrinthIndex: "newest", cfSortField: 11 },
    { id: "updated", label: t("sort.updated"), modrinthIndex: "updated", cfSortField: 3 },
    { id: "featured", label: t("sort.featured"), modrinthIndex: "relevance", cfSortField: 1 },
    { id: "rating", label: t("sort.rating"), modrinthIndex: "relevance", cfSortField: 12 },
  ]
}
