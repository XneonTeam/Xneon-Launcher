import type { ModSort } from "./types"

export const MODS_PER_PAGE = 9

export const VERSIONS = ["1.21.4", "1.21.1", "1.21", "1.20.4", "1.20.2", "1.19.4", "1.18.2", "1.16.5", "1.12.2"]

export const MOD_LOADERS = [
  { id: "vanilla", name: "Vanilla", dot: "bg-zinc-400" },
  { id: "forge", name: "Forge", dot: "bg-orange-500" },
  { id: "fabric", name: "Fabric", dot: "bg-yellow-500" },
  { id: "neoforge", name: "NeoForge", dot: "bg-red-500" },
  { id: "quilt", name: "Quilt", dot: "bg-purple-500" },
]

export const modSortOptions: { id: ModSort; label: string; modrinthIndex: string; cfSortField: number }[] = [
  { id: "downloads", label: "По загрузкам", modrinthIndex: "downloads", cfSortField: 2 },
  { id: "popular", label: "По популярности", modrinthIndex: "follows", cfSortField: 4 },
  { id: "updated", label: "По дате обновления", modrinthIndex: "updated", cfSortField: 3 },
  { id: "published", label: "По дате публикации", modrinthIndex: "newest", cfSortField: 11 },
]
