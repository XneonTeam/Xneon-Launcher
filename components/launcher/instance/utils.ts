import { MOD_LOADERS, VERSIONS } from "./constants"
import type { Build } from "./types"

export function loadBuilds(): Build[] {
  const saved = localStorage.getItem("xneon-launcher:builds:legacy")
  const hasLegacy = saved ? (JSON.parse(saved) as Partial<Build>[]) : null
  try {
    if (hasLegacy) {
      const migrated: Build[] = hasLegacy.map(build => ({
        id: build.id ?? crypto.randomUUID(),
        name: build.name ?? "Без названия",
        description: build.description ?? "",
        version: build.version ?? VERSIONS[0],
        modLoader: build.modLoader ?? MOD_LOADERS[0].id,
        icon: build.icon ?? "",
        coverImage: build.coverImage,
        mods: Array.isArray(build.mods) ? build.mods : [],
        resourcepacks: Array.isArray(build.resourcepacks) ? build.resourcepacks : [],
        shaders: Array.isArray(build.shaders) ? build.shaders : [],
        createdAt: build.createdAt ?? new Date().toISOString(),
        source: (build.source === "modrinth" ? "modrinth" : build.source === "curseforge" ? "curseforge" : "local") as "local" | "modrinth" | "curseforge",
        projectSlug: build.projectSlug,
      }))
      void window.electronAPI?.saveBuilds(migrated as never)
      localStorage.removeItem("xneon-launcher:builds:legacy")
      return migrated
    }
  } catch {}
  return []
}

export function formatDownloads(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return String(num)
}
