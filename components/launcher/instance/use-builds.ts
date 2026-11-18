import { isContentDownloadCancelled } from "@/lib/content-download"
import { acknowledgeBuildEdits, buildWrites, filterStaleBuildPatch, isBuildWriteConflict } from "@/lib/build-write-queue"
import { BoundedCache, estimateCacheBytes } from "@/lib/bounded-cache"
import { beginContentMutationGuard, buildContentPatch, CONTENT_PATCH_FIELDS, PACK_METADATA_FIELDS, createContentRefreshQueue, filterStaleContentPatch } from "@/lib/build-content-patch"
import { reconcileContentRows, reconcileContentPaths, reconcileContentIcon, normalizeContentDto } from "@/lib/content-reconciliation"
import { updatedContentItem, retainInstalledIdentity } from "@/lib/content-update-state"
import { contentManifest, applyContentDelta, type ContentRows, type ContentManifest } from "@/lib/content-delta"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MOD_LOADERS } from "./constants"
import { loadBuilds, pickCompatibleVersion } from "./utils"
import type { Build, BuildMod, ModSearchResult, ModDependency, ModVersion } from "./types"
import type { BuildExportCategory } from "@xnlc/types"
import { enrichBuildModNames } from "@/lib/modrinth-metadata"
import { fsErrorMessage } from "@/lib/fs-errors"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { useCategoryIcons } from "@/src/hooks/use-category-icons"
import { useCategoryList } from "@/src/hooks/use-category-list"
import { useTranslation } from "react-i18next"

type BuildContentListKey = "mods" | "resourcepacks" | "shaders"
type BuildContentKind = "mod" | "resourcepack" | "shader"

/**
 * Кэш лёгкого списка сборок на уровне модуля: список живёт дольше компонента,
 * поэтому повторный вход во вкладку отрисовывается сразу, без чтения БД.
 */
let buildsLightCache: Build[] | null = null

/** Когда список последний раз читался из БД (мс, performance.now()). */
let buildsLightCacheAt = 0

/**
 * TTL кэша: как часто обновлять список в фоне. Данные показываются из кэша
 * сразу и независимо от этого срока (см. stale-while-revalidate ниже) — TTL
 * влияет только на то, когда запускать фоновое обновление. Прежние 3 секунды
 * означали, что почти каждый возврат во вкладку тянул список из БД заново.
 */
const BUILDS_CACHE_TTL_MS = 5 * 60_000

/**
 * Тяжёлый контент сборок (mods/resourcepacks/shaders/installedMods). У модпаков
 * это десятки мегабайт — грузим по требованию (для открытой сборки) и держим
 * в памяти, чтобы переключение вкладок не читало их заново.
 */
const buildContentCache = new BoundedCache<string, {
  mods: BuildMod[]
  resourcepacks: BuildMod[]
  shaders: BuildMod[]
  installedMods: Record<string, string>
}>({ capacity: 8, maxWeight: 64 * 1024 * 1024, weight: estimateCacheBytes })

/** Лёгкий snapshot не удерживает тяжёлые массивы в обход LRU. */
function lightSnapshot(build: Build): BuildWithCounts {
  const counts = build as BuildWithCounts
  const loaded = buildContentCache.has(build.id)
  return { ...build, mods: [], resourcepacks: [], shaders: [], installedMods: {},
    modsCount: loaded ? build.mods.length : counts.modsCount ?? build.mods.length,
    resourcepacksCount: loaded ? build.resourcepacks.length : counts.resourcepacksCount ?? build.resourcepacks.length,
    shadersCount: loaded ? build.shaders.length : counts.shadersCount ?? build.shaders.length }
}

function cachedSnapshots(builds: Build[]): Build[] {
  return builds.map(build => {
    const content = buildContentCache.get(build.id)
    return content ? { ...build, ...content } : build
  })
}

// Инструменты агента могут менять БД, пока раздел сборок размонтирован.
if (typeof window !== "undefined") window.addEventListener("launcher:agent-updated", () => {
  buildsLightCache = null
  buildsLightCacheAt = 0
  buildContentCache.clear()
})

export function getCachedBuildsLight(): Build[] | null {
  return buildsLightCache
}

export function getBuildContentCacheStats(): { entries: number; estimatedBytes: number } {
  return { entries: buildContentCache.size, estimatedBytes: buildContentCache.weight }
}

export function updateCachedBuildContent(buildId: string, content: {
  mods: BuildMod[]
  resourcepacks: BuildMod[]
  shaders: BuildMod[]
  installedMods: Record<string, string>
}) {
  buildContentCache.set(buildId, content)
  if (buildsLightCache) {
    buildsLightCache = buildsLightCache.map(build => build.id === buildId ? {
      ...build, modsCount: content.mods.length, resourcepacksCount: content.resourcepacks.length, shadersCount: content.shaders.length,
    } : build)
  }
}

/** Сборка без тяжёлого контента: поля-списки пустые, счётчики — из лёгкого запроса. */
type BuildWithCounts = Build & { modsCount?: number; resourcepacksCount?: number; shadersCount?: number }

/** Поля сборки, которые сохраняются точечно (без тяжёлого контента). */
const LIGHT_BUILD_FIELDS = [
  "name", "description", "version", "modLoader", "loaderVersion", "icon", "coverImage",
  "createdAt", "source", "projectSlug", "modpackVersion", "modpackVersionId", "locked",
  "modId", "fileId", "intentPath", "playtime", "javaOverride", "javaPath", "javaArgs",
  "memoryMin", "memoryMax", "serverOverride", "server", "serverPort", "group",
  "preLaunchCommand", "postLaunchCommand", "wrapperCommand", "customEnv",
  "windowOverride", "windowWidth", "windowHeight", "defaultAccountId",
] as const

const CONTENT_KIND_BY_KEY: Record<BuildContentListKey, BuildContentKind> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaders: "shader",
}

