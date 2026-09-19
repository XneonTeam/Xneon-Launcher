import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MOD_LOADERS } from "./constants"
import { loadBuilds, pickCompatibleVersion } from "./utils"
import type { Build, BuildMod, ModSearchResult, ModDependency, ModVersion } from "./types"
import type { BuildExportCategory } from "@xnlc/types"
import { enrichBuildModNames } from "@/lib/modrinth-metadata"
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

/** TTL кэша: частые возвраты во вкладку не должны дёргать БД повторно. */
const BUILDS_CACHE_TTL_MS = 3000

/**
 * Тяжёлый контент сборок (mods/resourcepacks/shaders/installedMods). У модпаков
 * это десятки мегабайт — грузим по требованию (для открытой сборки) и держим
 * в памяти, чтобы переключение вкладок не читало их заново.
 */
const buildContentCache = new Map<string, {
  mods: BuildMod[]
  resourcepacks: BuildMod[]
  shaders: BuildMod[]
  installedMods: Record<string, string>
}>()

export function getCachedBuildsLight(): Build[] | null {
  return buildsLightCache
}

export function updateCachedBuildContent(buildId: string, content: {
  mods: BuildMod[]
  resourcepacks: BuildMod[]
  shaders: BuildMod[]
  installedMods: Record<string, string>
}) {
  buildContentCache.set(buildId, content)
  if (buildsLightCache) {
    buildsLightCache = buildsLightCache.map(build => build.id === buildId ? { ...build, ...content } : build)
  }
}

/** Сборка без тяжёлого контента: поля-списки пустые, счётчики — из лёгкого запроса. */
type BuildWithCounts = Build & { modsCount?: number; resourcepacksCount?: number; shadersCount?: number }

const CONTENT_KIND_BY_KEY: Record<BuildContentListKey, BuildContentKind> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaders: "shader",
}

