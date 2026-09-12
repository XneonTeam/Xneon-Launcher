import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MODS_PER_PAGE } from "./constants"
import type { Source, SearchSource, ModSort, ContentType, ModalTab, ModSearchResult, ModVersion, ModDetails, Build, DetailTab } from "./types"
import type { ModLoaderFilter, ModCategory } from "@xnlc/types"
import { dataCache, STALE_SEARCH_MS, MOD_SEARCH_CACHE_TTL } from "@/lib/swr"
import { SORT_OPTIONS_BY_SOURCE } from "./sort-options"
import { groupVersionsByCompatibility, isProjectCompatibleWithBuild } from "./utils"

export type SelectedModCategory = { name: string; source?: "modrinth" | "curseforge" }

function isProjectInstalled(
  project: ModSearchResult,
  installedItems: Build["mods"],
): boolean {
  const projectProjectId = project.projectId ?? (project.source === "modrinth" ? project.id : undefined)
  return installedItems.some(item => {
    if (projectProjectId && item.projectId && projectProjectId === item.projectId) return true
    if (project.source === "curseforge" && typeof project.modId === "number" && item.modId === project.modId) return true
    return false
  })
}

/** Сквозная сортировка объединённых результатов обеих платформ по выбранному виду */
function toTs(date?: string): number {
  if (!date) return 0
  const ts = Date.parse(date)
  return Number.isFinite(ts) ? ts : 0
}

function mergeSortedResults(a: ModSearchResult[], b: ModSearchResult[], sortBy: ModSort): ModSearchResult[] {
  const merged = [...a, ...b]
  switch (sortBy) {
    case "downloads":
    case "follows":
    case "rating":
      return merged.sort((x, y) => (y.downloadCount ?? 0) - (x.downloadCount ?? 0))
    case "updated":
      return merged.sort((x, y) => toTs(y.dateModified ?? y.dateCreated) - toTs(x.dateModified ?? x.dateCreated))
    case "newest":
      return merged.sort((x, y) => toTs(y.dateCreated ?? y.dateModified) - toTs(x.dateCreated ?? x.dateModified))
    default:
      return merged
  }
}