export function useBuilds(pageActive = true) {
  const { t } = useTranslation()
  const { pushNotification, beginContentInstall, endContentInstall, upsertLiveNotification, removeLiveNotification } = useActivityCenter()
  // Иконки категорий — их можно задать в контекстном меню категории.
  const { categoryIcons, setCategoryIcon, renameCategoryIcon, dropCategoryIcon } = useCategoryIcons("builds")
  // Созданные вручную категории: без этого пустая категория исчезала бы сразу.
  const {
    declaredCategories, addCategory, renameCategory: renameDeclaredCategory, dropCategory: dropDeclaredCategory,
  } = useCategoryList("builds")
  const [buildsState, setBuildsState] = useState<Build[]>(() => buildsLightCache ? cachedSnapshots(buildsLightCache) : [])
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const activeBuildIdRef = useRef<string | null>(null)
  const [buildsHydrated, setBuildsHydrated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<number | null>(null)
  const buildsRef = useRef<Build[]>(buildsState)
  const isReloadingRef = useRef(false)
  const reloadSeqRef = useRef(0)
  const contentScanSeqRef = useRef<Map<string, number>>(new Map())
  const contentMutationsRef = useRef<Map<string, number>>(new Map())
  const displayedContentRef = useRef(new Set<string>())
  const contentRefreshRef = useRef<(buildId: string, changed?: boolean) => Promise<void>>(async () => {})
  const [queueContentRefresh] = useState(createContentRefreshQueue)
  const lastSavedSnapshotRef = useRef("")
  /** Что уже записано в БД: лёгкие поля — по значению, контент — по ссылке на массив. */
  const savedLightFieldsRef = useRef<Map<string, Record<string, unknown>>>(new Map())
  const savedContentRef = useRef<Map<string, { mods: BuildMod[]; resourcepacks: BuildMod[]; shaders: BuildMod[]; installedMods: Record<string, string> }>>(new Map())
  /** Несохранённые правки — дописываются при уходе с вкладки. */
  const pendingPatchesRef = useRef<Array<{ id: string; fields: Record<string, unknown>; contentSeq: number }>>([])

  /**
   * Правки, сделанные пользователем в UI, но ещё не записанные в БД (сохранение
   * отложено debounce'ом). reloadBuilds читает снапшот из БД, поэтому без этого
   * буфера свежие изменения откатывались бы: например, отвязка модпака
   * (``locked: false``) возвращалась обратно, если reload случался в окне до
   * записи. Храним по id сборки, чтобы переживать промежуточные reload'ы.
   */
  const pendingEditsRef = useRef<Map<string, Partial<Build>>>(new Map())

  const setBuilds = useCallback<React.Dispatch<React.SetStateAction<Build[]>>>((value) => {
    setBuildsState(prev => {
      const next = typeof value === "function" ? value(prev) : value
      buildsRef.current = next
      // Кэш списка держим в согласии с тем, что реально на экране. Раньше он
      // обновлялся только при чтении из БД: созданная, скопированная или
      // удалённая сборка меняла состояние, но не кэш, и возврат во вкладку
      // подставлял устаревший снапшот — новая сборка «пропадала», а удалённая
      // возвращалась обратно. Время чтения из БД при этом не трогаем: TTL
      // продолжает управлять фоновым обновлением (stale-while-revalidate).
      if (next) {
        // Кэш держим в согласии с тем, что реально на экране — ALWAYS, включая
        // пустой список. Раньше здесь стоял guard `next.length > 0`, из-за которого
        // удаление ПОСЛЕДНЕЙ сборки не обновляло кэш: он продолжал хранить
        // удалённую сборку, и при следующем входе во вкладку (mount effect ниже)
        // та «воскресала» в UI, а flush-сейв `reloadBuilds` возвращал её в БД.
        // При нескольких сборках guard не срабатывал, поэтому баг был виден
        // только когда оставалась одна сборка.
        buildsLightCache = next.map(lightSnapshot)
      }
      return next
    })
  }, [])

  const builds = buildsState
  const scanManifestsRef = useRef(new BoundedCache<string, {manifest:ContentManifest;base:{mods:WeakRef<ContentRows["mods"]>;resourcepacks:WeakRef<ContentRows["resourcepacks"]>;shaders:WeakRef<ContentRows["shaders"]>;installedMods:WeakRef<ContentRows["installedMods"]>}}>({capacity:8,maxWeight:2*1024*1024,weight:estimateCacheBytes,ttlMs:5*60_000}))
  const contentLoadsRef = useRef(new Map<string,Promise<boolean>>())

  const pageActiveRef = useRef(pageActive)
  pageActiveRef.current = pageActive
  useEffect(() => () => {
    if (pageActiveRef.current) return
    // Нельзя выбрасывать пользовательские правки/данные активной установки.
    const protectedIds = new Set([...contentMutationsRef.current.keys(), ...pendingEditsRef.current.keys(), ...pendingPatchesRef.current.map(patch => patch.id)])
    for (const build of buildsRef.current) {
      if (Object.keys(buildWrites.getPending(build.id)).some(key=>CONTENT_PATCH_FIELDS.has(key))) protectedIds.add(build.id)
      if (protectedIds.has(build.id)) continue
      contentScanSeqRef.current.set(build.id,(contentScanSeqRef.current.get(build.id)??0)+1)
      if (!displayedContentRef.current.has(build.id)) continue
      updateCachedBuildContent(build.id, {mods:build.mods,resourcepacks:build.resourcepacks,shaders:build.shaders,installedMods:build.installedMods??{}})
      displayedContentRef.current.delete(build.id)
      savedContentRef.current.delete(build.id)
      // Manifest содержит только хеши и WeakRef: оставляем его для повторного
      // открытия из cache, не сохраняя второй сильный владелец массивов.
    }
    setBuildsState(previous => {
      const next = previous.map(build => protectedIds.has(build.id) ? build : {
      ...build, mods:[],resourcepacks:[],shaders:[],installedMods:{},
      modsCount:(build as BuildWithCounts).modsCount??build.mods.length,
      resourcepacksCount:(build as BuildWithCounts).resourcepacksCount??build.resourcepacks.length,
      shadersCount:(build as BuildWithCounts).shadersCount??build.shaders.length,
      })
      buildsRef.current = next
      return next
    })
  }, [])

  const currentPatchFields = useCallback((patch: { id: string; fields: Record<string, unknown>; contentSeq: number }) => {
    const fields = filterStaleBuildPatch(patch.fields, buildsRef.current.find(build => build.id === patch.id),
      patch.contentSeq !== (contentScanSeqRef.current.get(patch.id) ?? 0))
    return filterStaleContentPatch(fields, patch.contentSeq, contentScanSeqRef.current.get(patch.id) ?? 0, contentMutationsRef.current.has(patch.id))
  }, [])

  const beginContentMutation = useCallback((buildId: string) => {
    return beginContentMutationGuard(contentMutationsRef.current, contentScanSeqRef.current, buildId, () => { void contentRefreshRef.current(buildId, true) })
  }, [])

  const syncBuildContent = useCallback(async (build: Build): Promise<(Build & {scanManifest?:ContentManifest}) | null> => {
    try {
      const targetPath = build.intentPath?.trim() || build.name
      const api = window.electrobunAPI
      const base = { mods: build.mods, resourcepacks: build.resourcepacks, shaders: build.shaders, installedMods: build.installedMods ?? {} }
      const cachedManifest=scanManifestsRef.current.get(build.id)
      const sameBase=cachedManifest&&cachedManifest.base.mods.deref()===base.mods&&cachedManifest.base.resourcepacks.deref()===base.resourcepacks&&cachedManifest.base.shaders.deref()===base.shaders&&cachedManifest.base.installedMods.deref()===base.installedMods
      const delta = api?.syncBuildIntentContent
        ? await api.syncBuildIntentContent(targetPath, sameBase ? cachedManifest.manifest : await contentManifest(base as ContentRows, cachedManifest ? {
          manifest: cachedManifest.manifest,
          content: {mods:cachedManifest.base.mods.deref(),resourcepacks:cachedManifest.base.resourcepacks.deref(),shaders:cachedManifest.base.shaders.deref()},
        } : undefined)) : undefined
      const scanned = delta ? applyContentDelta(base as ContentRows, delta) : await api?.scanBuildIntentContent?.(targetPath)
      if (!scanned) return null

      const mergeContent = (existing: BuildMod[], incoming: BuildMod[]) => {
        const normalize = (value?: string) => value?.trim().toLowerCase() ?? ""
        const existingBySlug = new Map(existing.map(item => [item.slug.toLowerCase(), item]))
        const existingByName = new Map(existing.map(item => [item.name.toLowerCase(), item]))

        const merged = incoming.map(raw => {
          const item = normalizeContentDto(raw)
          const incomingSlug = normalize(item.slug)
          const incomingName = normalize(item.name)
          const matched = existingBySlug.get(incomingSlug)
            ?? existingByName.get(incomingName)
            ?? existing.find(existingItem => {
              const existingSlug = normalize(existingItem.slug)
              const existingName = normalize(existingItem.name)
              return existingSlug === incomingSlug
                || existingName === incomingName
                || existingSlug.includes(incomingName)
                || incomingSlug.includes(existingName)
            })

          if (!matched) return item

          // Источник — это знание о том, ОТКУДА пользователь установил мод
          // (curseforge/modrinth), а не догадка сканера по хэшу файла. Скан
          // может ошибочно определить мод как modrinth, даже если он скачан с
          // CurseForge (мод есть на обеих площадках). Поэтому известный
          // не-local источник из matched всегда приоритетнее источника скана.
          const matchedSource = matched.source
          const matchedKnowsSource = matchedSource === "modrinth" || matchedSource === "curseforge"
          const resolvedSource = matchedKnowsSource
            ? matchedSource
            : (item.source && item.source !== "local" ? item.source : matchedSource ?? item.source)

          // Идентификаторы площадки берём только из источника, который победил,
          // чтобы curseforge-мод не получил modrinth projectId и наоборот.
          const sameSourceAsResolved = item.source === resolvedSource
          const resolvedProjectId = resolvedSource === "modrinth"
            ? (item.projectId ?? matched.projectId)
            : undefined
          const resolvedModId = resolvedSource !== "modrinth"
            ? (item.modId ?? matched.modId)
            : undefined

          return normalizeContentDto({
            ...item,
            // Путь с диска обязателен: старый slug может относиться к другой версии файла.
            slug: item.slug,
            name: item.name && item.name.length > 1 ? item.name : matched.name || item.name,
            description: matched.description || item.description,
            icon_url: reconcileContentIcon(matched.icon_url, item.icon_url),
            source: resolvedSource,
            projectId: sameSourceAsResolved ? resolvedProjectId : matched.projectId,
            modId: sameSourceAsResolved ? resolvedModId : matched.modId,
            // Обновлённые данные той же площадки должны сходиться со сканером.
            // При разных источниках сохраняем выбранного пользователем автора.
            author: sameSourceAsResolved ? item.author || matched.author : matched.author || item.author,
            ...retainInstalledIdentity(matched, item),
          })
        })
        return reconcileContentRows(existing, merged)
      }

      return {
        ...build,
        scanManifest: delta?.manifest,
        mods: Array.isArray(scanned.mods) ? mergeContent(build.mods, scanned.mods) : build.mods,
        resourcepacks: Array.isArray(scanned.resourcepacks) ? mergeContent(build.resourcepacks, scanned.resourcepacks) : build.resourcepacks,
        shaders: Array.isArray(scanned.shaders) ? mergeContent(build.shaders, scanned.shaders) : build.shaders,
        installedMods: reconcileContentPaths(build.installedMods ?? {}, scanned.installedMods ?? build.installedMods ?? {}),
      }
    } catch {
      return null
    }
  }, [])

  /**
   * Догружает тяжёлый контент сборки (mods/resourcepacks/shaders) по требованию —
   * когда сборку открыли. Список сборок держит только счётчики, поэтому вход во
   * вкладку не тянет десятки мегабайт.
   */
  const loadBuildContentOnce = useCallback(async (buildId: string): Promise<boolean> => {
    if (contentMutationsRef.current.has(buildId)) return true
    if (displayedContentRef.current.has(buildId)) return true
    const contentSeq = contentScanSeqRef.current.get(buildId) ?? 0
    const cached = buildContentCache.get(buildId)
    if (cached) {
      displayedContentRef.current.add(buildId)
      setBuilds(prev => prev.map(build => build.id === buildId
        ? contentMutationsRef.current.has(buildId) || (contentScanSeqRef.current.get(buildId) ?? 0) !== contentSeq ? build : { ...build, mods: cached.mods, resourcepacks: cached.resourcepacks, shaders: cached.shaders, installedMods: cached.installedMods }
        : build))
      return true
    }
    try {
      const content = await window.electrobunAPI?.loadBuildContent?.(buildId)
      if (!content) return false
      const parsed = {
        mods: Array.isArray(content.mods) ? content.mods as BuildMod[] : [],
        resourcepacks: Array.isArray(content.resourcepacks) ? content.resourcepacks as BuildMod[] : [],
        shaders: Array.isArray(content.shaders) ? content.shaders as BuildMod[] : [],
        installedMods: content.installedMods ?? {},
      }
      if ((contentScanSeqRef.current.get(buildId) ?? 0) !== contentSeq || contentMutationsRef.current.has(buildId)) return true
      const enriched = parsed
      displayedContentRef.current.add(buildId)
      updateCachedBuildContent(buildId, enriched)
      savedContentRef.current.set(buildId, enriched)
      setBuilds(prev => contentMutationsRef.current.has(buildId) || (contentScanSeqRef.current.get(buildId) ?? 0) !== contentSeq
        ? prev : prev.map(build => build.id === buildId ? { ...build, ...enriched } : build))
      return true
    } catch {
      // Контент не критичен для отрисовки: при ошибке оставляем счётчики.
      return false
    }
  }, [setBuilds])

  const ensureBuildContent = useCallback((buildId:string):Promise<boolean> => {
    const active=contentLoadsRef.current.get(buildId)
    if(active)return active
    const task=loadBuildContentOnce(buildId).finally(()=>{if(contentLoadsRef.current.get(buildId)===task)contentLoadsRef.current.delete(buildId)})
    contentLoadsRef.current.set(buildId,task)
    return task
  },[loadBuildContentOnce])

  const releaseColdContent = useCallback(() => {
    const dirtyContent = new Set(pendingPatchesRef.current.filter(patch => Object.keys(patch.fields).some(key => CONTENT_PATCH_FIELDS.has(key))).map(patch => patch.id))
    const cold = new Set(buildsRef.current.filter(build => build.id !== activeBuildIdRef.current
      && displayedContentRef.current.has(build.id) && !buildContentCache.has(build.id)
      && !contentMutationsRef.current.has(build.id) && !pendingEditsRef.current.has(build.id) && !dirtyContent.has(build.id)
      && !Object.keys(buildWrites.getPending(build.id)).some(key => CONTENT_PATCH_FIELDS.has(key))).map(build => build.id))
    if (!cold.size) return
    for (const id of cold) { displayedContentRef.current.delete(id); savedContentRef.current.delete(id) }
    setBuilds(previous => previous.map(build => cold.has(build.id) && build.id !== activeBuildIdRef.current
      && !buildContentCache.has(build.id) && !contentMutationsRef.current.has(build.id) ? lightSnapshot(build) : build))
  }, [setBuilds])

  // Открыли сборку — подгружаем её контент и обновляем счётчики из скана папки.
  useEffect(() => {
    activeBuildIdRef.current = activeBuildId
    if (!activeBuildId) { releaseColdContent(); return }
    let cancelled = false
    void (async () => {
      await ensureBuildContent(activeBuildId)
      if (cancelled) return
      releaseColdContent()
      void contentRefreshRef.current(activeBuildId)
    })()
    return () => { cancelled = true }
  }, [activeBuildId, ensureBuildContent, releaseColdContent])

  const reloadBuilds = useCallback(async (committedBuildId?: string) => {
    if (committedBuildId) {
      // Main уже атомарно сохранил metadata вместе с файлами. Старый UI — не
      // новый пользовательский intent; его pending/version/content не повторяем.
      buildWrites.discardPackMetadata(committedBuildId)
      contentScanSeqRef.current.set(committedBuildId, (contentScanSeqRef.current.get(committedBuildId) ?? 0) + 1)
      const pending = pendingEditsRef.current.get(committedBuildId)
      if (pending) pendingEditsRef.current.set(committedBuildId, Object.fromEntries(Object.entries(pending)
        .filter(([key]) => !PACK_METADATA_FIELDS.some(field => field === key))))
      buildContentCache.delete(committedBuildId)
      displayedContentRef.current.delete(committedBuildId)
    }
    // Flush pending save before reloading so in-memory changes aren't lost.
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      const pending = pendingPatchesRef.current
      pendingPatchesRef.current = []
      for (const patch of pending) {
        try {
          const fields = currentPatchFields(patch)
          if (Object.keys(fields).length) await buildWrites.write(patch.id, fields, key => Object.hasOwn(currentPatchFields(patch), key))
        }
        catch (error) { console.error("[Builds] Failed to flush pending changes", patch.id, error) }
      }
    }

    try { await buildWrites.flush() } catch (error) { console.error("[Builds] Pending writes retained", error) }
    isReloadingRef.current = true
    const seq = ++reloadSeqRef.current
    try {
      let committedContent: { mods: BuildMod[]; resourcepacks: BuildMod[]; shaders: BuildMod[]; installedMods: Record<string, string> } | undefined
      if (committedBuildId) {
        const content = await window.electrobunAPI?.loadBuildContent(committedBuildId)
        if (seq !== reloadSeqRef.current) return
        if (!content) throw new Error("Committed build content is unavailable")
        committedContent = content as typeof committedContent
        updateCachedBuildContent(committedBuildId, committedContent!)
      }
      // Лёгкий список: контент сборок приходит из buildContentCache или уже
      // загруженного состояния, а не из этого запроса.
      const rawBuilds = await window.electrobunAPI?.loadBuildsLight()
      if (seq !== reloadSeqRef.current) return
      const dbBuilds = (Array.isArray(rawBuilds) ? rawBuilds : []) as BuildWithCounts[]

      // Пустой ответ — это либо «сборок действительно нет», либо сбой IPC /
      // недоступная БД (они тоже отдают пустой список). Раньше в обоих случаях
      // вызывался setBuilds([]), и уже показанный список исчезал: интерфейс
      // «выгружался» и грузился заново. Теперь непустой список сохраняем.
      if (dbBuilds.length === 0) {
        setBuildsHydrated(true)
        window.dispatchEvent(new Event("app:hydrated"))
        if (buildsRef.current.length === 0) {
          setBuilds([])
        } else {
          console.warn("[Builds] Пустой ответ БД — сохраняю уже загруженный список")
        }
        return
      }

      const previousById = new Map(buildsRef.current.map(build => [build.id, build]))
      const previousByName = new Map(buildsRef.current.map(build => [build.name, build]))
      const processed: Build[] = dbBuilds.map(build => {
        const b = build as BuildWithCounts
        const inMemoryBuild = previousById.get(build.id) ?? previousByName.get(build.name)
        // Тяжёлый контент из памяти/кэша: приходит не из лёгкого запроса, а из
        // buildContentCache (или из уже загруженного состояния).
        const cached = build.id === committedBuildId ? committedContent : contentMutationsRef.current.has(build.id) && inMemoryBuild
          ? { mods: inMemoryBuild.mods, resourcepacks: inMemoryBuild.resourcepacks, shaders: inMemoryBuild.shaders, installedMods: inMemoryBuild.installedMods ?? {} }
          : buildContentCache.get(build.id)
        const mods = cached?.mods ?? (Array.isArray(b.mods) ? b.mods : inMemoryBuild?.mods ?? [])
        const resourcepacks = cached?.resourcepacks ?? (Array.isArray(b.resourcepacks) ? b.resourcepacks : inMemoryBuild?.resourcepacks ?? [])
        const shaders = cached?.shaders ?? (Array.isArray(b.shaders) ? b.shaders : inMemoryBuild?.shaders ?? [])
        const normalized = {
          ...build,
          mods,
          resourcepacks,
          shaders,
          intentPath: b.intentPath ?? inMemoryBuild?.intentPath ?? "",
          installedMods: cached?.installedMods ?? b.installedMods ?? inMemoryBuild?.installedMods ?? {},
          modsCount: mods.length > 0 ? mods.length : (b.modsCount ?? inMemoryBuild?.mods.length ?? 0),
          resourcepacksCount: resourcepacks.length > 0 ? resourcepacks.length : (b.resourcepacksCount ?? inMemoryBuild?.resourcepacks.length ?? 0),
          shadersCount: shaders.length > 0 ? shaders.length : (b.shadersCount ?? inMemoryBuild?.shaders.length ?? 0),
        } as Build

        // Правки пользователя, ещё не доехавшие до БД, должны победить снапшот БД —
        // иначе отвязка модпака и прочие изменения откатываются. Применяем по ключам,
        // чтобы осознанные `undefined` (сброс поля) тоже сработали.
        const pending = { ...buildWrites.getPending(normalized.id), ...pendingEditsRef.current.get(normalized.id) }
        if (pending) {
          for (const key of Object.keys(pending) as (keyof Build)[]) {
            if (!CONTENT_PATCH_FIELDS.has(key)) (normalized as Record<string, unknown>)[key] = pending[key]
          }
        }

        return normalized
      })

      // Лёгкий список кэшируем на уровне модуля: следующий вход во вкладку
      // отрисуется мгновенно, без обращения к БД.
      buildsLightCache = processed.map(lightSnapshot)
      buildsLightCacheAt = performance.now()

      // Устанавливаем сборки сразу — UI отрисовывается без ожидания сканирования
      setBuilds(prev => {
        const byId = new Map(prev.map(build => [build.id, build as BuildWithCounts]))
        return processed.map(build => {
          const current = byId.get(build.id)
          if (build.id === committedBuildId || !current || (!displayedContentRef.current.has(build.id) && !contentMutationsRef.current.has(build.id))) return build
          // Лёгкий ответ БД не должен заменять уже показанный список.
          return { ...build, mods: current.mods, resourcepacks: current.resourcepacks, shaders: current.shaders,
            installedMods: current.installedMods, modsCount: current.mods.length,
            resourcepacksCount: current.resourcepacks.length, shadersCount: current.shaders.length }
        })
      })

      // Запоминаем, что уже лежит в БД, чтобы точечное сохранение не писало всё заново.
      savedLightFieldsRef.current = new Map(processed.map(build => [
        build.id,
        Object.fromEntries(LIGHT_BUILD_FIELDS.map(key => [key, (build as unknown as Record<string, unknown>)[key]])),
      ]))
      savedContentRef.current = new Map(processed.map(build => [
        build.id,
        { mods: build.mods, resourcepacks: build.resourcepacks, shaders: build.shaders, installedMods: build.installedMods ?? {} },
      ]))

      // Сканирование папки игры (файловая система) выполняем только для открытой
      // сборки: раньше оно запускалось для всех сразу и тормозило вход во вкладку.
      const activeId = activeBuildIdRef.current
      const toSync = activeId ? processed.filter(build => build.id === activeId) : []
      void Promise.all(toSync.map(async ({ id }) => {
        await ensureBuildContent(id)
        if (seq !== reloadSeqRef.current) return
        void contentRefreshRef.current(id)
      }))
      setBuildsHydrated(true)
      window.dispatchEvent(new Event("app:hydrated"))

      // Main/content-resolver владеет именами и авторами. UI не дублирует
      // обогащение всех списков; ниже остаётся fallback авторов паков без локальных метаданных.
    } catch (error) {
      // Сбой IPC или БД: оставляем уже показанный список как есть. Раньше
      // исключение уходило наружу (unhandled rejection), а список мог очиститься.
      console.error("[Builds] Не удалось обновить список сборок:", error)
    } finally {
      if (seq === reloadSeqRef.current) isReloadingRef.current = false
    }
  }, [currentPatchFields, ensureBuildContent])

  /**
   * Точечная пересинхронизация ОДНОЙ сборки после установки/удаления/обновления
   * контента.
   *
   * Раньше в этих местах вызывался полный `reloadBuilds()`: он перечитывал
   * список всех сборок из БД, перезаписывал их состояние в памяти и запускал
   * фоновое сетевое обогащение имён модов по всем сборкам сразу. Здесь
   * обновляется только изменённая сборка — правки касаются ровно её.
   */
  const refreshBuildContent = useCallback((buildId: string, changed = false) => queueContentRefresh(buildId, changed, async () => {
    if (contentMutationsRef.current.has(buildId)) return
    const current = buildsRef.current.find(build => build.id === buildId)
    if (!current) return
    const scanSeq = (contentScanSeqRef.current.get(buildId) ?? 0) + 1
    contentScanSeqRef.current.set(buildId, scanSeq)
    try {
      const synced = await syncBuildContent(current)
      if (!synced || contentScanSeqRef.current.get(buildId) !== scanSeq) return
      const content = {
        mods: synced.mods, resourcepacks: synced.resourcepacks, shaders: synced.shaders,
        installedMods: synced.installedMods ?? {},
      }
      if (synced.scanManifest) scanManifestsRef.current.set(buildId, {manifest:synced.scanManifest,base:{mods:new WeakRef(content.mods as ContentRows["mods"]),resourcepacks:new WeakRef(content.resourcepacks as ContentRows["resourcepacks"]),shaders:new WeakRef(content.shaders as ContentRows["shaders"]),installedMods:new WeakRef(content.installedMods)}})
      // Повторное событие watcher/завершения установки часто возвращает тот же
      // снимок. Не сериализуем его снова в main/SQLite и не обновляем React state.
      const saved = savedContentRef.current.get(buildId)
      const patch = buildContentPatch(content, saved, true)
      if (content.mods === current.mods && content.resourcepacks === current.resourcepacks
        && content.shaders === current.shaders && content.installedMods === current.installedMods
        && Object.keys(patch).length === 0) return
      const counts = { modsCount: content.mods.length, resourcepacksCount: content.resourcepacks.length, shadersCount: content.shaders.length }
      // Результат скана после удаления, включая пустую папку, сохраняем явно.
      await buildWrites.write(buildId, {
        ...patch, ...counts,
      }, () => contentScanSeqRef.current.get(buildId) === scanSeq && !contentMutationsRef.current.has(buildId))
      if (contentScanSeqRef.current.get(buildId) !== scanSeq) return
      displayedContentRef.current.add(buildId)
      updateCachedBuildContent(buildId, content)
      setBuilds(prev => contentMutationsRef.current.has(buildId) || contentScanSeqRef.current.get(buildId) !== scanSeq
        ? prev : prev.map(build => build.id === buildId ? { ...build, ...content, ...counts } : build))
      // Снапшот сохранённого контента держим в согласии с новым состоянием,
      // иначе debounce-эффект записи посчитает его изменившимся и запишет заново.
      savedContentRef.current.set(buildId, content)
    } catch {
      // Синхронизация вторична: состояние в памяти уже обновлено точечно.
    }
  }), [queueContentRefresh, syncBuildContent, setBuilds])
  contentRefreshRef.current = refreshBuildContent

  useEffect(() => {
    const api = window.electrobunAPI
    if (!activeBuildId || !api?.watchBuildContent) return
    const token = crypto.randomUUID()
    let disposed = false
    const off = api.onBuildContentChanged(event => {
      if (!disposed && event.token === token && event.buildId === activeBuildId) void refreshBuildContent(activeBuildId, true)
    })
    void api.watchBuildContent(activeBuildId, token).then(ready => {
      if (ready && !disposed) void refreshBuildContent(activeBuildId, true)
    }).catch(console.error)
    return () => {
      disposed = true
      off()
      void api.unwatchBuildContent(token).catch(console.error)
    }
  }, [activeBuildId, refreshBuildContent])

  const activeBuild = useMemo(() => builds.find(b => b.id === activeBuildId) ?? null, [builds, activeBuildId])

  // Ресурспаки и шейдеры часто не содержат автора в локальных метаданных.
  // У Modrinth он доступен через владельца команды проекта, а не /projects.
  useEffect(() => {
    if (!activeBuild) return
    const packs = [...activeBuild.resourcepacks, ...activeBuild.shaders]
    if (!packs.some(item => item.source === "modrinth" && item.projectId && !item.author)) return
    let cancelled = false
    const buildId = activeBuild.id
    void enrichBuildModNames(packs, { includeOwners: true }).then(enriched => {
      if (cancelled) return
      setBuilds(previous => previous.map(build => {
        if (build.id !== buildId) return build
        let changed = false
        const authors = new Map(enriched.filter(item => item.projectId && item.author).map(item => [item.projectId!, item.author!]))
        const addAuthor = (item: BuildMod): BuildMod => {
          const author = item.source === "modrinth" && !item.author && item.projectId ? authors.get(item.projectId) : undefined
          if (!author) return item
          changed = true
          return { ...item, author }
        }
        const resourcepacks = build.resourcepacks.map(addAuthor)
        const shaders = build.shaders.map(addAuthor)
        if (!changed) return build
        // Дополненный в UI владелец — проекция прежнего scanner DTO, а не
        // изменение файла. Сохраняем baseline и для этих новых массивов.
        const baseline = scanManifestsRef.current.get(buildId)
        if (baseline) {
          baseline.base.resourcepacks = new WeakRef(resourcepacks as ContentRows["resourcepacks"])
          baseline.base.shaders = new WeakRef(shaders as ContentRows["shaders"])
        }
        updateCachedBuildContent(buildId, { mods: build.mods, resourcepacks, shaders, installedMods: build.installedMods ?? {} })
        return { ...build, resourcepacks, shaders }
      }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeBuild?.id, activeBuild?.resourcepacks, activeBuild?.shaders, setBuilds])

  useEffect(() => {
    // Кэш показываем сразу и в любом случае: список не должен «выгружаться» на
    // время обновления. Раньше при протухшем кэше (TTL был 3 с) сначала шёл
    // запрос в БД, и до его ответа на экране не было данных.
    if (buildsLightCache) {
      const snapshots = cachedSnapshots(buildsLightCache)
      savedLightFieldsRef.current = new Map(snapshots.map(build => [build.id, Object.fromEntries(LIGHT_BUILD_FIELDS.map(key => [key, (build as unknown as Record<string, unknown>)[key]]))]))
      savedContentRef.current = new Map(snapshots.filter(build => buildContentCache.has(build.id)).map(build => [build.id, { mods: build.mods, resourcepacks: build.resourcepacks, shaders: build.shaders, installedMods: build.installedMods ?? {} }]))
      setBuilds(snapshots)
      setBuildsHydrated(true)
      window.dispatchEvent(new Event("app:hydrated"))
      // Устаревшие данные обновляем в фоне — уже показанный список при этом
      // остаётся на экране (stale-while-revalidate).
      if (performance.now() - buildsLightCacheAt >= BUILDS_CACHE_TTL_MS) {
        void reloadBuilds()
      }
      return
    }
    void reloadBuilds()
  }, [reloadBuilds, setBuilds])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.type === "build") {
        void reloadBuilds()
      }
    }
    window.addEventListener("cloud:imported", handler)
    const agentHandler = () => { void reloadBuilds() }
    window.addEventListener("launcher:agent-updated", agentHandler)
    const shareHandler = () => { buildsLightCache = null; buildContentCache.clear(); void reloadBuilds() }
    window.addEventListener("launcher:share-updated", shareHandler)
    const modpackHandler = (event: Event) => {
      const buildId: unknown = (event as CustomEvent).detail?.buildId
      if (typeof buildId === "string" && buildId) void reloadBuilds(buildId)
    }
    window.addEventListener("launcher:modpack-updated", modpackHandler)
    const offShare = window.electrobunAPI?.onShareInstalled(shareHandler)
    return () => {
      window.removeEventListener("cloud:imported", handler)
      window.removeEventListener("launcher:agent-updated", agentHandler)
      window.removeEventListener("launcher:share-updated", shareHandler)
      window.removeEventListener("launcher:modpack-updated", modpackHandler)
      offShare?.()
    }
  }, [reloadBuilds])

  /**
   * Точечное сохранение: раньше на каждое изменение делался JSON.stringify всего
   * списка и полная перезапись таблицы через IPC — у модпаков это десятки мегабайт
   * (только моды одной сборки весят 20+ МБ), из-за чего был заметный пролаг при
   * уходе с вкладки. Теперь для каждой сборки пишем только изменившиеся поля,
   * а тяжёлый контент сравниваем по ссылке на массив, а не по содержимому.
   */
  useEffect(() => {
    if (!buildsHydrated || isReloadingRef.current) return

    const patches: Array<{ id: string; fields: Record<string, unknown>; build: Build; contentSeq: number }> = []
    for (const build of builds) {
      const fields: Record<string, unknown> = {}
      const savedLight = savedLightFieldsRef.current.get(build.id)
      for (const key of LIGHT_BUILD_FIELDS) {
        const value = (build as unknown as Record<string, unknown>)[key]
        if (!savedLight || savedLight[key] !== value) fields[key] = value
      }
      const savedContent = savedContentRef.current.get(build.id)
      if (!contentMutationsRef.current.has(build.id)) Object.assign(fields, buildContentPatch(build, savedContent, buildContentCache.has(build.id)))
      if (Object.keys(fields).length > 0) patches.push({ id: build.id, fields, build, contentSeq: contentScanSeqRef.current.get(build.id) ?? 0 })
    }
    if (patches.length === 0) return

    if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current)
    // Держим патчи, чтобы успеть дописать их при уходе с вкладки (unmount).
    pendingPatchesRef.current = patches.map(patch => ({ id: patch.id, fields: patch.fields, contentSeq: patch.contentSeq }))
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      pendingPatchesRef.current = []
      void (async () => {
        for (const patch of patches) {
          // Одна сборка не должна блокировать сохранение остальных: раньше
          // ошибка любого патча прерывала весь цикл, и правки после неё терялись.
          try {
            const fields = currentPatchFields(patch)
            if (!Object.keys(fields).length) continue
            await buildWrites.write(patch.id, fields, key => Object.hasOwn(currentPatchFields(patch), key))
            const light = savedLightFieldsRef.current.get(patch.id) ?? {}
            for (const key of Object.keys(fields)) light[key] = fields[key]
            savedLightFieldsRef.current.set(patch.id, light)
            if (Object.keys(currentPatchFields(patch)).some(key => CONTENT_PATCH_FIELDS.has(key))) savedContentRef.current.set(patch.id, {
              mods: patch.build.mods,
              resourcepacks: patch.build.resourcepacks,
              shaders: patch.build.shaders,
              installedMods: patch.build.installedMods ?? {},
            })
            const remaining = acknowledgeBuildEdits(pendingEditsRef.current.get(patch.id), fields)
            if (Object.keys(remaining).length) pendingEditsRef.current.set(patch.id, remaining)
            else pendingEditsRef.current.delete(patch.id)
          } catch (error) {
            console.error("[Builds] Debounced save failed for build", patch.id, error)
          }
        }
      })()
    }, 200)
  }, [builds, buildsHydrated, currentPatchFields])

  // Уходим с вкладки — дописываем несохранённые правки, иначе последнее изменение
  // (например, только что переименованная сборка) терялось.
  useEffect(() => () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    for (const patch of pendingPatchesRef.current) {
      const fields = currentPatchFields(patch)
      if (Object.keys(fields).length) void buildWrites.write(patch.id, fields, key => Object.hasOwn(currentPatchFields(patch), key)).catch(error => console.error("[Builds] Unmount save retained", error))
    }
    pendingPatchesRef.current = []
  }, [currentPatchFields])

  const createBuild = useCallback(async (params: { name: string; description: string; version: string; modLoader: string; loaderVersion?: string; icon: string }) => {
    const trimmedName = params.name.trim()
    if (!trimmedName) return
    const id = crypto.randomUUID()
    let intentPath = ""
    try {
      intentPath = await window.electrobunAPI?.getBuildIntentPath(trimmedName) ?? ""
      await window.electrobunAPI?.setBuildIntentPath(trimmedName, intentPath)
    } catch {}
    const newBuild: Build = {
      id, name: trimmedName, description: params.description.trim(),
      version: params.version, modLoader: params.modLoader, loaderVersion: params.loaderVersion,
      icon: params.icon, coverImage: params.icon || undefined,
      mods: [], resourcepacks: [], shaders: [],
      createdAt: new Date().toISOString(), source: "local",
      intentPath, installedMods: {}, playtime: 0,
    }
    setBuilds(prev => [newBuild, ...prev])

    // Запись в БД сразу и явной вставкой: debounce-сохранение работает патчами
    // (`UPDATE ... WHERE id = ?`), а по несуществующей строке это no-op — сборка
    // жила только в памяти и пропадала после перезапуска лаунчера.
    try {
      await window.electrobunAPI?.insertBuild?.(newBuild as unknown as Parameters<NonNullable<Window["electrobunAPI"]>["insertBuild"]>[0])
      savedLightFieldsRef.current.set(id, Object.fromEntries(
        LIGHT_BUILD_FIELDS.map(key => [key, (newBuild as unknown as Record<string, unknown>)[key]]),
      ))
      savedContentRef.current.set(id, { mods: newBuild.mods, resourcepacks: newBuild.resourcepacks, shaders: newBuild.shaders, installedMods: newBuild.installedMods ?? {} })
    } catch (error) {
      console.error("[Builds] Не удалось записать новую сборку в БД", id, error)
    }
  }, [setBuilds])

  const deleteBuild = useCallback(async (id: string) => {
    const build = builds.find(b => b.id === id)
    if (build) {
      try {
        await window.electrobunAPI?.deleteBuildIntent(build.name)
      } catch {}
      try {
        const lastVersion = localStorage.getItem("xneon-launcher:lastVersion")
        if (lastVersion === build.name) {
          localStorage.removeItem("xneon-launcher:lastVersion")
        }
      } catch {}
    }
    setBuilds(prev => prev.filter(b => b.id !== id))
    setActiveBuildId(prev => prev === id ? null : prev)
    pendingEditsRef.current.delete(id)
  }, [builds])

  type TrashSnapshot = {
    build: Build
    trashName?: string
  }
  const trashStackRef = useRef<TrashSnapshot[]>([])

  const trashBuild = useCallback(async (id: string): Promise<boolean> => {
    const build = builds.find(b => b.id === id)
    if (!build) return false
    let trashName: string | undefined
    try {
      // Метаданные сборки хранятся только в БД; при удалении записи они потерялись бы.
      // Отдаём их main-процессу, чтобы он сохранил снапшот рядом с папкой в корзине —
      // тогда восстановление вернёт сборку целиком, без перезахода.
      const result = await window.electrobunAPI?.moveBuildIntentToTrash?.(build.name, build as unknown as Record<string, unknown>)
      // Перемещение может не пройти: папку держит другой процесс (EBUSY/EPERM —
      // антивирус, индексатор, открытый файл), диск занят, прав нет. Раньше ответ
      // не проверялся, сборка убиралась из списка «всё равно», а запись в БД
      // оставалась — список пустел, но при следующем входе сборка «воскресала».
      // Неудачу показываем как ошибку и НЕ трогаем ни состояние, ни UI.
      if (!result?.success) {
        pushNotification({
          kind: "error",
          source: "install",
          title: t("builds.trashFailedTitle"),
          // Сырой текст Node («EBUSY: resource busy or locked, rmdir …») не
          // переводится — превращаем его в локализованную подсказку по коду.
          message: fsErrorMessage(t, result?.error),
        })
        return false
      }
      trashName = result.trashName
    } catch (error) {
      pushNotification({
        kind: "error",
        source: "install",
        title: t("builds.trashFailedTitle"),
        message: fsErrorMessage(t, error instanceof Error ? error.message : String(error)),
      })
      return false
    }
    try {
      const lastVersion = localStorage.getItem("xneon-launcher:lastVersion")
      if (lastVersion === build.name) {
        localStorage.removeItem("xneon-launcher:lastVersion")
      }
    } catch {}
    trashStackRef.current.push({ build, trashName })
    if (trashStackRef.current.length > 30) {
      trashStackRef.current.shift()
    }
    setBuilds(prev => prev.filter(b => b.id !== id))
    setActiveBuildId(prev => prev === id ? null : prev)
    pendingEditsRef.current.delete(id)
    return true
  }, [builds, pushNotification, t])

  const undoTrashBuild = useCallback(async (): Promise<Build | null> => {
    const snapshot = trashStackRef.current.pop()
    if (!snapshot) return null
    const { build, trashName } = snapshot
    if (trashName) {
      try { await window.electrobunAPI?.restoreBuildIntentFromTrash?.(build.name, trashName) } catch {}
    }
    setBuilds(prev => [build, ...prev])
    setActiveBuildId(build.id)
    return build
  }, [])

  const purgeBuildTrash = useCallback(async (): Promise<void> => {
    trashStackRef.current = []
    try { await window.electrobunAPI?.purgeBuildTrash?.() } catch {}
  }, [])

  /**
   * Восстановление сборки из корзины по записи файловой системы.
   *
   * Папка интента и снапшот метаданных восстанавливаются в main-процессе, но запись
   * в БД и состояние UI обновляются здесь. Без этого сборка появлялась в списке
   * только после перезапуска приложения: список читается из БД, где записи уже нет.
   */
  const restoreBuildFromTrash = useCallback(async (item: { trashName: string; originalName: string }): Promise<boolean> => {
    try {
      const result = await window.electrobunAPI?.restoreBuildIntentFromTrash?.(item.originalName, item.trashName)
      if (!result?.success) return false

      const restored = result.build as Build | undefined
      if (restored) {
        // Main уже восстановил файлы и запись БД. UI не возвращает старые снимки
        // соседних сборок обратно через saveBuilds.
        setBuilds(prev => {
          if (prev.some(b => b.id === restored.id)) return prev
          return [restored, ...prev]
        })
      }

      // Перечитываем состояние, чтобы подтянуть актуальный контент из восстановленной папки.
      await reloadBuilds()
      return true
    } catch {
      return false
    }
  }, [reloadBuilds])

  const duplicatingRef = useRef(new Set<string>())
  const duplicateBuild = useCallback(async (id: string): Promise<Build | null> => {
    const source = buildsRef.current.find(build => build.id === id)
    const api = window.electrobunAPI
    if (!source || !api || duplicatingRef.current.has(id)) return null
    duplicatingRef.current.add(id)
    const liveKey = `duplicate-build:${id}`
    upsertLiveNotification(liveKey, { kind: "progress", source: "install", title: t("builds.copyingTitle"), message: source.name, busy: true, progress: null })
    try {
      let newName = t("builds.copy", { name: source.name })
      let counter = 2
      while (buildsRef.current.some(build => build.name.toLowerCase() === newName.toLowerCase())) {
        newName = t("builds.copyN", { name: source.name, counter: counter++ })
      }
      // В лёгком списке массивы пусты: сначала загружаем полные метаданные.
      const content = buildContentCache.get(id) ?? await api.loadBuildContent(id)
      const result = await api.copyBuild(source.name, newName)
      if (!result.success || !result.intentPath) throw new Error(result.error || "Instance copy failed")
      const copy: Build = {
        ...source,
        id: crypto.randomUUID(), name: newName, intentPath: result.intentPath,
        createdAt: new Date().toISOString(), playtime: 0,
        mods: (content?.mods as BuildMod[] ?? source.mods).map(item => ({ ...item, id: crypto.randomUUID() })),
        resourcepacks: (content?.resourcepacks as BuildMod[] ?? source.resourcepacks).map(item => ({ ...item, id: crypto.randomUUID() })),
        shaders: (content?.shaders as BuildMod[] ?? source.shaders).map(item => ({ ...item, id: crypto.randomUUID() })),
        installedMods: {},
      }
      // Скан новой папки восстанавливает фактические списки и пути installedMods.
      const newBuild = await syncBuildContent(copy) ?? copy
      await api.insertBuild(newBuild as unknown as Parameters<typeof api.insertBuild>[0])
      savedLightFieldsRef.current.set(newBuild.id, Object.fromEntries(
        LIGHT_BUILD_FIELDS.map(key => [key, (newBuild as unknown as Record<string, unknown>)[key]]),
      ))
      savedContentRef.current.set(newBuild.id, {
        mods: newBuild.mods, resourcepacks: newBuild.resourcepacks, shaders: newBuild.shaders, installedMods: newBuild.installedMods ?? {},
      })
      updateCachedBuildContent(newBuild.id, {
        mods: newBuild.mods, resourcepacks: newBuild.resourcepacks, shaders: newBuild.shaders, installedMods: newBuild.installedMods ?? {},
      })
      setBuilds(previous => [newBuild, ...previous])
      return newBuild
    } catch (error) {
      console.error("[Builds] Не удалось скопировать сборку", source.name, error)
      pushNotification({ kind: "error", source: "install", title: t("builds.copyFailedTitle"), message: fsErrorMessage(t, error instanceof Error ? error.message : String(error)) })
      return null
    } finally {
      duplicatingRef.current.delete(id)
      removeLiveNotification(liveKey)
    }
  }, [setBuilds, syncBuildContent, t, pushNotification, upsertLiveNotification, removeLiveNotification])

  const exportBuildZip = useCallback(async (id: string, categories?: BuildExportCategory[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: t("builds.errors.notFound") }
    return await window.electrobunAPI?.exportBuildZip?.(build.name, build.name, categories) ?? { success: false, error: t("builds.errors.unavailable") }
  }, [builds])

  const exportBuildModlist = useCallback(async (id: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"): Promise<{ success: boolean; path?: string; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: t("builds.errors.notFound") }
    return await window.electrobunAPI?.exportBuildModlist?.(build.name, build.name, format) ?? { success: false, error: t("builds.errors.unavailable") }
  }, [builds])

  const renameBuild = useCallback(async (id: string, newName: string): Promise<{ success: boolean; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: t("builds.errors.notFound") }
    const target = newName.trim()
    if (!target) return { success: false, error: t("builds.errors.emptyName") }
    if (target === build.name) return { success: true }
    if (builds.some(b => b.id !== id && b.name === target)) {
      return { success: false, error: t("builds.errors.duplicateName") }
    }
    try {
      const result = await window.electrobunAPI?.renameBuildIntent?.(build.name, target)
      if (result?.success) {
        // Название должно попасть в следующий скан Share сразу после переименования.
        await buildWrites.write(id, { name: target, intentPath: result.intentPath ?? build.intentPath })
        setBuilds(prev => prev.map(b => b.id === id
          ? { ...b, name: target, intentPath: result.intentPath ?? b.intentPath }
          : b))
        return { success: true }
      }
      return { success: false, error: result?.error ?? t("builds.errors.renameFailed") }
    } catch {
      return { success: false, error: t("builds.errors.renameFailed") }
    }
  }, [builds, setBuilds])

  const updateBuild = useCallback((id: string, fields: Partial<Build>) => {
    // Буферизуем правку: если между ней и записью в БД случится reloadBuilds,
    // он не должен вернуть старые значения из снапшота БД.
    const pending = pendingEditsRef.current.get(id)
    pendingEditsRef.current.set(id, pending ? { ...pending, ...fields } : { ...fields })
    setBuilds(prev => prev.map(b => b.id === id ? { ...b, ...fields } : b))

    // Мгновенная точечная запись в БД. Без неё правка жила только в памяти до
    // debounce-сейва (200 мс), и быстрое переключение вкладки инстанса успевало
    // откатить её (например, отвязку модпака `locked: false`). Буфер очищаем
    // только после подтверждённой записи — и лишь для тех ключей, что записали.
    void (async () => {
      try {
        await buildWrites.write(id, fields)
        const buffered = pendingEditsRef.current.get(id)
        if (buffered) {
          const rest = acknowledgeBuildEdits(buffered, fields)
          if (Object.keys(rest).length > 0) pendingEditsRef.current.set(id, rest)
          else pendingEditsRef.current.delete(id)
        }
      } catch (error) {
        console.error("[Builds] Immediate field update failed:", error)
        if (isBuildWriteConflict(error)) {
          const rejected = Object.fromEntries(Object.entries(fields).filter(([key]) => PACK_METADATA_FIELDS.some(field => field === key)))
          const remaining = acknowledgeBuildEdits(pendingEditsRef.current.get(id), rejected)
          if (Object.keys(remaining).length) pendingEditsRef.current.set(id, remaining)
          else pendingEditsRef.current.delete(id)
          void reloadBuilds()
        }
      }
    })()
  }, [reloadBuilds])

  const setBuildGroup = useCallback((id: string, group: string) => {
    setBuilds(prev => prev.map(b => b.id === id ? { ...b, group: group || undefined } : b))
  }, [])

  const renameGroup = useCallback((oldName: string, newName: string) => {
    setBuilds(prev => prev.map(b => b.group === oldName ? { ...b, group: newName || undefined } : b))
    renameCategoryIcon(oldName, newName)
    renameDeclaredCategory(oldName, newName)
  }, [renameCategoryIcon, renameDeclaredCategory])

  const deleteGroup = useCallback((group: string) => {
    setBuilds(prev => prev.map(b => b.group === group ? { ...b, group: undefined } : b))
    dropCategoryIcon(group)
    dropDeclaredCategory(group)
  }, [dropCategoryIcon, dropDeclaredCategory])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroupCollapse = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const groups = useMemo(() => {
    // Созданные категории + категории, в которых уже есть сборки.
    const set = new Set<string>(declaredCategories)
    for (const b of builds) { if (b.group) set.add(b.group) }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [builds, declaredCategories])

  const addModToBuild = useCallback(async (buildId: string, mod: ModSearchResult) => {
    const targetBuild = builds.find(b => b.id === buildId)
    const buildName = targetBuild?.name
    if (!buildName) return
    const finishMutation = beginContentMutation(buildId)
    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId || b.mods.some(m => m.slug === mod.slug || m.name === mod.name)) return b
      return {
        ...b,
        installedMods: { ...(b.installedMods ?? {}), [mod.slug]: "" },
        mods: [...b.mods, {
          id: crypto.randomUUID(),
          slug: mod.slug,
          name: mod.name,
          description: mod.summary,
          icon_url: mod.iconUrl,
          version: "latest",
          source: mod.source,
          projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : undefined),
          modId: mod.modId,
          author: mod.author,
        }],
      }
    }))
    const saveRemoteFileToBuild = async (url: string, fileName: string) => {
      return await window.electrobunAPI?.saveModToIntent(buildName, url, fileName)
    }

    const downloadDependency = async (dep: ModDependency, source: string) => {
      if (dep.dependencyType !== "required" || !dep.projectId) return
      try {
        if (source === "modrinth") {
          const versions = await window.electrobunAPI?.modsModrinthVersions(dep.projectId)
          const latestVersion = targetBuild ? pickCompatibleVersion(versions, targetBuild) : versions?.find(v => v.files?.[0]?.url)
          if (latestVersion?.files?.[0]?.url) {
            await saveRemoteFileToBuild(latestVersion.files[0].url, latestVersion.files[0].filename || `${dep.projectId}.jar`)
          }
          return
        }

        const depModId = parseInt(dep.projectId)
        if (isNaN(depModId)) return
        const details = await window.electrobunAPI?.modsCurseforgeDetails(depModId)
        const selectedVersion = targetBuild ? pickCompatibleVersion(details?.versions ?? [], targetBuild) : details?.versions?.[0]
        if (!selectedVersion) return

        const fileId = Number(selectedVersion.id)
        const url = await window.electrobunAPI?.modsCurseforgeDownloadUrl(fileId, depModId)
        if (url) {
          const fileName = selectedVersion.fileName || url.split("/").pop()?.split("?")[0] || `${dep.projectId}.jar`
          await saveRemoteFileToBuild(url, fileName)
        }
      } catch (error) { if (isContentDownloadCancelled(error)) throw error }
    }

    void (async () => {
      try {
        // Уведомление ведём от начала до конца операции: проценты в него дописывает
        // обработчик прогресса из main, а снимаем его мы — сразу по завершении.
        beginContentInstall({
          title: t("builds.mod.installing"),
          message: t("builds.mod.downloading", { name: mod.name }),
          itemName: mod.name,
        })

        if (mod.source === "modrinth") {
          // Версии берём по project_id: slug — «мягкий» идентификатор, автор может его сменить.
          const versions = await window.electrobunAPI?.modsModrinthVersions(mod.projectId ?? mod.slug)
          const selectedVersion = targetBuild ? pickCompatibleVersion(versions, targetBuild) : versions?.find(version => version.files?.[0]?.url)
          if (!selectedVersion?.files?.[0]?.url) {
            endContentInstall()
            return
          }

          const file = selectedVersion.files[0]
          const savedFileName = file.filename || `${mod.slug}-${selectedVersion.id}.jar`
          const savedPath = await saveRemoteFileToBuild(file.url, savedFileName)
          if (savedPath) {
            setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : {
              ...bb,
              installedMods: {
                ...(bb.installedMods ?? {}),
                [savedFileName]: savedPath,
              },
              mods: bb.mods.map(existing => existing.slug === mod.slug || existing.name === mod.name
                ? updatedContentItem({
                    ...existing,
                    source: mod.source,
                    projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : existing.projectId),
                    modId: mod.modId ?? existing.modId,
                  }, selectedVersion)
                : existing),
            }))
          }

          const deps = await window.electrobunAPI?.modsResolveDependencies(selectedVersion, "modrinth") ?? []
          for (const dep of deps) {
            await downloadDependency(dep, "modrinth")
          }
        } else {
          if (!mod.modId) {
            endContentInstall()
            return
          }
          const details = await window.electrobunAPI?.modsCurseforgeDetails(mod.modId)
          const selectedVersion = targetBuild
            ? pickCompatibleVersion(details?.versions ?? [], targetBuild)
            : details?.versions?.find(version => Number(version.id) === mod.primaryFileId) ?? details?.versions?.[0]
          if (!selectedVersion) {
            endContentInstall()
            return
          }

          const url = await window.electrobunAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), mod.modId)
          if (!url) {
            endContentInstall()
            return
          }

          const fileName = selectedVersion.fileName || mod.primaryFileName || url.split("/").pop()?.split("?")[0] || `mod-${selectedVersion.id}.jar`
          const savedPath = await saveRemoteFileToBuild(url, fileName)
          if (savedPath) {
            setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : {
              ...bb,
              installedMods: {
                ...(bb.installedMods ?? {}),
                [fileName]: savedPath,
              },
              mods: bb.mods.map(existing => existing.slug === mod.slug || existing.name === mod.name
                ? updatedContentItem({
                    ...existing,
                    source: mod.source,
                    projectId: mod.projectId ?? existing.projectId,
                    modId: mod.modId ?? existing.modId,
                  }, { ...selectedVersion, fileName })
                : existing),
            }))
          }

          const deps = await window.electrobunAPI?.modsResolveDependencies(selectedVersion, "curseforge") ?? []
          for (const dep of deps) {
            await downloadDependency(dep, "curseforge")
          }
        }

        setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : {
          ...bb,
          mods: bb.mods,
          resourcepacks: bb.resourcepacks,
          shaders: bb.shaders,
        }))

        endContentInstall()
        pushNotification({
          kind: "success",
          source: "install",
          title: t("builds.mod.installed"),
          message: mod.name,
        })
      } catch (error) {
        endContentInstall()
        if (isContentDownloadCancelled(error)) return
        pushNotification({
          kind: "error",
          source: "install",
          title: t("builds.mod.installFailed"),
          message: mod.name,
        })
      } finally {
        finishMutation()
      }
    })()
  }, [beginContentInstall, beginContentMutation, builds, endContentInstall, pushNotification])

  /**
   * Локальный файл копируется на диск, но запись в список должна попасть в БД
   * немедленно: reloadBuilds() читает снапшот из БД и без этой записи откатывал бы
   * только что добавленный элемент (папка-ресурспак копировалась, а в списке не
   * появлялась). Источник истины здесь — сама БД, а не состояние React: так
   * добавление не зависит от гонки с debounce-сохранением и переживает дроп
   * нескольких файлов подряд.
   */
  const persistLocalAddition = useCallback(async (
    buildId: string,
    apply: (build: Build) => Build,
  ): Promise<Build[] | null> => {
    try {
      // Источник контента — состояние в памяти: точечная запись избавляет от
      // чтения всего массива сборок из БД (раньше здесь грузился полный список
      // вместе с тяжёлым JSON контента).
      const current = buildsRef.current.find(build => build.id === buildId)
      if (!current) return null
      const applied = apply(current)
      const updated: BuildWithCounts = {
        ...applied,
        modsCount: applied.mods.length,
        resourcepacksCount: applied.resourcepacks.length,
        shadersCount: applied.shaders.length,
      }
      const content = {
        mods: updated.mods,
        resourcepacks: updated.resourcepacks,
        shaders: updated.shaders,
        installedMods: updated.installedMods ?? {},
      }
      await buildWrites.write(buildId, { ...content, modsCount: content.mods.length, resourcepacksCount: content.resourcepacks.length, shadersCount: content.shaders.length })
      if (buildsRef.current.find(build => build.id === buildId) !== current) return buildsRef.current
      const next = buildsRef.current.map(build => (build.id === buildId ? updated : build))
      // Память держим в согласии с записанным: помечаем контент и снапшот
      // сохранёнными, иначе отложенный debounce отправит более старый снапшот
      // и затрёт только что добавленный элемент.
      savedContentRef.current.set(buildId, content)
      lastSavedSnapshotRef.current = JSON.stringify(next)
      setBuilds(next)
      return next
    } catch (error) {
      console.error("[Builds] Failed to persist local content:", error)
      return null
    }
  }, [setBuilds])

  const addLocalModToBuild = useCallback(async (buildId: string, file: File) => {
    const modName = file.name.replace(/\.jar$|\.zip$|\.litemod$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    const localPath = await window.electrobunAPI?.getFilePath(file)
    let savedPath = ""
    const buildName = builds.find(b => b.id === buildId)?.name
    if (!localPath || !buildName) return
    const finishMutation = beginContentMutation(buildId)
    try {
    if (localPath && buildName) {
      try { savedPath = await window.electrobunAPI?.saveLocalModToIntent(buildName, localPath) ?? "" } catch {}
    }
    if (!savedPath) return
    // Мод бросили как есть — никаких проверок зависимостей и запросов к API.
    // Читаем только метаданные архива, чтобы в списке были имя, версия и автор.
    const metadata = localPath ? await window.electrobunAPI?.readLocalContentMetadata(localPath) : null

    const addMod = (b: Build): BuildWithCounts => {
      if (b.mods.some(m => m.slug === file.name)) return b
      return {
        ...b,
        modsCount: b.mods.length + 1,
        installedMods: { ...(b.installedMods ?? {}), [file.name]: savedPath },
        mods: [...b.mods, {
          id: crypto.randomUUID(),
          slug: file.name,
          name: metadata?.name || modName,
          description: metadata?.description || t("builds.mod.local"),
          icon_url: metadata?.icon_url,
          version: metadata?.version || "local",
          author: metadata?.author,
        }],
      }
    }

    setBuilds(prev => prev.map(b => b.id === buildId ? addMod(b) : b))
    // Запись в БД + синхронизация памяти: reloadBuilds() здесь не нужен, потому
    // что метаданные уже прочитаны из архива.
    await persistLocalAddition(buildId, addMod)
    } finally { finishMutation() }
  }, [beginContentMutation, builds, t, persistLocalAddition])

  const addContentToBuild = useCallback(async (buildId: string, type: Exclude<BuildContentListKey, "mods">, mod: ModSearchResult, requestedVersion?: ModVersion): Promise<boolean> => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return false
    const finishMutation = beginContentMutation(buildId)

    const contentTypeLabel = type === "resourcepacks" ? t("builds.content.resourcepack") : t("builds.content.shader")

    // Уведомление ведём от клика до конца операции: проценты в него дописывает
    // обработчик прогресса из main, а снимаем его мы — сразу по завершении.
    beginContentInstall({
      title: t("builds.content.installing", { type: contentTypeLabel }),
      message: t("builds.mod.downloading", { name: mod.name }),
      itemName: mod.name,
    })

    try {
      const versions = requestedVersion ? [requestedVersion] : mod.source === "modrinth"
        ? await window.electrobunAPI?.modsModrinthVersions(mod.projectId ?? mod.slug)
        : mod.modId
          ? await window.electrobunAPI?.modsCurseforgeDetails(mod.modId).then(details => details?.versions ?? [])
          : []

      const selectedVersion = requestedVersion ?? (mod.source === "modrinth"
        ? pickCompatibleVersion(versions, build, false)
        : versions?.find(version => Number(version.id) === mod.primaryFileId) ?? versions?.[0]
      )

      let fileUrl = ""
      let fileName = ""

      if (mod.source === "modrinth") {
        const file = selectedVersion?.files?.[0]
        fileUrl = file?.url || selectedVersion?.downloadUrl || ""
        fileName = file?.filename || selectedVersion?.fileName || `${mod.slug}.zip`
      } else if (mod.modId && selectedVersion) {
        fileUrl = await window.electrobunAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), mod.modId) ?? ""
        fileName = selectedVersion.fileName || mod.primaryFileName || fileUrl.split("/").pop()?.split("?")[0] || `${mod.slug}.zip`
      }

      if (!fileUrl) {
        throw new Error(t("addon.install.failed"))
      }

      const savedPath = await window.electrobunAPI?.saveContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], fileUrl, fileName)
      if (!savedPath) {
        pushNotification({
          kind: "error",
          source: "install",
          title: t("builds.content.installFailed", { type: contentTypeLabel }),
          message: mod.name,
        })
        return false
      }

      const fallbackEntry: BuildMod = {
        id: crypto.randomUUID(),
        slug: fileName,
        name: mod.name,
        description: mod.summary,
        icon_url: mod.iconUrl,
        version: selectedVersion?.versionNumber || selectedVersion?.name || "local",
        source: mod.source,
        projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : undefined),
        modId: mod.modId,
        author: mod.author,
      }

      const installedEntry = selectedVersion ? updatedContentItem(fallbackEntry, { ...selectedVersion, fileName }) : fallbackEntry
      const persisted = await persistLocalAddition(buildId, b => {
        if (b[type].some(item => item.slug === fileName || item.slug === mod.slug)) return b
        return {
          ...b,
          [type]: [...b[type], installedEntry],
          [`${type}Count`]: b[type].length + 1,
        }
      })
      if (!persisted) throw new Error(t("addon.install.failed"))

      pushNotification({
        kind: "success",
        source: "install",
        title: type === "resourcepacks" ? t("builds.content.installedResourcepack") : t("builds.content.installedShader"),
        message: mod.name,
      })
      return true
    } catch (error) {
      if (isContentDownloadCancelled(error)) throw error
      pushNotification({
        kind: "error",
        source: "install",
        title: t("builds.content.installFailed", { type: contentTypeLabel }),
        message: mod.name,
      })
      return false
    } finally {
      endContentInstall()
      finishMutation()
    }
  }, [beginContentInstall, beginContentMutation, builds, endContentInstall, pushNotification, persistLocalAddition, t])

  const addLocalContentToBuild = useCallback(async (buildId: string, type: Exclude<BuildContentListKey, "mods">, file: File) => {
    const build = builds.find(b => b.id === buildId)
    const localPath = await window.electrobunAPI?.getFilePath(file)
    if (!build?.name || !localPath) return
    const finishMutation = beginContentMutation(buildId)
    try {
    const savedPath = await window.electrobunAPI?.saveLocalContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], localPath)
    if (!savedPath) return

    const itemName = file.name.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    // Как и у модов: файл просто кладём в сборку, метаданные читаем из архива
    // (pack.mcmeta у ресурспаков, shaders.properties у шейдеров).
    const metadata = await window.electrobunAPI?.readLocalContentMetadata?.(localPath)
    const fallbackEntry: BuildMod = {
      id: crypto.randomUUID(),
      slug: file.name,
      name: metadata?.name || itemName,
      description: metadata?.description || (type === "resourcepacks" ? t("builds.content.localResourcepack") : t("builds.content.localShader")),
      icon_url: metadata?.icon_url,
      version: metadata?.version || "local",
      author: metadata?.author,
    }

    const addContent = (b: Build): BuildWithCounts => {
      if (b[type].some(item => item.slug === file.name)) return b
      return {
        ...b,
        [type]: [...b[type], fallbackEntry],
      }
    }

    setBuilds(prev => prev.map(b => b.id === buildId ? addContent(b) : b))
    // Запись в БД + синхронизация памяти (см. addLocalModToBuild).
    await persistLocalAddition(buildId, addContent)
    } finally { finishMutation() }
  }, [beginContentMutation, builds, t, persistLocalAddition])

  const removeContentFromBuild = useCallback(async (buildId: string, type: BuildContentListKey, item: BuildMod) => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return false
    const finishMutation = beginContentMutation(buildId)
    const current = buildsRef.current.find(b => b.id === buildId) ?? build
    const index = current[type].findIndex(entry => entry.slug === item.slug)
    const original = current[type][index] ?? item
    const oldPath = current.installedMods?.[item.slug]
    const removeItem = (b: Build): Build => {
      if (b.id !== buildId) return b
      const nextInstalledMods = { ...(b.installedMods ?? {}) }
      if (type === "mods") {
        delete nextInstalledMods[item.slug]
      }
      const content = b[type].filter(existing => existing.slug !== item.slug)
      return {
        ...b,
        [type]: content,
        [`${type}Count`]: content.length,
        installedMods: type === "mods" ? nextInstalledMods : b.installedMods,
      }
    }
    const apply = (edit: (value: Build) => Build) => {
      const next = buildsRef.current.map(edit)
      buildsRef.current = next
      const updated = next.find(b => b.id === buildId)
      if (updated) updateCachedBuildContent(buildId, { mods: updated.mods, resourcepacks: updated.resourcepacks, shaders: updated.shaders, installedMods: updated.installedMods ?? {} })
      setBuilds(prev => prev.map(edit))
    }
    apply(removeItem)
    let success = false
    try {
      const result = await window.electrobunAPI?.deleteContentFromIntent?.(build.name, CONTENT_KIND_BY_KEY[type], item.slug)
      success = result?.success === true
    } catch { /* Возвращаем запись, если файл удалить не удалось. */ }
    try {
      if (!success) apply(b => {
        if (b.id !== buildId || b[type].some(entry => entry.slug === original.slug)) return b
        const content = [...b[type]]
        content.splice(index < 0 ? content.length : Math.min(index, content.length), 0, original)
        return { ...b, [type]: content, [`${type}Count`]: content.length, installedMods: type === "mods" && oldPath !== undefined ? { ...b.installedMods, [item.slug]: oldPath } : b.installedMods }
      })
      return success
    } finally { finishMutation() }
  }, [beginContentMutation, builds, setBuilds])

  const toggleItemEnabled = useCallback(async (buildId: string, type: BuildContentListKey, itemId: string) => {
    const build = builds.find(b => b.id === buildId)
    const item = build?.[type].find(entry => entry.id === itemId)
    if (!build || !item) return false

    const enabled = !(item.enabled ?? true)
    const finishMutation = beginContentMutation(buildId)
    try {
    const result = await window.electrobunAPI?.setContentEnabled?.(build.name, CONTENT_KIND_BY_KEY[type], item.slug, enabled)
    if (!result?.success) return false

    setBuilds(prev => prev.map(b => b.id !== buildId ? b : {
      ...b,
      [type]: b[type].map(entry => entry.id === itemId
        ? { ...entry, enabled }
        : entry),
    }) as Build[])
    return true
    } finally { finishMutation() }
  }, [beginContentMutation, builds])

  const updateItemVersion = useCallback(async (buildId: string, type: BuildContentListKey, itemId: string, newVersion: ModVersion): Promise<boolean> => {
    const build = buildsRef.current.find(b => b.id === buildId)
    if (!build?.name) return false

    const oldItem = build[type].find(m => m.id === itemId)
    if (!oldItem) return false
    const finishMutation = beginContentMutation(buildId)

    try {
      let file = newVersion.files?.[0]
      if (!file?.url) {
        const url = newVersion.downloadUrl || (oldItem.source === "curseforge" && oldItem.modId
          ? await window.electrobunAPI?.modsCurseforgeDownloadUrl(Number(newVersion.id), oldItem.modId)
          : undefined)
        if (!url) return false
        file = { ...file, url, filename: file?.filename || newVersion.fileName, size: newVersion.fileSize ?? 0 }
        newVersion = { ...newVersion, files: [file] }
      }
      const newFileName = file.filename || newVersion.fileName || `${newVersion.id}.${type === "mods" ? "jar" : "zip"}`
      newVersion = { ...newVersion, files: [{ ...file, filename: newFileName }] }
      const savedPath = type === "mods"
        ? await window.electrobunAPI?.saveModToIntent?.(build.name, file.url, newFileName)
        : await window.electrobunAPI?.saveContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], file.url, newFileName)

      if (!savedPath) return false

      // Удаляем старую версию файла, иначе в папке останется дубликат
      if (oldItem && oldItem.slug !== newFileName) {
        try {
          await window.electrobunAPI?.deleteContentFromIntent?.(build.name, CONTENT_KIND_BY_KEY[type], oldItem.slug)
        } catch {}
      }

      // Проверка обновлений читает БД: успех возвращаем только после записи
      // новой идентичности, не дожидаясь debounce или сетевого обогащения скана.
      const persisted = await persistLocalAddition(buildId, b => {
        const nextInstalledMods = { ...(b.installedMods ?? {}) }
        if (type === "mods") {
          delete nextInstalledMods[oldItem.slug]
          nextInstalledMods[newFileName] = savedPath
        }

        return {
          ...b,
          installedMods: nextInstalledMods,
          [type]: b[type].map(m =>
            m.id === itemId ? updatedContentItem(m, newVersion) : m
          ),
        }
      })
      if (!persisted) return false
      // Смена версии из обычного списка тоже должна снять старый бейдж,
      // а не только установка из окна доступных обновлений.
      try { await window.electrobunAPI?.dismissContentUpdate?.(buildId, itemId) } catch {}
      window.dispatchEvent(new CustomEvent("content-updates-changed"))
      return true
    } catch {
      return false
    } finally {
      finishMutation()
    }
  }, [beginContentMutation, persistLocalAddition])

  return { builds, buildsHydrated, setBuilds, activeBuildId, setActiveBuildId, activeBuild, fileInputRef, createBuild, deleteBuild, trashBuild, undoTrashBuild, restoreBuildFromTrash, purgeBuildTrash, duplicateBuild, renameBuild, exportBuildZip, exportBuildModlist, setBuildGroup, renameGroup, deleteGroup, addCategory, collapsedGroups, toggleGroupCollapse, groups, categoryIcons, setCategoryIcon, updateBuild, addModToBuild, addLocalModToBuild, addContentToBuild, addLocalContentToBuild, removeContentFromBuild, reloadBuilds, toggleItemEnabled, updateItemVersion, beginContentMutation }
}
