import { useCallback, useEffect, useState } from "react"
import { InstanceDetail } from "./instance-detail"
import { InstanceList } from "./instance-list"
import { InstanceModrinth } from "./instance-modrinth"
import { InstanceCurseForge } from "./instance-curseforge"
import { InstanceHeader } from "./instance-header"
import { InstanceImportOverlay } from "./instance-import-overlay"
import { InstanceModal } from "./instance-modal"
import { useBuilds } from "./use-builds"
import { useModSearch } from "./use-mod-search"
import { useImport } from "./use-import"
import { useMinecraftVersionOptions } from "@/src/hooks/use-minecraft-version-options"
import { useAccounts } from "@/src/AccountsContext"
import { useBuildLaunch } from "@/src/hooks/use-build-launch"
import type { ViewMode, DetailTab, ModSearchResult, ModVersion, ModSort } from "./types"

const MODRINTH_SORT_OPTIONS: ModSort[] = ["relevance", "downloads", "followers", "published", "updated"]
const CURSEFORGE_SORT_OPTIONS: ModSort[] = ["downloads", "popular", "published", "updated"]

function mergeCategories(current: string[], nextResults: ModSearchResult[]) {
  const merged = new Set(current)
  for (const result of nextResults) {
    for (const category of result.categories ?? []) {
      const trimmed = category.trim()
      if (trimmed) merged.add(trimmed)
    }
  }
  return Array.from(merged).sort((a, b) => a.localeCompare(b))
}

