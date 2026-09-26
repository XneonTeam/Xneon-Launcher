// ============================================================
// XNLC — Content Update Checker
// Checks installed mods/resourcepacks/shaders for newer
// compatible versions on Modrinth / CurseForge.
// Results are cached in the settings table so badges survive
// restarts without re-hitting the APIs.
// ============================================================

import { dbHelpers } from "../../db"
import { loadModsModule } from "./helpers"
import type { BuildJson } from "../../db/builds"
import type { ModVersion } from "@xnlc/mods" with { "resolution-mode": "import" }
import type {
  BuildContentUpdates,
  ContentUpdateInfo,
  UpdateChannel,
} from "@xnlc/types" with { "resolution-mode": "import" }

const CACHE_SETTINGS_KEY = "contentUpdatesCache"
const CHECK_CONCURRENCY = 4

type CheckableItem = {
  id: string
  slug?: string
  name: string
  icon_url?: string
  version: string
  source?: "local" | "modrinth" | "curseforge"
  projectId?: string
  modId?: number
  versionId?: string
  fileId?: number
}

type ContentListKey = "mods" | "resourcepacks" | "shaders"

const CONTENT_LIST_KEYS: ContentListKey[] = ["mods", "resourcepacks", "shaders"]

const CHANNEL_RANK: Record<string, number> = { release: 0, beta: 1, alpha: 2 }

function isChannelAllowed(versionType: string | undefined, channel: UpdateChannel): boolean {
  const versionRank = CHANNEL_RANK[versionType ?? "release"] ?? 0
  return versionRank <= (CHANNEL_RANK[channel] ?? 0)
}

function parseGameVersions(gameVersion: string): string[] {
  return gameVersion.split(/[|,/]/).map((item) => item.trim()).filter(Boolean)
}

function matchesGameAndLoader(version: ModVersion, build: BuildJson, requireLoaderMatch: boolean): boolean {
  const gameVersions = parseGameVersions(version.gameVersion ?? "")
  if (gameVersions.length > 0 && !gameVersions.includes(build.version)) {
    return false
  }

  if (!requireLoaderMatch) return true

  const loaders = version.loaders?.map((loader) => loader.toLowerCase()) ?? []
  if (build.modLoader === "vanilla") {
    return loaders.length === 0
  }
  if (loaders.length === 0) return false
  return loaders.includes(build.modLoader.toLowerCase())
}

function byDateDesc(a: ModVersion, b: ModVersion): number {
  return Date.parse(b.datePublished ?? "") - Date.parse(a.datePublished ?? "") || 0
}

function toTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "")
  return Number.isNaN(parsed) ? 0 : parsed
}

function extractSemverNumbers(str: string): number[] {
  if (!str) return []
  const cleaned = str
    .replace(/^\[.*?\]\s*/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/^v(?=\d)/i, "")
  const match = cleaned.match(/\b\d+(?:\.\d+)+\b/)
  if (match) {
    return match[0].split(".").map(Number)
  }
  const single = cleaned.match(/\d+/)
  return single ? [Number(single[0])] : []
}

function compareSemver(latestVer: string, currentVer: string): number {
  const lParts = extractSemverNumbers(latestVer)
  const cParts = extractSemverNumbers(currentVer)
  if (lParts.length === 0 || cParts.length === 0) return 0
  const max = Math.max(lParts.length, cParts.length)
  for (let i = 0; i < max; i++) {
    const l = lParts[i] ?? 0
    const c = cParts[i] ?? 0
    if (l > c) return 1
    if (l < c) return -1
  }
  return 0
}

