import { VERSIONS as DEFAULT_VERSIONS } from "@/lib/home-page-shared"
import type { ModSort } from "./types"

export const MODS_PER_PAGE = 9

export const VERSIONS = DEFAULT_VERSIONS

export const MOD_LOADERS = [
  { id: "vanilla", name: "Vanilla", dot: "bg-zinc-400" },
  { id: "forge", name: "Forge", dot: "bg-red-500" },
  { id: "fabric", name: "Fabric", dot: "bg-yellow-500" },
  { id: "liteloader", name: "LiteLoader", dot: "bg-cyan-500" },
  { id: "quilt", name: "Quilt", dot: "bg-purple-500" },
  { id: "neoforge", name: "NeoForge", dot: "bg-orange-500" },
  { id: "optifine", name: "OptiFine", dot: "bg-blue-500" },
  { id: "instance", name: "Instance", dot: "bg-blue-500" },
]

export const modSortOptions: { id: ModSort; label: string; modrinthIndex: string; cfSortField: number }[] = [
  { id: "downloads", label: "По загрузкам", modrinthIndex: "downloads", cfSortField: 2 },
  { id: "popular", label: "По популярности", modrinthIndex: "follows", cfSortField: 4 },
  { id: "updated", label: "По дате обновления", modrinthIndex: "updated", cfSortField: 3 },
  { id: "published", label: "По дате публикации", modrinthIndex: "newest", cfSortField: 11 },
]