export function useModSearch(activeBuild: Build | null, detailTab: DetailTab, view: string, activeBuildId: string | null) {
  const [modSearch, setModSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [modLoading, setModLoading] = useState(false)
  const [installingModSlug, setInstallingModSlug] = useState<string | null>(null)
  const [modSource, setModSource] = useState<SearchSource>("both")
  const [modSortBy, setModSortBy] = useState<ModSort>("downloads")
  const [modCategories, setModCategories] = useState<SelectedModCategory[]>([])
  const [modPage, setModPage] = useState(1)
  const [modTotalHits, setModTotalHits] = useState(0)
  const [selectedDetails, setSelectedDetails] = useState<ModDetails | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>("description")
  const [projectVersions, setProjectVersions] = useState<ModVersion[]>([])
  const [loadingModal, setLoadingModal] = useState(false)
  const modFileInputRef = useRef<HTMLInputElement>(null)

  const searchVersionRef = useRef(0)
  const [displayResults, setDisplayResults] = useState<ModSearchResult[]>([])
  const [categories, setCategories] = useState<ModCategory[]>([])
  const categoriesVersionRef = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(modSearch), 300)
    return () => clearTimeout(timer)
  }, [modSearch])

  useEffect(() => {
    const allowed = SORT_OPTIONS_BY_SOURCE[modSource]
    if (!allowed.includes(modSortBy)) setModSortBy(allowed[0] ?? "downloads")
  }, [modSource, modSortBy])

  const requireLoaderMatch = detailTab === "mods"

  // Группы совместимости для модального окна: точное совпадение → только загрузчик → все версии
  const modalVersionGroups = useMemo(() => {
    if (!selectedDetails) return { exact: [], byLoader: [], all: [] }
    if (selectedDetails.source === "ftb") {
      return groupVersionsByCompatibility(selectedDetails.versions ?? [], activeBuild, requireLoaderMatch)
    }
    const source = selectedDetails.source === "modrinth"
      ? projectVersions
      : (selectedDetails.versions ?? [])
    return groupVersionsByCompatibility(source, activeBuild, requireLoaderMatch)
  }, [activeBuild, projectVersions, requireLoaderMatch, selectedDetails])

  // Показывать ли версии под другие загрузчики (только по явному запросу пользователя)
  const [showAllModalVersions, setShowAllModalVersions] = useState(false)

  useEffect(() => { setShowAllModalVersions(false) }, [selectedDetails?.id, selectedDetails?.projectId, detailTab])

  const displayedModalVersions = useMemo(() => {
    const { exact, byLoader, all } = modalVersionGroups
    if (exact.length > 0) return exact
    // По умолчанию не показываем версии под другие версии игры — только по явному запросу
    if (showAllModalVersions) {
      if (byLoader.length > 0) return byLoader
      return all
    }
    return []
  }, [modalVersionGroups, showAllModalVersions])

  /**
   * none        — показаны полностью совместимые версии;
   * otherMc     — совместимых по версии Minecraft нет, показаны версии того же загрузчика (только при showAllModalVersions);
   * otherLoader — для загрузчика сборки версий нет, показан полный список (только при showAllModalVersions);
   * empty       — ничего не найдено, предложить показать все версии.
   */
  const modalVersionsFallback = useMemo<"none" | "otherMc" | "otherLoader" | "empty">(() => {
    const { exact, byLoader, all } = modalVersionGroups
    if (!selectedDetails) return "empty"
    if (exact.length > 0) return "none"
    if (!showAllModalVersions) return "empty"
    if (byLoader.length > 0) return "otherMc"
    if (all.length > 0) return "otherLoader"
    return "empty"
  }, [modalVersionGroups, selectedDetails, showAllModalVersions])

  const searchModrinth = useCallback((
    query: string, type: ContentType, version: string | undefined,
    loader: ModLoaderFilter | undefined, sort: ModSort, page: number,
    cats?: string[],
  ) => {
    const key = `modrinth:search:${type}:${query ?? ""}:${version ?? ""}:${loader ?? ""}:${sort}:${page}:${(cats ?? []).join(",")}`
    return dataCache.getOrFetch(
      key,
      () => window.electronAPI?.modsModrinthSearch(query, type, version, loader, sort, page, cats) ?? null,
      { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
    )
  }, [])

  const searchCurseforge = useCallback((
    query: string, type: ContentType, version: string | undefined,
    loader: string | undefined, sort: ModSort, page: number,
    cats?: string[],
  ) => {
    const key = `curseforge:search:${type}:${query ?? ""}:${version ?? ""}:${loader ?? ""}:${sort}:${page}:${(cats ?? []).join(",")}`
    return dataCache.getOrFetch(
      key,
      () => window.electronAPI?.modsCurseforgeSearch(query, type, version, loader, sort, page, cats) ?? null,
      { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
    )
  }, [])

  const isInstalledFn = useCallback((project: ModSearchResult): boolean => {
    const items = detailTab === "mods"
      ? activeBuild?.mods ?? []
      : detailTab === "resourcepacks" ? activeBuild?.resourcepacks ?? [] : activeBuild?.shaders ?? []
    return isProjectInstalled(project, items)
  }, [activeBuild, detailTab])

  const modTotalPages = useMemo(() => {
    if (modTotalHits === 0) return 1
    const calculated = Math.ceil(modTotalHits / MODS_PER_PAGE)
    const maxOffsetPages = Math.floor(10000 / MODS_PER_PAGE) + 1
    if (modSource === "both") return calculated
    return Math.min(calculated, maxOffsetPages)
  }, [modTotalHits, modSource])

  const mrTotalRef = useRef(0)
  const cfTotalRef = useRef(0)

  const refreshPage = useCallback(async (page: number) => {
    const version = ++searchVersionRef.current
    setModLoading(true)
    try {
      const type: ContentType = detailTab === "resourcepacks" ? "resourcepack" : detailTab === "shaders" ? "shader" : "mod"
      const modLoaderFilter = detailTab === "mods" && activeBuild?.modLoader && activeBuild.modLoader !== "vanilla"
        ? activeBuild.modLoader as ModLoaderFilter
        : undefined

      const mrCats = modCategories.filter(c => c.source !== "curseforge").map(c => c.name)
      const cfCats = modCategories.filter(c => c.source !== "modrinth").map(c => c.name)
      const catsMr = mrCats.length > 0 ? mrCats : undefined
      const catsCf = cfCats.length > 0 ? cfCats : undefined
      const apiPage = page - 1
      const gameVersion = activeBuild?.version
      const effectiveSort = modSortBy

      let resp
      let respMrTotal = 0
      let respCfTotal = 0
      if (modSource === "both") {
        const pageIndex = page - 1
        const mrPages = mrTotalRef.current > 0 ? Math.ceil(mrTotalRef.current / MODS_PER_PAGE) : 0
        const cfPages = cfTotalRef.current > 0 ? Math.ceil(cfTotalRef.current / MODS_PER_PAGE) : 0
        const isFirstPage = pageIndex === 0
        const mrPage = isFirstPage ? 0 : (pageIndex < mrPages ? pageIndex : undefined)
        const cfPage = isFirstPage ? 0 : (pageIndex >= mrPages ? pageIndex - mrPages : undefined)
        const [mr, cf] = await Promise.all([
          mrPage !== undefined
            ? searchModrinth(debouncedSearch, type, gameVersion, modLoaderFilter, effectiveSort, mrPage, catsMr)
            : Promise.resolve(null),
          cfPage !== undefined
            ? searchCurseforge(debouncedSearch, type, gameVersion, modLoaderFilter, effectiveSort, cfPage, catsCf)
            : Promise.resolve(null),
        ])
        respMrTotal = mr?.totalCount ?? 0
        respCfTotal = cf?.totalCount ?? 0
        if (respMrTotal > 0) mrTotalRef.current = respMrTotal
        if (respCfTotal > 0) cfTotalRef.current = respCfTotal
        resp = {
          results: mergeSortedResults(mr?.results ?? [], cf?.results ?? [], effectiveSort).slice(0, MODS_PER_PAGE),
          totalCount: mrTotalRef.current + cfTotalRef.current,
        }
      } else if (modSource === "curseforge") {
        resp = await searchCurseforge(debouncedSearch, type, gameVersion, modLoaderFilter, effectiveSort, apiPage, catsCf)
        respCfTotal = resp?.totalCount ?? 0
        if (respCfTotal > 0) cfTotalRef.current = respCfTotal
        mrTotalRef.current = 0
      } else {
        resp = await searchModrinth(debouncedSearch, type, gameVersion, modLoaderFilter, effectiveSort, apiPage, catsMr)
        respMrTotal = resp?.totalCount ?? 0
        if (respMrTotal > 0) mrTotalRef.current = respMrTotal
        cfTotalRef.current = 0
      }

      if (version !== searchVersionRef.current) return
      const rawResults = resp?.results ?? []
      // Жёстко отсекаем проекты, у которых нет версии под текущую сборку
      const filteredResults = activeBuild
        ? rawResults.filter(project => isProjectCompatibleWithBuild(project, activeBuild, detailTab === "mods"))
        : rawResults
      setDisplayResults(filteredResults)
      setModTotalHits(resp?.totalCount ?? Math.max(respMrTotal, respCfTotal))
    } catch {
      if (version !== searchVersionRef.current) return
      setDisplayResults([])
      setModTotalHits(0)
    } finally {
      if (version === searchVersionRef.current) setModLoading(false)
    }
  }, [debouncedSearch, modSource, modSortBy, modCategories, detailTab, activeBuild, searchCurseforge, searchModrinth])

  const lastSearchKeyRef = useRef("")
  const lastRequestKeyRef = useRef("")

  useEffect(() => {
    if (view !== "detail" || !activeBuildId) return
    const catsKey = modCategories.map(c => `${c.source ?? "both"}:${c.name}`).join(",")
    const searchKey = `${debouncedSearch}|${modSource}|${modSortBy}|${catsKey}|${detailTab}|${activeBuildId}`
    const changed = lastSearchKeyRef.current !== searchKey
    lastSearchKeyRef.current = searchKey

    if (changed) {
      setModPage(1)
      setDisplayResults([])
      setModTotalHits(0)
      mrTotalRef.current = 0
      cfTotalRef.current = 0
      ++searchVersionRef.current
    }

    const targetPage = changed ? 1 : modPage
    const requestKey = `${searchKey}|${targetPage}`
    if (lastRequestKeyRef.current === requestKey) return
    lastRequestKeyRef.current = requestKey
    void refreshPage(targetPage)
  }, [debouncedSearch, modSource, modSortBy, modCategories, detailTab, view, activeBuildId, modPage, refreshPage])

  useEffect(() => {
    if (view !== "detail") return
    setCategories([])
    const loadCategories = async () => {
      try {
        if (modSource === "both") {
          const [mrCats, cfCats] = await Promise.all([
            window.electronAPI?.modsModrinthCategories(),
            window.electronAPI?.modsCurseforgeCategories(),
          ])
          const merged = [
            ...(mrCats ?? []).map(c => ({ ...c, source: "modrinth" as const })),
            ...(cfCats ?? []).map(c => ({ ...c, source: "curseforge" as const })),
          ]
          if (merged.length > 0) setCategories(merged as ModCategory[])
        } else if (modSource === "curseforge") {
          const cats = await window.electronAPI?.modsCurseforgeCategories()
          if (cats) setCategories(cats.map(c => ({ ...c, source: "curseforge" as const })) as ModCategory[])
        } else {
          const cats = await window.electronAPI?.modsModrinthCategories()
          if (cats) setCategories(cats.map(c => ({ ...c, source: "modrinth" as const })) as ModCategory[])
        }
      } catch {}
    }
    loadCategories()
  }, [view, modSource, detailTab])

  const openProjectModal = useCallback(async (item: ModSearchResult) => {
    setModalTab("description"); setLoadingModal(true)
    setSelectedDetails({
      id: item.id, slug: item.slug, name: item.name, summary: item.summary,
      description: item.summary, iconUrl: item.iconUrl, downloadCount: item.downloadCount,
      categories: item.categories, versions: [], gallery: [], source: item.source,
      modId: item.modId, projectId: item.projectId,
    })
    try {
      if (item.source === "modrinth") {
        const [details, versions] = await Promise.all([
          dataCache.getOrFetch(`modrinth:details:${item.slug}`, () => window.electronAPI?.modsModrinthDetails(item.slug) ?? null, { immutable: true }),
          dataCache.getOrFetch(`modrinth:versions:${item.slug}`, () => window.electronAPI?.modsModrinthVersions(item.slug) ?? null, { immutable: true }),
        ])
        if (details) setSelectedDetails(details)
        setProjectVersions(versions ?? [])
      } else if (item.source === "curseforge" && item.modId != null) {
        const details = await dataCache.getOrFetch(`curseforge:details:${item.modId}`, () => window.electronAPI?.modsCurseforgeDetails(item.modId!) ?? null, { immutable: true })
        if (details) setSelectedDetails(details)
        setProjectVersions(details?.versions ?? [])
      } else if (item.source === "ftb" && item.projectId != null) {
        const details = await dataCache.getOrFetch(`ftb:details:${item.projectId}`, () => window.electronAPI?.modsFtbDetails(Number(item.projectId)) ?? null, { immutable: true })
        if (details) setSelectedDetails(details)
        setProjectVersions(details?.versions ?? [])
      }
    } catch {}
    setLoadingModal(false)
  }, [])

  const closeModal = useCallback(() => { setSelectedDetails(null); setProjectVersions([]) }, [])
  const resetModSearch = useCallback(() => { setModSearch(""); setModPage(1); setModCategories([]); setDisplayResults([]) }, [])

  return {
    modSearch, setModSearch, modLoading,
    installingModSlug, setInstallingModSlug,
    modSource, setModSource, modSortBy, setModSortBy,
    modCategories, setModCategories,
    modPage, setModPage, modTotalHits, modTotalPages,
    categories,
    selectedDetails, cfModalData: selectedDetails, modalTab, setModalTab,
    loadingModal, displayedModalVersions, displayResults,
    modalVersionsFallback, showAllModalVersions, setShowAllModalVersions,
    allModalVersionsCount: modalVersionGroups.all.length,
    modalVersionsLoaderFiltered: requireLoaderMatch,
    isInstalledFn,
    modFileInputRef, openProjectModal, openCFModal: openProjectModal, closeModal, resetModSearch,
  }
}
