import type { ModSort } from "./types"

export const MODS_PER_PAGE = 9

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
  { id: "downloads", label: "По загрузкам", modrinthIndex: "downloads", cfSortField: 2 },
  { id: "popular", label: "По популярности", modrinthIndex: "follows", cfSortField: 4 },
  { id: "updated", label: "По дате обновления", modrinthIndex: "updated", cfSortField: 3 },
  { id: "published", label: "По дате публикации", modrinthIndex: "newest", cfSortField: 11 },
]