export function useBuilds() {
  const { t } = useTranslation()
  const { pushNotification, beginContentInstall, endContentInstall } = useActivityCenter()
  // Иконки категорий — их можно задать в контекстном меню категории.
  const { categoryIcons, setCategoryIcon, renameCategoryIcon, dropCategoryIcon } = useCategoryIcons("builds")
  // Созданные вручную категории: без этого пустая категория исчезала бы сразу.
  const {
    declaredCategories, addCategory, renameCategory: renameDeclaredCategory, dropCategory: dropDeclaredCategory,
  } = useCategoryList("builds")
  const [buildsState, setBuildsState] = useState<Build[]>(() => buildsLightCache ?? [])
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const activeBuildIdRef = useRef<string | null>(null)
  const [buildsHydrated, setBuildsHydrated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<number | null>(null)
  const buildsRef = useRef<Build[]>(buildsState)
  const isReloadingRef = useRef(false)
  const reloadSeqRef = useRef(0)
  const lastSavedSnapshotRef = useRef("")

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
      return next
    })
  }, [])

  const builds = buildsState

  const syncBuildContent = useCallback(async (build: Build): Promise<Build> => {
    try {
      const targetPath = build.intentPath?.trim() || build.name
      await window.electronAPI?.getBuildIntentPath(targetPath)
      const scanned = await window.electronAPI?.scanBuildIntentContent?.(targetPath)
      if (!scanned) return build

      const mergeContent = (existing: BuildMod[], incoming: BuildMod[]) => {
        const normalize = (value?: string) => value?.trim().toLowerCase() ?? ""
        const existingBySlug = new Map(existing.map(item => [item.slug.toLowerCase(), item]))
        const existingByName = new Map(existing.map(item => [item.name.toLowerCase(), item]))

        return incoming.map(item => {
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
          const resolvedModId = resolvedSource === "curseforge"
            ? (item.modId ?? matched.modId)
            : undefined

          return {
            ...item,
            slug: matched.slug || item.slug,
            name: item.name && item.name.length > 1 ? item.name : matched.name || item.name,
            description: matched.description || item.description,
            icon_url: matched.icon_url || item.icon_url,
            source: resolvedSource,
            projectId: sameSourceAsResolved ? resolvedProjectId : matched.projectId,
            modId: sameSourceAsResolved ? resolvedModId : matched.modId,
            author: matched.author || item.author,
            version: item.version && item.version !== "local"
              ? item.version
              : matched.version && matched.version !== "local"
                ? matched.version
                : item.version,
          }
        })
      }

      return {
        ...build,
        mods: Array.isArray(scanned.mods) ? mergeContent(build.mods, scanned.mods) : build.mods,
        resourcepacks: Array.isArray(scanned.resourcepacks) ? mergeContent(build.resourcepacks, scanned.resourcepacks) : build.resourcepacks,
        shaders: Array.isArray(scanned.shaders) ? mergeContent(build.shaders, scanned.shaders) : build.shaders,
        installedMods: scanned.installedMods ?? build.installedMods ?? {},
      }
    } catch {
      return build
    }
  }, [])

  /**
   * Догружает тяжёлый контент сборки (mods/resourcepacks/shaders) по требованию —
   * когда сборку открыли. Список сборок держит только счётчики, поэтому вход во
   * вкладку не тянет десятки мегабайт.
   */
  const ensureBuildContent = useCallback(async (buildId: string): Promise<void> => {
    const cached = buildContentCache.get(buildId)
    if (cached) {
      setBuilds(prev => prev.map(build => build.id === buildId
        ? { ...build, mods: cached.mods, resourcepacks: cached.resourcepacks, shaders: cached.shaders, installedMods: cached.installedMods }
        : build))
      return
    }
    try {
      const content = await window.electronAPI?.loadBuildContent?.(buildId)
      if (!content) return
      const parsed = {
        mods: Array.isArray(content.mods) ? content.mods as BuildMod[] : [],
        resourcepacks: Array.isArray(content.resourcepacks) ? content.resourcepacks as BuildMod[] : [],
        shaders: Array.isArray(content.shaders) ? content.shaders as BuildMod[] : [],
        installedMods: content.installedMods ?? {},
      }
      const [mods, resourcepacks, shaders] = await Promise.all([
        enrichBuildModNames(parsed.mods),
        enrichBuildModNames(parsed.resourcepacks),
        enrichBuildModNames(parsed.shaders),
      ])
      const enriched = { ...parsed, mods, resourcepacks, shaders }
      updateCachedBuildContent(buildId, enriched)
      setBuilds(prev => prev.map(build => build.id === buildId ? { ...build, ...enriched } : build))
    } catch {
      // Контент не критичен для отрисовки: при ошибке оставляем счётчики.
    }
  }, [setBuilds])

  // Открыли сборку — подгружаем её контент и обновляем счётчики из скана папки.
  useEffect(() => {
    activeBuildIdRef.current = activeBuildId
    if (!activeBuildId) return
    void ensureBuildContent(activeBuildId)
    const target = buildsRef.current.find(build => build.id === activeBuildId)
    if (!target) return
    void syncBuildContent(target).then(synced => {
      updateCachedBuildContent(activeBuildId, {
        mods: synced.mods,
        resourcepacks: synced.resourcepacks,
        shaders: synced.shaders,
        installedMods: synced.installedMods ?? {},
      })
      setBuilds(prev => prev.map(build => build.id === activeBuildId ? { ...build, ...synced } : build))
    })
  }, [activeBuildId, ensureBuildContent, syncBuildContent, setBuilds])

  const reloadBuilds = useCallback(async () => {
    // Flush pending save before reloading so in-memory changes aren't lost.
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      void window.electronAPI?.saveBuilds(buildsRef.current as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
      lastSavedSnapshotRef.current = JSON.stringify(buildsRef.current)
    }

    isReloadingRef.current = true
    const seq = ++reloadSeqRef.current
    try {
      const rawBuilds = await (window.electronAPI?.loadBuildsLight
        ? window.electronAPI.loadBuildsLight()
        : window.electronAPI?.loadBuilds() ?? Promise.resolve([]))
      const dbBuilds = (rawBuilds ?? []) as BuildWithCounts[]
      if (!dbBuilds?.length) {
        setBuildsHydrated(true)
        window.dispatchEvent(new Event("app:hydrated"))
        setBuilds([])
        return
      }

      const processed: Build[] = dbBuilds.map(build => {
        const b = build as BuildWithCounts
        const inMemoryBuild = buildsRef.current.find(existing => existing.id === build.id || existing.name === build.name)
        // Тяжёлый контент из памяти/кэша: приходит не из лёгкого запроса, а из
        // buildContentCache (или из уже загруженного состояния).
        const cached = buildContentCache.get(build.id)
        const normalized = {
          ...build,
          mods: cached?.mods ?? (Array.isArray(b.mods) ? b.mods : inMemoryBuild?.mods ?? []),
          resourcepacks: cached?.resourcepacks ?? (Array.isArray(b.resourcepacks) ? b.resourcepacks : inMemoryBuild?.resourcepacks ?? []),
          shaders: cached?.shaders ?? (Array.isArray(b.shaders) ? b.shaders : inMemoryBuild?.shaders ?? []),
          intentPath: b.intentPath ?? inMemoryBuild?.intentPath ?? "",
          installedMods: cached?.installedMods ?? b.installedMods ?? inMemoryBuild?.installedMods ?? {},
          modsCount: b.modsCount ?? inMemoryBuild?.mods.length ?? 0,
          resourcepacksCount: b.resourcepacksCount ?? inMemoryBuild?.resourcepacks.length ?? 0,
          shadersCount: b.shadersCount ?? inMemoryBuild?.shaders.length ?? 0,
        } as Build

        // Правки пользователя, ещё не доехавшие до БД, должны победить снапшот БД —
        // иначе отвязка модпака и прочие изменения откатываются. Применяем по ключам,
        // чтобы осознанные `undefined` (сброс поля) тоже сработали.
        const pending = pendingEditsRef.current.get(normalized.id)
        if (pending) {
          for (const key of Object.keys(pending) as (keyof Build)[]) {
            ;(normalized as Record<string, unknown>)[key as string] = pending[key]
          }
        }

        return normalized
      })

      // Лёгкий список кэшируем на уровне модуля: следующий вход во вкладку
      // отрисуется мгновенно, без обращения к БД.
      buildsLightCache = processed
      buildsLightCacheAt = performance.now()

      // Устанавливаем сборки сразу — UI отрисовывается без ожидания сканирования
      setBuilds(processed)

      // Сканирование папки игры (файловая система) выполняем только для открытой
      // сборки: раньше оно запускалось для всех сразу и тормозило вход во вкладку.
      const activeId = activeBuildIdRef.current
      const toSync = activeId ? processed.filter(build => build.id === activeId) : []
      void Promise.all(toSync.map(async (normalized) => {
        const synced = await syncBuildContent(normalized)
        if (seq !== reloadSeqRef.current) return
        setBuilds(prev => prev.map(b => {
          if (b.id !== synced.id) return b
          // Скан асинхронный: пока он шёл, пользователь мог снова изменить поля
          // (например, отвязать модпак). Накладываем актуальный буфер поверх
          // результата синка, чтобы поздний ответ скана не откатил эти правки.
          const pending = pendingEditsRef.current.get(synced.id)
          if (!pending) return synced
          const merged = { ...synced } as Record<string, unknown>
          for (const key of Object.keys(pending) as (keyof Build)[]) {
            merged[key as string] = pending[key]
          }
          return merged as Build
        }))
      })).then(() => {
        if (seq !== reloadSeqRef.current) return
        // Сигнализируем что первичная загрузка завершена — splash можно убрать
        setBuildsHydrated(true)
        window.dispatchEvent(new Event("app:hydrated"))
      })

      // Enrich Modrinth names/authors in the background — don't block the
      // initial render with network requests. Results are cached module-wide
      // and batched, so repeat reloads are cheap or hit the cache entirely.
      void (async () => {
        const enriched = await Promise.all(processed.map(async build => {
          const [mods, rp, sh] = await Promise.all([
            enrichBuildModNames(build.mods),
            enrichBuildModNames(build.resourcepacks),
            enrichBuildModNames(build.shaders),
          ])
          return { ...build, mods, resourcepacks: rp, shaders: sh }
        }))

        if (seq !== reloadSeqRef.current) return

        const enrichedById = new Map(enriched.map(build => [build.id, build]))
        setBuilds(prev => prev.map(current => {
          const rich = enrichedById.get(current.id)
          if (!rich) return current
          const patchList = (list: BuildMod[], richList: BuildMod[]) => {
            const richBySlug = new Map(richList.map(item => [item.slug.toLowerCase(), item]))
            return list.map(item => {
              const enrichedItem = richBySlug.get(item.slug.toLowerCase())
              return enrichedItem
                ? { ...item, name: enrichedItem.name || item.name, author: enrichedItem.author || item.author }
                : item
            })
          }
          return {
            ...current,
            mods: patchList(current.mods, rich.mods),
            resourcepacks: patchList(current.resourcepacks, rich.resourcepacks),
            shaders: patchList(current.shaders, rich.shaders),
          }
        }))
      })()
    } finally {
      isReloadingRef.current = false
    }
  }, [syncBuildContent])

  const activeBuild = useMemo(() => builds.find(b => b.id === activeBuildId) ?? null, [builds, activeBuildId])

  useEffect(() => {
    // Свежий кэш — рисуем список сразу и не читаем БД: с прошлого входа ничего
    // не менялось. Так переключение вкладок не ждёт даже лёгкий запрос.
    if (buildsLightCache && performance.now() - buildsLightCacheAt < BUILDS_CACHE_TTL_MS) {
      setBuilds(buildsLightCache)
      setBuildsHydrated(true)
      window.dispatchEvent(new Event("app:hydrated"))
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
    return () => window.removeEventListener("cloud:imported", handler)
  }, [reloadBuilds])

  useEffect(() => {
    if (!buildsHydrated || isReloadingRef.current) {
      return
    }

    const nextSnapshot = JSON.stringify(builds)
    if (lastSavedSnapshotRef.current === nextSnapshot) {
      return
    }

    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    const snapshotIds = builds.map(b => b.id)
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      lastSavedSnapshotRef.current = nextSnapshot
      void (async () => {
        try {
          await window.electronAPI?.saveBuilds(builds as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
          // Правки уехали в БД — буфер для записанных сборок больше не нужен,
          // иначе он навсегда перекрывал бы изменения из внешних источников.
          // Чистим только после подтверждённой записи, чтобы не потерять правку,
          // если запись не успела/упала.
          for (const id of snapshotIds) pendingEditsRef.current.delete(id)
        } catch (error) {
          console.error("[Builds] Debounced save failed:", error)
        }
      })()
    }, 200)
  }, [builds, buildsHydrated])

  useEffect(() => () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const createBuild = useCallback(async (params: { name: string; description: string; version: string; modLoader: string; loaderVersion?: string; icon: string }) => {
    const trimmedName = params.name.trim()
    if (!trimmedName) return
    const id = crypto.randomUUID()
    let intentPath = ""
    try {
      intentPath = await window.electronAPI?.getBuildIntentPath(trimmedName) ?? ""
      await window.electronAPI?.setBuildIntentPath(trimmedName, intentPath)
    } catch {}
    setBuilds(prev => [{
      id, name: trimmedName, description: params.description.trim(),
      version: params.version, modLoader: params.modLoader, loaderVersion: params.loaderVersion,
      icon: params.icon, coverImage: params.icon || undefined,
      mods: [], resourcepacks: [], shaders: [],
      createdAt: new Date().toISOString(), source: "local",
      intentPath, installedMods: {}, playtime: 0,
    }, ...prev])
  }, [])

  const deleteBuild = useCallback(async (id: string) => {
    const build = builds.find(b => b.id === id)
    if (build) {
      try {
        await window.electronAPI?.deleteBuildIntent(build.name)
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
      const result = await window.electronAPI?.moveBuildIntentToTrash?.(build.name, build as unknown as Record<string, unknown>)
      trashName = result?.trashName
    } catch {}
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
  }, [builds])

  const undoTrashBuild = useCallback(async (): Promise<Build | null> => {
    const snapshot = trashStackRef.current.pop()
    if (!snapshot) return null
    const { build, trashName } = snapshot
    if (trashName) {
      try { await window.electronAPI?.restoreBuildIntentFromTrash?.(build.name, trashName) } catch {}
    }
    setBuilds(prev => [build, ...prev])
    setActiveBuildId(build.id)
    return build
  }, [])

  const purgeBuildTrash = useCallback(async (): Promise<void> => {
    trashStackRef.current = []
    try { await window.electronAPI?.purgeBuildTrash?.() } catch {}
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
      const result = await window.electronAPI?.restoreBuildIntentFromTrash?.(item.originalName, item.trashName)
      if (!result?.success) return false

      const restored = result.build as Build | undefined
      if (restored) {
        // Возвращаем сборку в память и следом в БД, чтобы она сразу появилась в списке
        // и пережила следующий reloadBuilds (иначе тот откатил бы её как отсутствующую).
        setBuilds(prev => {
          if (prev.some(b => b.id === restored.id)) return prev
          return [restored, ...prev]
        })
        try {
          const existing = await window.electronAPI?.loadBuilds() ?? []
          if (!existing.some(b => b.id === restored.id)) {
            await window.electronAPI?.saveBuilds([
              restored,
              ...existing,
            ] as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
          }
        } catch { /* память уже обновлена; следующий автосейв добьёт состояние */ }
      }

      // Перечитываем состояние, чтобы подтянуть актуальный контент из восстановленной папки.
      await reloadBuilds()
      return true
    } catch {
      return false
    }
  }, [reloadBuilds])

  const duplicateBuild = useCallback(async (id: string): Promise<Build | null> => {
    const source = builds.find(b => b.id === id)
    if (!source) return null
    const baseName = t("builds.copy", { name: source.name })
    let newName = baseName
    let counter = 2
    while (builds.some(b => b.name === newName)) {
      newName = t("builds.copyN", { name: source.name, counter })
      counter++
    }
    const newBuild: Build = {
      ...source,
      id: crypto.randomUUID(),
      name: newName,
      createdAt: new Date().toISOString(),
      mods: source.mods.map(m => ({ ...m, id: crypto.randomUUID() })),
      resourcepacks: source.resourcepacks.map(m => ({ ...m, id: crypto.randomUUID() })),
      shaders: source.shaders.map(m => ({ ...m, id: crypto.randomUUID() })),
    }
    try {
      const result = await window.electronAPI?.copyBuild?.(source.name, newName)
      if (result?.success) {
        newBuild.intentPath = result.intentPath ?? newBuild.intentPath
      }
    } catch {}
    setBuilds(prev => [newBuild, ...prev])
    return newBuild
  }, [builds])

  const exportBuildZip = useCallback(async (id: string, categories?: BuildExportCategory[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: t("builds.errors.notFound") }
    return await window.electronAPI?.exportBuildZip?.(build.name, build.name, categories) ?? { success: false, error: t("builds.errors.unavailable") }
  }, [builds])

  const exportBuildModlist = useCallback(async (id: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"): Promise<{ success: boolean; path?: string; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: t("builds.errors.notFound") }
    return await window.electronAPI?.exportBuildModlist?.(build.name, build.name, format) ?? { success: false, error: t("builds.errors.unavailable") }
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
      const result = await window.electronAPI?.renameBuildIntent?.(build.name, target)
      if (result?.success) {
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
        await window.electronAPI?.updateBuildFields?.(id, fields as unknown as Parameters<NonNullable<Window["electronAPI"]>["updateBuildFields"]>[1])
        const buffered = pendingEditsRef.current.get(id)
        if (buffered) {
          const rest: Partial<Build> = { ...buffered }
          for (const key of Object.keys(fields)) delete (rest as Record<string, unknown>)[key]
          if (Object.keys(rest).length > 0) pendingEditsRef.current.set(id, rest)
          else pendingEditsRef.current.delete(id)
        }
      } catch (error) {
        console.error("[Builds] Immediate field update failed:", error)
      }
    })()
  }, [])

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
    if (!buildName) return

    const saveRemoteFileToBuild = async (url: string, fileName: string) => {
      return await window.electronAPI?.saveModToIntent(buildName, url, fileName)
    }

    const downloadDependency = async (dep: ModDependency, source: string) => {
      if (dep.dependencyType !== "required" || !dep.projectId) return
      try {
        if (source === "modrinth") {
          const versions = await window.electronAPI?.modsModrinthVersions(dep.projectId)
          const latestVersion = targetBuild ? pickCompatibleVersion(versions, targetBuild) : versions?.find(v => v.files?.[0]?.url)
          if (latestVersion?.files?.[0]?.url) {
            await saveRemoteFileToBuild(latestVersion.files[0].url, latestVersion.files[0].filename || `${dep.projectId}.jar`)
          }
          return
        }

        const depModId = parseInt(dep.projectId)
        if (isNaN(depModId)) return
        const details = await window.electronAPI?.modsCurseforgeDetails(depModId)
        const selectedVersion = targetBuild ? pickCompatibleVersion(details?.versions ?? [], targetBuild) : details?.versions?.[0]
        if (!selectedVersion) return

        const fileId = Number(selectedVersion.id)
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(fileId, depModId)
        if (url) {
          const fileName = selectedVersion.fileName || url.split("/").pop()?.split("?")[0] || `${dep.projectId}.jar`
          await saveRemoteFileToBuild(url, fileName)
        }
      } catch {}
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
          const versions = await window.electronAPI?.modsModrinthVersions(mod.projectId ?? mod.slug)
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
                ? {
                    ...existing,
                    slug: savedFileName,
                    version: selectedVersion.name || selectedVersion.id || existing.version,
                    source: mod.source,
                    projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : existing.projectId),
                    modId: mod.modId ?? existing.modId,
                  }
                : existing),
            }))
          }

          const deps = await window.electronAPI?.modsResolveDependencies(selectedVersion, "modrinth") ?? []
          for (const dep of deps) {
            await downloadDependency(dep, "modrinth")
          }
        } else {
          if (!mod.modId) {
            endContentInstall()
            return
          }
          const details = await window.electronAPI?.modsCurseforgeDetails(mod.modId)
          const selectedVersion = targetBuild
            ? pickCompatibleVersion(details?.versions ?? [], targetBuild)
            : details?.versions?.find(version => Number(version.id) === mod.primaryFileId) ?? details?.versions?.[0]
          if (!selectedVersion) {
            endContentInstall()
            return
          }

          const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), mod.modId)
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
                ? {
                    ...existing,
                    slug: fileName,
                    version: selectedVersion.name || selectedVersion.id || existing.version,
                    source: mod.source,
                    projectId: mod.projectId ?? existing.projectId,
                    modId: mod.modId ?? existing.modId,
                  }
                : existing),
            }))
          }

          const deps = await window.electronAPI?.modsResolveDependencies(selectedVersion, "curseforge") ?? []
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
        void reloadBuilds()
      } catch {
        endContentInstall()
        pushNotification({
          kind: "error",
          source: "install",
          title: t("builds.mod.installFailed"),
          message: mod.name,
        })
      }
    })()
  }, [beginContentInstall, builds, endContentInstall, pushNotification, reloadBuilds])

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
      const dbBuilds = (await window.electronAPI?.loadBuilds() ?? []) as Build[]
      if (!dbBuilds.length) return null
      const next = dbBuilds.map(build => build.id === buildId ? apply(build) : build)
      await window.electronAPI?.saveBuilds(next as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
      // Память держим в согласии с БД и помечаем снапшот сохранённым: иначе
      // отложенная запись debounce'а отправит в БД свой (более старый) снапшот
      // и затрёт только что добавленный элемент.
      lastSavedSnapshotRef.current = JSON.stringify(next)
      setBuilds(next)
      return next
    } catch (error) {
      console.error("[Builds] Failed to persist local content:", error)
      return null
    }
  }, [setBuilds])

  const addLocalModToBuild = useCallback(async (buildId: string, file: File) => {
    const modName = file.name.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    const localPath = window.electronAPI?.getFilePath(file)
    let savedPath = ""
    const buildName = builds.find(b => b.id === buildId)?.name
    if (localPath && buildName) {
      try { savedPath = await window.electronAPI?.saveLocalModToIntent(buildName, localPath) ?? "" } catch {}
    }
    // Мод бросили как есть — никаких проверок зависимостей и запросов к API.
    // Читаем только метаданные архива, чтобы в списке были имя, версия и автор.
    const metadata = localPath ? await window.electronAPI?.readLocalContentMetadata(localPath) : null

    const addMod = (b: Build): Build => {
      if (b.mods.some(m => m.slug === file.name)) return b
      return {
        ...b,
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
  }, [builds, t, persistLocalAddition])

  const addContentToBuild = useCallback(async (buildId: string, type: Exclude<BuildContentListKey, "mods">, mod: ModSearchResult) => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return

    const contentTypeLabel = type === "resourcepacks" ? t("builds.content.resourcepack") : t("builds.content.shader")

    // Уведомление ведём от клика до конца операции: проценты в него дописывает
    // обработчик прогресса из main, а снимаем его мы — сразу по завершении.
    beginContentInstall({
      title: t("builds.content.installing", { type: contentTypeLabel }),
      message: t("builds.mod.downloading", { name: mod.name }),
      itemName: mod.name,
    })

    try {
      const versions = mod.source === "modrinth"
        ? await window.electronAPI?.modsModrinthVersions(mod.projectId ?? mod.slug)
        : mod.modId
          ? await window.electronAPI?.modsCurseforgeDetails(mod.modId).then(details => details?.versions ?? [])
          : []

      const selectedVersion = mod.source === "modrinth"
        ? versions?.find(version => version.files?.[0]?.url)
        : versions?.find(version => Number(version.id) === mod.primaryFileId) ?? versions?.[0]

      let fileUrl = ""
      let fileName = ""

      if (mod.source === "modrinth") {
        const file = selectedVersion?.files?.[0]
        fileUrl = file?.url ?? ""
        fileName = file?.filename || selectedVersion?.fileName || `${mod.slug}.jar`
      } else if (mod.modId && selectedVersion) {
        fileUrl = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), mod.modId) ?? ""
        fileName = selectedVersion.fileName || mod.primaryFileName || fileUrl.split("/").pop()?.split("?")[0] || `${mod.slug}.jar`
      }

      if (!fileUrl) {
        endContentInstall()
        return
      }

      const savedPath = await window.electronAPI?.saveContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], fileUrl, fileName)
      if (!savedPath) {
        endContentInstall()
        pushNotification({
          kind: "error",
          source: "install",
          title: t("builds.content.installFailed", { type: contentTypeLabel }),
          message: mod.name,
        })
        return
      }

      const fallbackEntry: BuildMod = {
        id: crypto.randomUUID(),
        slug: fileName,
        name: mod.name,
        description: mod.summary,
        icon_url: mod.iconUrl,
        version: "local",
        source: mod.source,
        projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : undefined),
        modId: mod.modId,
        author: mod.author,
      }

      setBuilds(prev => prev.map(b => {
        if (b.id !== buildId) return b
        if (b[type].some(item => item.slug === fileName || item.slug === mod.slug)) return b
        return {
          ...b,
          [type]: [...b[type], fallbackEntry],
        }
      }) as Build[])

      endContentInstall()
      pushNotification({
        kind: "success",
        source: "install",
        title: type === "resourcepacks" ? t("builds.content.installedResourcepack") : t("builds.content.installedShader"),
        message: mod.name,
      })
      void reloadBuilds()
    } catch {
      endContentInstall()
      pushNotification({
        kind: "error",
        source: "install",
        title: t("builds.content.installFailed", { type: contentTypeLabel }),
        message: mod.name,
      })
    }
  }, [beginContentInstall, builds, endContentInstall, reloadBuilds, pushNotification])

  const addLocalContentToBuild = useCallback(async (buildId: string, type: Exclude<BuildContentListKey, "mods">, file: File) => {
    const build = builds.find(b => b.id === buildId)
    const localPath = window.electronAPI?.getFilePath(file)
    if (!build?.name || !localPath) return

    const savedPath = await window.electronAPI?.saveLocalContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], localPath)
    if (!savedPath) return

    const itemName = file.name.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    // Как и у модов: файл просто кладём в сборку, метаданные читаем из архива
    // (pack.mcmeta у ресурспаков, shaders.properties у шейдеров).
    const metadata = await window.electronAPI?.readLocalContentMetadata?.(localPath)
    const fallbackEntry: BuildMod = {
      id: crypto.randomUUID(),
      slug: file.name,
      name: metadata?.name || itemName,
      description: metadata?.description || (type === "resourcepacks" ? t("builds.content.localResourcepack") : t("builds.content.localShader")),
      icon_url: metadata?.icon_url,
      version: metadata?.version || "local",
      author: metadata?.author,
    }

    const addContent = (b: Build): Build => {
      if (b[type].some(item => item.slug === file.name)) return b
      return {
        ...b,
        [type]: [...b[type], fallbackEntry],
      }
    }

    setBuilds(prev => prev.map(b => b.id === buildId ? addContent(b) : b))
    // Запись в БД + синхронизация памяти (см. addLocalModToBuild).
    await persistLocalAddition(buildId, addContent)
  }, [builds, t, persistLocalAddition])

  const removeContentFromBuild = useCallback(async (buildId: string, type: BuildContentListKey, item: BuildMod) => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return false

    const result = await window.electronAPI?.deleteContentFromIntent?.(build.name, CONTENT_KIND_BY_KEY[type], item.slug)
    if (!result?.success) return false

    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId) return b
      const nextInstalledMods = { ...(b.installedMods ?? {}) }
      if (type === "mods") {
        delete nextInstalledMods[item.slug]
      }
      return {
        ...b,
        [type]: b[type].filter(existing => existing.slug !== item.slug && existing.id !== item.id),
        installedMods: type === "mods" ? nextInstalledMods : b.installedMods,
      }
    }) as Build[])
    void reloadBuilds()
    return true
  }, [builds, reloadBuilds])

  const toggleItemEnabled = useCallback(async (buildId: string, type: BuildContentListKey, itemId: string) => {
    const build = builds.find(b => b.id === buildId)
    const item = build?.[type].find(entry => entry.id === itemId)
    if (!build || !item) return false

    const enabled = !(item.enabled ?? true)
    const result = await window.electronAPI?.setContentEnabled?.(build.name, CONTENT_KIND_BY_KEY[type], item.slug, enabled)
    if (!result?.success) return false

    setBuilds(prev => prev.map(b => b.id !== buildId ? b : {
      ...b,
      [type]: b[type].map(entry => entry.id === itemId
        ? { ...entry, enabled }
        : entry),
    }) as Build[])
    return true
  }, [builds])

  const updateItemVersion = useCallback(async (buildId: string, type: BuildContentListKey, itemId: string, newVersion: ModVersion): Promise<boolean> => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return false

    const file = newVersion.files?.[0]
    if (!file?.url) return false

    const newFileName = file.filename || `${newVersion.id}.jar`
    const oldItem = build[type].find(m => m.id === itemId)

    try {
      const savedPath = type === "mods"
        ? await window.electronAPI?.saveModToIntent?.(build.name, file.url, newFileName)
        : await window.electronAPI?.saveContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], file.url, newFileName)

      if (!savedPath) return false

      // Удаляем старую версию файла, иначе в папке останется дубликат
      if (oldItem && oldItem.slug !== newFileName) {
        try {
          await window.electronAPI?.deleteContentFromIntent?.(build.name, CONTENT_KIND_BY_KEY[type], oldItem.slug)
        } catch {}
      }

      setBuilds(prev => prev.map(b => {
        if (b.id !== buildId) return b
        const nextInstalledMods = { ...(b.installedMods ?? {}) }
        if (oldItem) delete nextInstalledMods[oldItem.slug]
        nextInstalledMods[newFileName] = savedPath

        return {
          ...b,
          installedMods: nextInstalledMods,
          [type]: b[type].map(m =>
            m.id === itemId ? {
              ...m,
              slug: newFileName,
              version: newVersion.name || newVersion.id || m.version,
            } : m
          ),
        }
      }))
      void reloadBuilds()
      return true
    } catch {
      return false
    }
  }, [builds, reloadBuilds])

  return { builds, setBuilds, activeBuildId, setActiveBuildId, activeBuild, fileInputRef, createBuild, deleteBuild, trashBuild, undoTrashBuild, restoreBuildFromTrash, purgeBuildTrash, duplicateBuild, renameBuild, exportBuildZip, exportBuildModlist, setBuildGroup, renameGroup, deleteGroup, addCategory, collapsedGroups, toggleGroupCollapse, groups, categoryIcons, setCategoryIcon, updateBuild, addModToBuild, addLocalModToBuild, addContentToBuild, addLocalContentToBuild, removeContentFromBuild, reloadBuilds, toggleItemEnabled, updateItemVersion }
}
