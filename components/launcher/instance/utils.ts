import { MOD_LOADERS } from "./constants"
import type { Build, ModSearchResult, ModVersion } from "./types"
import i18n from "@/src/i18n"

export function loadBuilds(): Build[] {
  const saved = localStorage.getItem("xneon-launcher:builds:legacy")
  const hasLegacy = saved ? (JSON.parse(saved) as Partial<Build>[]) : null
  try {
    if (hasLegacy) {
      const migrated: Build[] = hasLegacy.map(build => ({
        id: build.id ?? crypto.randomUUID(),
        name: build.name ?? i18n.t("builds.untitled"),
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
        modpackVersion: build.modpackVersion,
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

/** Совпадает ли загрузчик версии с загрузчиком сборки (без учёта версии Minecraft) */
export function matchesBuildLoader(version: ModVersion, build: Build): boolean {
  const buildLoader = (build.modLoader ?? "").toLowerCase().trim()
  // "instance" — модпак-инстанс со своим набором модов, фильтровать нечем
  if (!buildLoader || buildLoader === "instance") return true

  const loaders = version.loaders?.map(loader => String(loader).toLowerCase().trim()).filter(Boolean) ?? []

  if (buildLoader === "vanilla") {
    return loaders.length === 0
  }

  if (loaders.length === 0) {
    return false
  }

  return loaders.includes(buildLoader)
}

export function matchesBuildVersion(version: ModVersion, build: Build, requireLoaderMatch = true) {
  const gameVersions = parseVersionList(version.gameVersion ?? "")
  if (gameVersions.length > 0 && !gameVersions.includes(build.version)) {
    return false
  }

  if (!requireLoaderMatch) {
    return true
  }

  return matchesBuildLoader(version, build)
}

/**
 * Разбивает список версий проекта на группы совместимости:
 * exact  — подходит и версия Minecraft, и загрузчик;
 * byLoader — подходит только загрузчик (другая версия Minecraft);
 * all    — вообще все версии проекта.
 */
export function groupVersionsByCompatibility(
  versions: ModVersion[],
  build: Build | null,
  requireLoaderMatch = true,
): { exact: ModVersion[]; byLoader: ModVersion[]; all: ModVersion[] } {
  if (!build) return { exact: versions, byLoader: versions, all: versions }

  const exact = versions.filter(version => matchesBuildVersion(version, build, requireLoaderMatch))
  const byLoader = requireLoaderMatch
    ? versions.filter(version => matchesBuildLoader(version, build))
    : versions

  return { exact, byLoader, all: versions }
}

export function pickCompatibleVersion(versions: ModVersion[] | undefined, build: Build, requireLoaderMatch = true): ModVersion | undefined {
  if (!versions?.length) return undefined

  const installableVersions = versions.filter(version => version.files?.[0]?.url || version.downloadUrl || version.fileName)
  return installableVersions.find(version => matchesBuildVersion(version, build, requireLoaderMatch))
}

/**
 * Проверяет, совместим ли найденный проект с текущей сборкой (версия Minecraft + загрузчик).
 * Если у проекта есть метаданные версий или загрузчиков, несовместимые проекты отсекаются.
 */
export function isProjectCompatibleWithBuild(
  project: ModSearchResult,
  build: Build | null,
  requireLoaderMatch = true,
): boolean {
  if (!build) return true

  // 1. Фильтр по версии Minecraft
  const targetMc = (build.version || "").trim().toLowerCase()
  if (targetMc && project.gameVersions && project.gameVersions.length > 0) {
    const hasMc = project.gameVersions.some((v: string) => {
      const clean = String(v).trim().toLowerCase()
      if (clean === targetMc) return true
      const baseClean = clean.split("-")[0]
      const baseTarget = targetMc.split("-")[0]
      return baseClean === baseTarget
    })
    if (!hasMc) return false
  }

  // 2. Фильтр по загрузчику (только для модов)
  const buildLoader = (build.modLoader || "").trim().toLowerCase()
  if (requireLoaderMatch && buildLoader && buildLoader !== "vanilla" && project.loaders && project.loaders.length > 0) {
    const hasLoader = project.loaders.some((l: string) => String(l).trim().toLowerCase() === buildLoader)
    if (!hasLoader) return false
  }

  return true
}

