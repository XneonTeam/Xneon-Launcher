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

/**
 * Тэги FTB — свалка из категорий, версий Minecraft и загрузчиков, а тегом «FTB»
 * помечены 75 паков из 87. Показываем только настоящие категории (`Tech`,
 * `Magic`, `Skyblock`): версия и загрузчик у пака уже есть отдельными полями,
 * а «FTB» внутри каталога FTB не сообщает ничего.
 *
 * Держать в синхроне с `isFtbCategoryTag` в `packages/xnlc-mods/src/ftb-client.ts`
 * (оттуда его не импортировать: тот пакет тянет `node:fs` и живёт только в main).
 */
const FTB_NOISE_TAGS = new Set(["ftb", "forge", "neoforge", "fabric", "quilt", "liteloader", "vanilla"])

export function isFtbCategoryTag(tag: string): boolean {
  const value = tag.trim().toLowerCase()
  if (!value || FTB_NOISE_TAGS.has(value)) return false
  return !/^\d+\.\d+(\.\d+)?$/.test(value)
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

/**
 * Очищает строку версии от метаданных сборки, расширений (.jar), суффиксов загрузчика,
 * а также от префиксов/суффиксов версии игры (например, 'mc26.3-0.9.2-fabric' → '0.9.2').
 */
export function normalizeModVersion(str?: string | null, gameVersion?: string | null): string {
  if (!str) return ""
  let s = String(str).trim()

  // Убираем расширение файла (.jar, .zip, .litemod)
  s = s.replace(/\.(?:jar|zip|litemod)$/i, "")

  // Убираем метаданные сборки (+...)
  const plusIdx = s.indexOf("+")
  if (plusIdx !== -1) {
    s = s.slice(0, plusIdx)
  }

  // Убираем суффиксы загрузчиков (-fabric, _neoforge и т.д.)
  s = s.replace(/[-_](?:fabric|quilt|forge|neoforge)$/i, "")

  // Убираем квадратные/круглые скобки вида [1.20.1]
  s = s.replace(/^\[.*?\]\s*/g, "")
  s = s.replace(/\(.*?\)/g, "")

  // Убираем префикс mc<версия>- или mc<версия>_
  s = s.replace(/^mc-?\s*[\d.]+(?:[-_])?/i, "")

  // Убираем фразы типа "for Fabric 26.3", "for 1.20.1", "mc 1.21"
  s = s.replace(/\b(?:for|mc)\s*(?:fabric|quilt|forge|neoforge)?\s*[\d.]+\b/gi, "")

  // Если известна версия Minecraft, вырезаем её из начала, конца или как отдельное слово
  if (gameVersion) {
    const escaped = gameVersion.replace(/\./g, "\\.")
    s = s.replace(new RegExp(`^mc?${escaped}[-_]`, "i"), "")
    s = s.replace(new RegExp(`[-_]mc?${escaped}$`, "i"), "")
    s = s.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
  }

  // Убираем ведущую 'v' перед цифрами (v1.2.3 -> 1.2.3)
  s = s.replace(/^v(?=\d)/i, "")

  // Ищем семантические токены (цифры.цифры с возможным пре-релизом -alpha.1, -beta и т.д.)
  const matches = [...s.matchAll(/\b\d+(?:\.\d+)+(?:-[a-zA-Z0-9.]+)?\b/g)].map(m => m[0])
  if (matches.length > 0) {
    if (gameVersion) {
      const gv = gameVersion.toLowerCase()
      const nonGame = matches.find(m => {
        const ml = m.toLowerCase()
        return ml !== gv && !ml.startsWith(gv + "-") && !ml.endsWith("-" + gv)
      })
      if (nonGame) return nonGame.toLowerCase()
    }
    return matches[0].toLowerCase()
  }

  return s.trim().toLowerCase()
}

/**
 * Ключ версии для сравнения: нормализованный номер версии мода.
 */
export function versionKey(value?: string | null, gameVersion?: string | null): string {
  return normalizeModVersion(value, gameVersion)
}

/**
 * Совпадает ли версия из каталога с установленной.
 * В сборке хранится версия из метаданных jar («1.10.7+1.21.11-neoforge» или «mc26.3-0.9.2-fabric»),
 * а в каталоге версия названа иначе («Iris 1.10.7 for NeoForge 1.21.11» или «Sodium 0.9.2 for Fabric 26.3»),
 * поэтому сравниваем:
 * 1) Точные хэши (SHA-1) / имена файлов / ID версии
 * 2) Очищенные семантические версии мода (без номера Minecraft)
 */
export function isInstalledVersion(
  version: ModVersion,
  installed?: string | { id?: string; slug?: string; version?: string; versionId?: string; fileId?: number } | null,
  gameVersion?: string | null,
): boolean {
  if (!installed) return false

  const targetStr = (typeof installed === "string" ? installed : installed.version) ?? ""
  const target = targetStr.trim().toLowerCase()
  const gv = gameVersion || version.gameVersion || ""

  // 1. Если передан объект с ID или slug (именем файла на диске)
  if (typeof installed === "object") {
    // Имя ZIP может быть одинаковым у всех выпусков ресурспака.
    // При наличии точного идентификатора несовпадение нельзя заменять эвристикой.
    const hashes = version.files?.map(file => file.hashes?.sha1).filter(Boolean) ?? []
    if (installed.id && /^[a-f0-9]{40}$/i.test(installed.id) && hashes.length) {
      return hashes.some(hash => hash?.toLowerCase() === installed.id?.toLowerCase())
    }
    if (installed.versionId) return version.id === installed.versionId
    if (installed.fileId) return version.id === String(installed.fileId)
    // По точному хэшу файла (SHA-1)
    if (installed.id && version.files?.some(f => f.hashes?.sha1 && f.hashes.sha1.toLowerCase() === installed.id?.toLowerCase())) {
      return true
    }
    // По имени файла (.jar)
    if (installed.slug && version.fileName && version.fileName.toLowerCase() === installed.slug.toLowerCase()) {
      return true
    }
    // По точному ID версии (Modrinth ID / CurseForge fileId)
    if (installed.id && version.id.toLowerCase() === installed.id.toLowerCase()) {
      return true
    }
  }

  // 2. Точные строковые совпадения по id/fileName/versionNumber/name
  const variants = [version.id, version.fileName, version.versionNumber, version.name]
    .filter(Boolean) as string[]
  if (target && variants.some(item => item.trim().toLowerCase() === target)) return true

  // 3. Сравнение нормализованных версий мода (исключая версию Minecraft)
  const cleanTarget = normalizeModVersion(targetStr, gv)
  if (!cleanTarget) return false

  // Кандидаты: в первую очередь versionNumber и fileName, затем name
  const candidateVariants = [version.versionNumber, version.fileName, version.name]
    .filter(Boolean) as string[]
  return candidateVariants.some(item => normalizeModVersion(item, gv) === cleanTarget)
}

/**
 * Ключ проекта для состояния установки. Идентичность — `(источник, id проекта)`:
 * у Modrinth это project_id, у CurseForge modId. Slug — только запасной вариант
 * для записей, где id нет: одинаковые slug на разных платформах давали «двойную
 * установку», а slug вообще может сменить автор проекта.
 */
export function contentProjectKey(project: { source?: string | null; projectId?: string | null; modId?: number | null; slug?: string | null; id?: string | null }): string {
  const id = project.projectId ?? (project.modId != null ? String(project.modId) : null) ?? project.slug ?? project.id ?? ""
  return `${project.source ?? ""}:${id}`
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

