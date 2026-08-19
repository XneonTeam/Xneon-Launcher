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

export const modSortOptions: { id: ModSort; label: string; modrinthIndex: string; cfSortField: number }[] = [
  { id: "relevance", label: "По релевантности", modrinthIndex: "relevance", cfSortField: 2 },
  { id: "downloads", label: "По загрузкам", modrinthIndex: "downloads", cfSortField: 6 },
  { id: "follows", label: "По подписчикам", modrinthIndex: "follows", cfSortField: 2 },
  { id: "newest", label: "По новизне", modrinthIndex: "newest", cfSortField: 11 },
  { id: "updated", label: "По дате обновления", modrinthIndex: "updated", cfSortField: 3 },
  { id: "featured", label: "Избранные", modrinthIndex: "relevance", cfSortField: 1 },
  { id: "rating", label: "По рейтингу", modrinthIndex: "relevance", cfSortField: 12 },
]
