import type { ContentType, ModSort } from "./types"

export const MODS_PER_PAGE = 10

export const contentTypes: { id: ContentType; label: string; facet: string }[] = [
  { id: "mod", label: "Mods", facet: "mod" },
  { id: "modpack", label: "Modpacks", facet: "modpack" },
  { id: "resourcepack", label: "Resource Packs", facet: "resourcepack" },
  { id: "shader", label: "Shaders", facet: "shader" },
]

export const modSortOptions: { id: ModSort; label: string; modrinthIndex: string; cfSortField: number }[] = [
  { id: "downloads", label: "By downloads", modrinthIndex: "downloads", cfSortField: 2 },
  { id: "popular", label: "By popularity", modrinthIndex: "follows", cfSortField: 4 },
  { id: "updated", label: "By updated date", modrinthIndex: "updated", cfSortField: 3 },
  { id: "published", label: "By publish date", modrinthIndex: "newest", cfSortField: 11 },
]

export const modLoaderOptions = [
  { id: "all", label: "All loaders" },
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
] as const