function isMatchingInstalledVersion(
  candidate: ModVersion,
  item: CheckableItem,
  resource?: { versionId?: string | null; fileId?: number | null }
): boolean {
  // 1. По точному хэшу файла (SHA-1)
  if (item.id && candidate.files?.some((f) => {
    const hashes = (f as { hashes?: { sha1?: string } }).hashes
    return hashes?.sha1 && hashes.sha1.toLowerCase() === item.id.toLowerCase()
  })) {
    return true
  }

  // 2. По точным ID версии (Modrinth) / файла (CurseForge)
  const targetVerId = item.versionId || resource?.versionId
  if (targetVerId && candidate.id.toLowerCase() === targetVerId.toLowerCase()) {
    return true
  }
  const targetFileId = item.fileId || resource?.fileId
  if (targetFileId && (candidate.id === String(targetFileId) || candidate.id === String(Number(targetFileId)))) {
    return true
  }

  // 3. По имени файла (.jar)
  if (item.slug && candidate.fileName && candidate.fileName.toLowerCase() === item.slug.toLowerCase()) {
    return true
  }

  // 4. По номеру версии мода (например versionNumber === "2.31" или "26.5.0")
  if (candidate.versionNumber && item.version && item.version !== "local") {
    const cNum = candidate.versionNumber.trim().toLowerCase()
    const iNum = item.version.trim().toLowerCase()
    if (cNum === iNum) return true
    if (compareSemver(cNum, iNum) === 0 && extractSemverNumbers(cNum).length > 0) {
      return true
    }
  }

  return false
}

/**
 * Picks the newest compatible version and decides whether it is actually
 * newer than the installed one.
 * NEVER compares arbitrary release names/titles.
 */
function findUpdateForItem(
  versions: ModVersion[],
  item: CheckableItem,
  build: BuildJson,
  contentType: ContentListKey,
  channel: UpdateChannel,
  resource?: { versionId?: string | null; fileId?: number | null }
): ModVersion | null {
  const channelAllowed = versions.filter((v) => isChannelAllowed(v.versionType, channel))
  if (channelAllowed.length === 0) return null

  const requireLoader = contentType === "mods"
  const compatible = channelAllowed.filter((v) => matchesGameAndLoader(v, build, requireLoader))
  const gameOnly = channelAllowed.filter((v) => matchesGameAndLoader(v, build, false))
  const candidates = (compatible.length > 0 ? compatible : gameOnly).sort(byDateDesc)
  if (candidates.length === 0) return null

  const latest = candidates[0]!

  // Если самая свежая версия совпадает с установленным модом — обновления НЕТ!
  if (isMatchingInstalledVersion(latest, item, resource)) {
    return null
  }

  // Ищем установленную версию в списке доступных версий
  const installedEntry = candidates.find((v) => isMatchingInstalledVersion(v, item, resource))
    ?? channelAllowed.find((v) => isMatchingInstalledVersion(v, item, resource))
    ?? versions.find((v) => isMatchingInstalledVersion(v, item, resource))

  if (installedEntry) {
    if (installedEntry.id === latest.id) return null
    const latestTime = toTimestamp(latest.datePublished)
    const installedTime = toTimestamp(installedEntry.datePublished)
    if (latestTime > 0 && installedTime > 0) {
      return latestTime > installedTime ? latest : null
    }
  }

  // Если точная запись не найдена, сравниваем семантические номера версий:
  // Обновлением считается ТОЛЬКО если версия у latest СТРОГО выше текущей!
  const latestVerStr = latest.versionNumber || latest.fileName || ""
  if (item.version && item.version !== "local") {
    const cmp = compareSemver(latestVerStr, item.version)
    if (cmp <= 0) {
      // Версии равны или текущая новее — никакого обновления нет!
      return null
    }
    return latest
  }

  return null
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++]!
      await worker(current)
    }
  })
  await Promise.all(lanes)
}

/**
 * Разобранный кэш держим в памяти: строка в `settings` весит мегабайты
 * (иконки модов — это data-URL), а `JSON.parse` на каждый запрос бейджей
 * обновлений занимал десятки миллисекунд на главном процессе. Писатель у
 * ключа единственный — этот модуль, поэтому инвалидация не нужна: кэш
 * обновляется вместе с записью.
 */
let updatesCacheMemo: Record<string, BuildContentUpdates> | null = null

