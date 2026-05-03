import type { ContentType, ModSort } from "./types"

export const MODS_PER_PAGE = 10

export const contentTypes: { id: ContentType; label: string; facet: string }[] = [
  { id: "mod", label: "Mods", facet: "mod" },
  { id: "modpack", label: "Modpacks", facet: "modpack" },
  { id: "resourcepack", label: "Resource Packs", facet: "resourcepack" },
  { id: "shader", label: "Shaders", facet: "shader" },
]

export const gameVersions: { version: string; type: "release" | "beta" | "alpha" | "snapshot" }[] = [
  { version: "1.21.5", type: "release" },
  { version: "1.21.4", type: "release" },
  { version: "1.21.3", type: "release" },
  { version: "1.21.1", type: "release" },
  { version: "1.21", type: "release" },
  { version: "1.20.6", type: "release" },
  { version: "1.20.4", type: "release" },
  { version: "1.20.2", type: "release" },
  { version: "1.20.1", type: "release" },
  { version: "1.20", type: "release" },
  { version: "1.19.4", type: "release" },
  { version: "1.19.2", type: "release" },
  { version: "1.18.2", type: "release" },
  { version: "1.17.1", type: "release" },
  { version: "1.16.5", type: "release" },
  { version: "1.12.2", type: "release" },
  { version: "1.8.9", type: "release" },
  { version: "1.7.10", type: "release" },
  { version: "1.25w14a", type: "snapshot" },
  { version: "24w46a", type: "snapshot" },
  { version: "b1.7.3", type: "beta" },
  { version: "b1.6.6", type: "beta" },
  { version: "a1.2.6", type: "alpha" },
  { version: "a1.1.2_01", type: "alpha" },
]

export const modSortOptions: { id: ModSort; label: string; modrinthIndex: string; cfSortField: number }[] = [
  { id: "downloads", label: "By downloads", modrinthIndex: "downloads", cfSortField: 2 },
  { id: "popular", label: "By popularity", modrinthIndex: "follows", cfSortField: 4 },
  { id: "updated", label: "By updated date", modrinthIndex: "updated", cfSortField: 3 },
  { id: "published", label: "By publish date", modrinthIndex: "newest", cfSortField: 11 },
]
