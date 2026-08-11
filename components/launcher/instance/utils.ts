import { MOD_LOADERS } from "./constants"
import type { Build, ModVersion } from "./types"

export function loadBuilds(): Build[] {
  const saved = localStorage.getItem("xneon-launcher:builds:legacy")
  const hasLegacy = saved ? (JSON.parse(saved) as Partial<Build>[]) : null
  try {
    if (hasLegacy) {
      const migrated: Build[] = hasLegacy.map(build => ({
        id: build.id ?? crypto.randomUUID(),
        name: build.name ?? "Без названия",
        description: build.description ?? "",
        version: build.version ?? "",
        modLoader: build.modLoader ?? MOD_LOADERS[0].id,
        loaderVersion: build.loaderVersion,
        icon: build.icon ?? "",
        coverImage: build.coverImage,
        mods: Array.isArray(build.mods) ? build.mods : [],
        resourcepacks: Array.isArray(build.resourcepacks) ? build.resourcepacks : [],
        shaders: Array.isArray(build.shaders) ? build.shaders : [],
        createdAt: build.createdAt ?? new Date().toISOString(),
        source: (build.source === "modrinth" ? "modrinth" : build.source === "curseforge" ? "curseforge" : "local") as "local" | "modrinth" | "curseforge",
        projectSlug: build.projectSlug,
        playtime: 0,
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

function parseVersionList(gameVersion: string) {
  return gameVersion.split(/[|,/]/).map(item => item.trim()).filter(Boolean)
}

export function matchesBuildVersion(version: ModVersion, build: Build, requireLoaderMatch = true) {
  const gameVersions = parseVersionList(version.gameVersion ?? "")
  if (gameVersions.length > 0 && !gameVersions.includes(build.version)) {
    return false
  }

  if (!requireLoaderMatch) {
    return true
  }

  const loaders = version.loaders?.map(loader => loader.toLowerCase()) ?? []
  if (build.modLoader === "vanilla") {
    return loaders.length === 0
  }

  if (loaders.length === 0) {
    return false
  }

  return loaders.includes(build.modLoader.toLowerCase())
}

export function pickCompatibleVersion(versions: ModVersion[] | undefined, build: Build, requireLoaderMatch = true) {
  if (!versions?.length) return undefined

  const installableVersions = versions.filter(version => version.files?.[0]?.url || version.downloadUrl || version.fileName)
  return installableVersions.find(version => matchesBuildVersion(version, build, requireLoaderMatch))
    ?? installableVersions.find(version => {
      const gameVersions = parseVersionList(version.gameVersion ?? "")
      return gameVersions.length === 0 || gameVersions.includes(build.version)
    })
    ?? installableVersions[0]
}