/** Отдаёт иконку в компактном виде: data-URL (base64) в кэш не кладём. */
function compactIconUrl(iconUrl: string | undefined): string | undefined {
  if (!iconUrl) return undefined
  // Иконки из JAR встраиваются как `data:` и весят десятки килобайт каждая:
  // на ~200 обновлений это ~5 МБ в одной строке настроек. В интерфейсе такая
  // иконка всё равно берётся из списка модов сборки, а сетевые URL дешёвые.
  return iconUrl.startsWith("data:") ? undefined : iconUrl
}

function compactUpdatesForCache(result: BuildContentUpdates): BuildContentUpdates {
  return {
    ...result,
    updates: result.updates.map((update) => {
      const iconUrl = compactIconUrl(update.iconUrl)
      return iconUrl === update.iconUrl ? update : { ...update, iconUrl }
    }),
  }
}

/** Размер строки кэша, после которого она переписывается в сжатом виде. */
const CACHE_COMPACT_THRESHOLD = 1_000_000

export async function readUpdatesCache(): Promise<Record<string, BuildContentUpdates>> {
  if (updatesCacheMemo) return updatesCacheMemo
  try {
    const raw = await dbHelpers.getSetting(CACHE_SETTINGS_KEY)
    if (!raw) {
      updatesCacheMemo = {}
      return updatesCacheMemo
    }
    const parsed = JSON.parse(raw) as Record<string, BuildContentUpdates>
    updatesCacheMemo = parsed && typeof parsed === "object" ? parsed : {}
    // Разовая миграция: раньше в кэш попадали data-URL иконки модов, из-за чего
    // строка настроек разрасталась до мегабайт и переписывалась при каждом
    // обновлении. Сжимаем существующий кэш в фоне, не задерживая вызывающего.
    if (raw.length > CACHE_COMPACT_THRESHOLD) {
      void writeUpdatesCache(updatesCacheMemo).catch(() => {})
    }
    return updatesCacheMemo
  } catch {
    return {}
  }
}

/** Только счётчики обновлений: интерфейсу для бейджей не нужен весь кэш. */
export async function readUpdatesCounts(): Promise<Record<string, { mods: number; resourcepacks: number; shaders: number }>> {
  const cache = await readUpdatesCache()
  const counts: Record<string, { mods: number; resourcepacks: number; shaders: number }> = {}
  for (const [buildId, entry] of Object.entries(cache)) {
    const byType = { mods: 0, resourcepacks: 0, shaders: 0 }
    for (const update of entry?.updates ?? []) {
      if (update.contentType === "mods") byType.mods += 1
      else if (update.contentType === "resourcepacks") byType.resourcepacks += 1
      else if (update.contentType === "shaders") byType.shaders += 1
    }
    counts[buildId] = byType
  }
  return counts
}

async function writeUpdatesCache(cache: Record<string, BuildContentUpdates>): Promise<void> {
  // Сжимаем весь кэш, а не только что записанную сборку: иначе старые записи
  // с иконками оставались бы в строке до следующей проверки каждой из них.
  const compacted: Record<string, BuildContentUpdates> = {}
  for (const [buildId, entry] of Object.entries(cache)) {
    compacted[buildId] = compactUpdatesForCache(entry)
  }
  updatesCacheMemo = compacted
  await dbHelpers.setSetting(CACHE_SETTINGS_KEY, JSON.stringify(compacted))
}

