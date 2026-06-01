import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MODS_PER_PAGE, modSortOptions } from "./constants"
import type { Source, ModSort, ContentType, ModalTab, ModSearchResult, ModVersion, ModDetails, Build, DetailTab } from "./types"

export function useModSearch(activeBuild: Build | null, detailTab: DetailTab, view: string, activeBuildId: string | null) {
  const [modSearch, setModSearch] = useState("")
  const [modResults, setModResults] = useState<ModSearchResult[]>([])
  const [modLoading, setModLoading] = useState(false)
  const [modPrevResults, setModPrevResults] = useState<ModSearchResult[]>([])
  const [installingModSlug, setInstallingModSlug] = useState<string | null>(null)
  const [modSource, setModSource] = useState<Source>("modrinth")
  const [modSortBy, setModSortBy] = useState<ModSort>("downloads")
  const [modPage, setModPage] = useState(0)
  const [modTotalHits, setModTotalHits] = useState(0)
  const [selectedDetails, setSelectedDetails] = useState<ModDetails | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>("description")
  const [projectVersions, setProjectVersions] = useState<ModVersion[]>([])
  const [loadingModal, setLoadingModal] = useState(false)
  const modFileInputRef = useRef<HTMLInputElement>(null)

  const compatibleProjectVersions = useMemo(() => {
    if (!activeBuild) return projectVersions
    return projectVersions.filter(ver => {
      const gameVersions = ver.gameVersion.split(/[|,/]/).map(v => v.trim()).filter(Boolean)
      const versionMatches = !gameVersions.length || gameVersions.includes(activeBuild.version)
      if (!versionMatches) return false
      if (detailTab !== "mods") return true
      const loaders = ver.loaders?.map(l => l.toLowerCase()) ?? []
      if (activeBuild.modLoader === "vanilla") return loaders.length === 0
      return loaders.includes(activeBuild.modLoader)
    })
  }, [activeBuild, projectVersions, detailTab])

  const compatibleCFVersions = useMemo(() => {
    if (!activeBuild || !selectedDetails) return selectedDetails?.versions ?? []
    return selectedDetails.versions.filter(ver => {
      const gameVersions = String(ver.gameVersion ?? "").split(/[|,/]/).map(v => v.trim()).filter(Boolean)
      if (gameVersions.length > 0 && !gameVersions.includes(activeBuild.version)) return false
      if (detailTab !== "mods") return true
      const loaders = ver.loaders?.map(loader => loader.toLowerCase()) ?? []
      if (activeBuild.modLoader === "vanilla") return loaders.length === 0
      return loaders.includes(activeBuild.modLoader)
    })
  }, [activeBuild, selectedDetails, detailTab])

  const displayedModalVersions = useMemo(() => {
    if (!selectedDetails) return []
    if (selectedDetails.source === "modrinth") {
      return compatibleProjectVersions.length > 0 ? compatibleProjectVersions : projectVersions
    }
    return compatibleCFVersions.length > 0 ? compatibleCFVersions : (selectedDetails.versions ?? [])
  }, [compatibleCFVersions, compatibleProjectVersions, projectVersions, selectedDetails])
  const displayResults = modResults.length > 0 ? modResults : modPrevResults

  const fetchModrinthMods = useCallback(async (query: string, type: ContentType = "mod", page: number = 0) => {
    try {
      const modLoaderFilter = detailTab === "mods" && activeBuild?.modLoader && activeBuild.modLoader !== "vanilla"
        ? activeBuild.modLoader as "fabric" | "quilt"
        : undefined
      const resp = await window.electronAPI?.modsModrinthSearch(query, type, activeBuild?.version, modLoaderFilter, modSortBy, page)
      setModResults(resp?.results ?? [])
      setModTotalHits(resp?.totalCount ?? 0)
    } catch {
      setModResults([]); setModTotalHits(0)
    }
  }, [activeBuild?.modLoader, activeBuild?.version, detailTab, modSortBy])

  const fetchCurseforgeContent = useCallback(async (query: string, type: ContentType = "mod", page: number = 0) => {
    try {
      const resp = await window.electronAPI?.modsCurseforgeSearch(query, type, activeBuild?.version, activeBuild?.modLoader, modSortBy, page)
      setModResults(resp?.results ?? [])
      setModTotalHits(resp?.totalCount ?? 0)
    } catch {
      setModResults([]); setModTotalHits(0)
    }
  }, [activeBuild?.modLoader, activeBuild?.version, modSortBy])

  useEffect(() => { setModPage(0) }, [modSearch, modSource, modSortBy, detailTab])

  useEffect(() => {
    if (view !== "detail" || !activeBuildId) return
    const type: ContentType = detailTab === "resourcepacks" ? "resourcepack" : detailTab === "shaders" ? "shader" : "mod"
    const timer = setTimeout(() => {
      if (modSource === "curseforge") void fetchCurseforgeContent(modSearch, type, modPage)
      else void fetchModrinthMods(modSearch, type, modPage)
    }, 400)
    return () => clearTimeout(timer)
  }, [modSearch, view, activeBuildId, fetchModrinthMods, fetchCurseforgeContent, detailTab, modSource, modPage])

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
          window.electronAPI?.modsModrinthDetails(item.slug),
          window.electronAPI?.modsModrinthVersions(item.slug),
        ])
        if (details) setSelectedDetails(details)
        setProjectVersions(versions ?? [])
      } else if (item.source === "curseforge" && item.modId) {
        const details = await window.electronAPI?.modsCurseforgeDetails(item.modId)
        if (details) setSelectedDetails(details)
        setProjectVersions(details?.versions ?? [])
      }
    } catch {}
    setLoadingModal(false)
  }, [])

  const openCFModal = openProjectModal // unified — same function now

  const closeModal = useCallback(() => { setSelectedDetails(null); setProjectVersions([]) }, [])

  const resetModSearch = useCallback(() => { setModSearch(""); setModResults([]) }, [])

  return {
    modSearch, setModSearch, modResults, setModResults, modLoading,
    modPrevResults, setModPrevResults, installingModSlug, setInstallingModSlug,
    modSource, setModSource, modSortBy, setModSortBy,
    modPage, setModPage, modTotalHits,
    selectedDetails, cfModalData: selectedDetails, modalTab, setModalTab,
    loadingModal, displayedModalVersions, displayResults,
    modFileInputRef, openProjectModal, openCFModal, closeModal, resetModSearch,
  }
}