export function InstancePage() {
  const [view, setView] = useState<ViewMode>("my")
  const [detailTab, setDetailTab] = useState<DetailTab>("general")
  const [createOpen, setCreateOpen] = useState(false)

  const { activeAccount } = useAccounts()
  const { launchInstance } = useBuildLaunch({ account: activeAccount ?? undefined })

  const [mrSearch, setMrSearch] = useState("")
  const [mrResults, setMrResults] = useState<ModSearchResult[]>([])
  const [mrLoading, setMrLoading] = useState(false)

  const [cfSearch, setCfSearch] = useState("")
  const [cfResults, setCfResults] = useState<ModSearchResult[]>([])
  const [cfLoading, setCfLoading] = useState(false)
  const [mrSortBy, setMrSortBy] = useState<ModSort>("downloads")
  const [cfSortBy, setCfSortBy] = useState<ModSort>("downloads")
  const { visibleVersions, versionsLoaded } = useMinecraftVersionOptions()
  const [selectedVersion, setSelectedVersion] = useState("all")
  const [selectedModLoader, setSelectedModLoader] = useState("all")
  const [mrSelectedCategory, setMrSelectedCategory] = useState("all")
  const [cfSelectedCategory, setCfSelectedCategory] = useState("all")
  const [mrPage, setMrPage] = useState(0)
  const [cfPage, setCfPage] = useState(0)
  const [mrTotalHits, setMrTotalHits] = useState(0)
  const [cfTotalHits, setCfTotalHits] = useState(0)
  const [mrCategoryOptions, setMrCategoryOptions] = useState<string[]>([])
  const [cfCategoryOptions, setCfCategoryOptions] = useState<string[]>([])
  const [mrCategoriesLoaded, setMrCategoriesLoaded] = useState(false)
  const [cfCategoriesLoaded, setCfCategoriesLoaded] = useState(false)

  const {
    builds, setBuilds, activeBuildId, setActiveBuildId, activeBuild,
    fileInputRef, createBuild, deleteBuild, trashBuild, undoTrashBuild, purgeBuildTrash, duplicateBuild, renameBuild, exportBuildZip, exportBuildModlist, setBuildGroup, renameGroup, deleteGroup, collapsedGroups, toggleGroupCollapse, groups,
    updateBuild, addModToBuild, addLocalModToBuild,
    addContentToBuild, addLocalContentToBuild, removeContentFromBuild, reloadBuilds,
    toggleItemEnabled, updateItemVersion,
  } = useBuilds()

  // CLI launch (--launch <buildName>, e.g. from a desktop shortcut)
  useEffect(() => {
    return window.electronAPI?.onCliLaunchBuild?.(async (buildName) => {
      if (!buildName) return
      const build = builds.find((b) => b.name === buildName)
      if (!build) return
      setActiveBuildId(build.id)
      setView("detail")
      setDetailTab("general")
      await launchInstance(build)
    })
  }, [builds, launchInstance])

  const {
    modSearch, setModSearch, modResults, setModResults, modLoading,
    modPrevResults, setModPrevResults, installingModSlug, setInstallingModSlug,
    modSource, setModSource, modSortBy, setModSortBy,
    modPage, setModPage, modTotalHits,
    selectedDetails, modalTab, setModalTab,
    loadingModal, displayedModalVersions, displayResults,
    modFileInputRef, openProjectModal, openCFModal, closeModal, resetModSearch,
  } = useModSearch(activeBuild, detailTab, view, activeBuildId)

  const {
    importProgress, importError, isCancellingImport, downloadingSlug, cfDownloadingId,
    cancelImport, downloadFromModrinth, downloadVersionFromModrinth, downloadFromCurseforge, downloadVersionFromCurseforge, handleImportFile,
  } = useImport(setBuilds, () => setView("my"))

  const fetchMrModpacks = useCallback(async (query: string, currentPage: number) => {
    setMrLoading(true)
    try {
      const searchQuery = query.trim()
      const resp = await window.electronAPI?.modsModrinthSearch(
        searchQuery,
        "modpack",
        selectedVersion === "all" ? undefined : selectedVersion,
        selectedModLoader === "all" ? undefined : selectedModLoader as "vanilla" | "fabric" | "quilt" | "neoforge",
        mrSortBy,
        currentPage,
        mrSelectedCategory === "all" ? undefined : mrSelectedCategory,
      )
      const nextResults = resp?.results ?? []
      setMrResults(nextResults)
      setMrTotalHits(resp?.totalCount ?? 0)
      setMrCategoryOptions((current) => mergeCategories(current, nextResults))
    } catch {
      setMrResults([])
      setMrTotalHits(0)
    }
    finally { setMrLoading(false) }
  }, [mrSelectedCategory, mrSortBy, selectedModLoader, selectedVersion])

  const fetchCfModpacks = useCallback(async (query: string, currentPage: number) => {
    setCfLoading(true)
    try {
      const searchQuery = query.trim()
      const resp = await window.electronAPI?.modsCurseforgeSearch(
        searchQuery,
        "modpack",
        selectedVersion === "all" ? undefined : selectedVersion,
        selectedModLoader === "all" ? undefined : selectedModLoader,
        cfSortBy,
        currentPage,
        cfSelectedCategory === "all" ? undefined : cfSelectedCategory,
      )
      const nextResults = resp?.results ?? []
      setCfResults(nextResults)
      setCfTotalHits(resp?.totalCount ?? 0)
      setCfCategoryOptions((current) => mergeCategories(current, nextResults))
    } catch {
      setCfResults([])
      setCfTotalHits(0)
    }
    finally { setCfLoading(false) }
  }, [cfSelectedCategory, cfSortBy, selectedModLoader, selectedVersion])

  useEffect(() => {
    if (view !== "modrinth" || mrCategoriesLoaded) return

    let cancelled = false

    const loadCategories = async () => {
      try {
        const categories = await window.electronAPI?.modsModrinthCategories?.("modpack") ?? []
        if (!cancelled) {
          setMrCategoryOptions(categories.map((category) => category.slug).filter(Boolean))
          setMrCategoriesLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setMrCategoryOptions([])
          setMrCategoriesLoaded(true)
        }
      }
    }

    void loadCategories()

    return () => {
      cancelled = true
    }
  }, [mrCategoriesLoaded, view])

  useEffect(() => {
    if (view !== "curseforge" || cfCategoriesLoaded) return

    let cancelled = false

    const loadCategories = async () => {
      try {
        const categories = await window.electronAPI?.modsCurseforgeCategories?.("modpack") ?? []
        if (!cancelled) {
          setCfCategoryOptions(categories.map((category) => category.name || category.slug).filter(Boolean))
          setCfCategoriesLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setCfCategoryOptions([])
          setCfCategoriesLoaded(true)
        }
      }
    }

    void loadCategories()

    return () => {
      cancelled = true
    }
  }, [cfCategoriesLoaded, view])

  useEffect(() => {
    if (view !== "modrinth") return
    const t = setTimeout(() => void fetchMrModpacks(mrSearch, mrPage), 350)
    return () => clearTimeout(t)
  }, [fetchMrModpacks, mrSearch, mrPage, mrSelectedCategory, mrSortBy, selectedModLoader, selectedVersion, view])

  useEffect(() => {
    if (view === "modrinth" && !mrSearch.trim()) {
      fetchMrModpacks("", mrPage)
    }
  }, [view, mrPage])

  useEffect(() => { setMrPage(0) }, [mrSearch, mrSelectedCategory, mrSortBy, selectedModLoader, selectedVersion])

  useEffect(() => {
    if (view !== "curseforge") return
    const t = setTimeout(() => void fetchCfModpacks(cfSearch, cfPage), 350)
    return () => clearTimeout(t)
  }, [cfSearch, cfPage, cfSelectedCategory, cfSortBy, fetchCfModpacks, selectedModLoader, selectedVersion, view])

  useEffect(() => {
    if (view === "curseforge" && !cfSearch.trim()) {
      fetchCfModpacks("", cfPage)
    }
  }, [view, cfPage])

  useEffect(() => { setCfPage(0) }, [cfSearch, cfSelectedCategory, cfSortBy, selectedModLoader, selectedVersion])

  const openBuildDetail = useCallback((id: string) => {
    setActiveBuildId(id)
    setView("detail")
    setDetailTab("general")
  }, [setActiveBuildId])

  const goToMyBuilds = useCallback(() => {
    setView("my"); setActiveBuildId(null); setDetailTab("general"); resetModSearch()
  }, [resetModSearch, setActiveBuildId])

  const handleOpenCreate = useCallback(() => setCreateOpen(true), [])
  const totalBuilds = builds.length
  const mrTotalPages = Math.max(1, Math.ceil(mrTotalHits / 10))
  const cfTotalPages = Math.max(1, Math.ceil(cfTotalHits / 10))

  const handleInstallModalVersion = useCallback(async (version: ModVersion) => {
    if (!selectedDetails) return

    const modalItem: ModSearchResult = {
      id: selectedDetails.id,
      slug: selectedDetails.slug,
      name: selectedDetails.name,
      summary: selectedDetails.summary,
      iconUrl: selectedDetails.iconUrl,
      downloadCount: selectedDetails.downloadCount,
      categories: selectedDetails.categories,
      source: selectedDetails.source,
      projectId: selectedDetails.projectId,
      modId: selectedDetails.modId,
      primaryFileId: Number(version.id),
      primaryFileName: version.fileName,
    }

    closeModal()
    if (selectedDetails.source === "modrinth") {
      await downloadVersionFromModrinth(modalItem, version.id)
      return
    }

    if (selectedDetails.modId) {
      await downloadVersionFromCurseforge(modalItem, Number(version.id))
    }
  }, [closeModal, downloadVersionFromCurseforge, downloadVersionFromModrinth, selectedDetails])

  if (view === "detail" && activeBuild) {
    return (
      <InstanceDetail
        activeBuild={activeBuild}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        goToMyBuilds={goToMyBuilds}
        updateBuild={updateBuild}
        renameBuild={renameBuild}
        fileInputRef={fileInputRef}
        reloadBuilds={reloadBuilds}
        modSearch={modSearch}
        setModSearch={setModSearch}
        modSource={modSource}
        setModSource={setModSource}
        modSortBy={modSortBy}
        setModSortBy={setModSortBy}
        modFileInputRef={modFileInputRef}
        addLocalModToBuild={addLocalModToBuild}
        addLocalContentToBuild={addLocalContentToBuild}
        removeContentFromBuild={removeContentFromBuild}
        modLoading={modLoading}
        modTotalHits={modTotalHits}
        modPage={modPage}
        setModPrevResults={setModPrevResults}
        modResults={modResults}
        setModPage={setModPage}
        displayResults={displayResults}
        openProjectModal={openProjectModal}
        installingModSlug={installingModSlug}
        setInstallingModSlug={setInstallingModSlug}
        addModToBuild={addModToBuild}
        addContentToBuild={addContentToBuild}
        setBuilds={setBuilds}
        toggleItemEnabled={toggleItemEnabled}
        updateItemVersion={updateItemVersion}
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        closeModal={closeModal}
      />
    )
  }

  return (
    <div className="h-full flex flex-col animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
      <InstanceImportOverlay
        importProgress={importProgress}
        importError={importError}
        isCancelling={isCancellingImport}
        onCancel={cancelImport}
      />

      <InstanceHeader
        view={view}
        setView={setView}
        onImportFile={handleImportFile}
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        onCreate={createBuild}
        onImported={reloadBuilds}
      />

      {view === "my" && (
        <InstanceList
          builds={builds}
          totalBuilds={totalBuilds}
          onCreate={handleOpenCreate}
          onDelete={deleteBuild}
          onTrash={trashBuild}
          onUndoTrash={undoTrashBuild}
          onDuplicate={duplicateBuild}
          onExportZip={exportBuildZip}
          onExportModlist={exportBuildModlist}
          onSetGroup={setBuildGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onOpen={openBuildDetail}
          groups={groups}
          collapsedGroups={collapsedGroups}
          onToggleGroupCollapse={toggleGroupCollapse}
        />
      )}

      {view === "modrinth" && (
        <InstanceModrinth
          search={mrSearch}
          setSearch={setMrSearch}
          loading={mrLoading}
          results={mrResults}
          downloadingSlug={downloadingSlug}
          sortBy={mrSortBy}
          setSortBy={setMrSortBy}
          sortOptions={MODRINTH_SORT_OPTIONS}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          versionsLoaded={versionsLoaded}
          versionOptions={visibleVersions}
          selectedModLoader={selectedModLoader}
          setSelectedModLoader={setSelectedModLoader}
          selectedCategory={mrSelectedCategory}
          setSelectedCategory={setMrSelectedCategory}
          categoryOptions={mrCategoryOptions}
          page={mrPage}
          totalPages={mrTotalPages}
          onPageChange={setMrPage}
          onOpenDetails={openProjectModal}
          onDownload={downloadFromModrinth}
        />
      )}

      {view === "curseforge" && (
        <InstanceCurseForge
          cfSearch={cfSearch}
          setCfSearch={setCfSearch}
          cfLoading={cfLoading}
          cfResults={cfResults}
          cfDownloadingId={cfDownloadingId}
          sortBy={cfSortBy}
          setSortBy={setCfSortBy}
          sortOptions={CURSEFORGE_SORT_OPTIONS}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          versionsLoaded={versionsLoaded}
          versionOptions={visibleVersions}
          selectedModLoader={selectedModLoader}
          setSelectedModLoader={setSelectedModLoader}
          selectedCategory={cfSelectedCategory}
          setSelectedCategory={setCfSelectedCategory}
          categoryOptions={cfCategoryOptions}
          page={cfPage}
          totalPages={cfTotalPages}
          onPageChange={setCfPage}
          onOpenDetails={openCFModal}
          onDownload={downloadFromCurseforge}
        />
      )}

      <InstanceModal
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        onInstallVersion={handleInstallModalVersion}
        onClose={closeModal}
      />
    </div>
  )
}