export async function checkContentUpdates(buildId: string, channel: UpdateChannel = "release"): Promise<BuildContentUpdates> {
  // Раньше здесь читался весь список сборок вместе с их JSON-контентом
  // (десятки мегабайт на ~20 сборок) ради одной строки.
  const light = (await dbHelpers.loadBuildsLight()).find((b) => b.id === buildId)
  const result: BuildContentUpdates = { buildId, channel, checkedAt: Date.now(), updates: [] }
  if (!light) return result

  const content = await dbHelpers.loadBuildContent(buildId)
  const build = { ...light, ...(content ?? { mods: [], resourcepacks: [], shaders: [], installedMods: {} }) } as BuildJson

  // Связанные с модпаком сборки управляются целиком через смену версии модпака,
  // поэтому поштучное обновление отдельных модов для них отключается
  const isLinkedModpack = (build.source === "modrinth" || build.source === "curseforge") && build.locked !== false
  if (isLinkedModpack) {
    const cache = await readUpdatesCache()
    if (cache[buildId]?.updates?.length) {
      delete cache[buildId]
      await writeUpdatesCache(cache)
    }
    return result
  }

  const mods = await loadModsModule()
  const tasks: Array<() => Promise<void>> = []

  for (const contentType of CONTENT_LIST_KEYS) {
    const items = (build[contentType] ?? []) as CheckableItem[]
    let resourceMap = new Map<string, Awaited<ReturnType<typeof dbHelpers.getResources>>[number]>()
    try {
      const resources = await dbHelpers.getResources(items.map((i) => i.id).filter(Boolean))
      resourceMap = new Map(resources.map((r) => [r.sha1, r]))
    } catch {}

    // Modrinth пакетная оптимизация: проверяем все Modrinth-моды одним запросом!
    const mrItems = items.filter((i) => i.source === "modrinth" && i.id)
    let mrUpdatesMap: Record<string, ModVersion> = {}
    if (mrItems.length > 0) {
      try {
        const loaders = build.modLoader && build.modLoader !== "vanilla" ? [build.modLoader.toLowerCase()] : ["minecraft"]
        const gameVersions = build.version ? [build.version] : undefined
        mrUpdatesMap = await mods.modrinthCheckUpdates(mrItems.map((i) => i.id), loaders, gameVersions)
      } catch (err) {
        console.warn("[Updates] Modrinth batch check failed, falling back to individual checks:", err)
      }
    }

    for (const item of items) {
      tasks.push(async () => {
        try {
          const resource = resourceMap.get(item.id)

          // Если Modrinth пакетный API уже дал результат для этого хэша
          if (item.source === "modrinth" && mrUpdatesMap[item.id]) {
            const batchLatest = mrUpdatesMap[item.id]!
            // Проверяем, действительно ли эта версия отличается от установленной
            if (!isMatchingInstalledVersion(batchLatest, item, resource)) {
              result.updates.push({
                itemId: item.id,
                contentType,
                source: item.source,
                modId: item.modId,
                name: item.name,
                iconUrl: item.icon_url,
                currentVersion: item.version,
                latestVersion: batchLatest,
              })
              return
            }
          }

          let versions: ModVersion[] = []
          if (item.source === "modrinth" && item.projectId) {
            // Если в batch не вернулся (например другой лоадер/версия), делаем единичный фоллбек
            versions = await mods.modrinthGetVersions(item.projectId)
          } else if (item.source === "curseforge" && item.modId) {
            const details = await mods.curseforgeGetDetails(item.modId)
            versions = details?.versions ?? []
          } else {
            return
          }
          if (versions.length === 0) return

          const latest = findUpdateForItem(versions, item, build, contentType, channel, resource)
          if (!latest) return

          result.updates.push({
            itemId: item.id,
            contentType,
            source: item.source,
            modId: item.modId,
            name: item.name,
            iconUrl: item.icon_url,
            currentVersion: item.version,
            latestVersion: latest,
          })
        } catch (error) {
          console.warn(`[Updates] Failed to check "${item.name}":`, error)
        }
      })
    }
  }

  await runPool(tasks, CHECK_CONCURRENCY, (task) => task())

  result.updates.sort((a, b) => a.name.localeCompare(b.name))

  try {
    const cache = await readUpdatesCache()
    cache[buildId] = compactUpdatesForCache(result)
    await writeUpdatesCache(cache)
  } catch (error) {
    console.warn("[Updates] Failed to persist updates cache:", error)
  }

  return result
}

export async function dismissContentUpdate(buildId: string, itemId: string): Promise<void> {
  try {
    const cache = await readUpdatesCache()
    const entry = cache[buildId]
    if (!entry) return
    entry.updates = entry.updates.filter((update) => update.itemId !== itemId)
    await writeUpdatesCache(cache)
  } catch (error) {
    console.warn("[Updates] Failed to dismiss cached update:", error)
  }
}
