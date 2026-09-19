import { useCallback, useEffect, useRef, useState } from "react"
import { InstanceDetail } from "./instance-detail"
import { InstanceList } from "./instance-list"
import { InstanceModrinth } from "./instance-modrinth"
import { InstanceCurseForge } from "./instance-curseforge"
import { InstanceFtb } from "./instance-ftb"
import { InstanceBrowseToolbar } from "./instance-browse-toolbar"
import { useImport } from "./use-import"
import { dataCache, MOD_SEARCH_CACHE_TTL } from "@/lib/swr"
import { InstanceHeader } from "./instance-header"
import { InstanceTrashView } from "./instance-trash-view"
import { InstanceImportOverlay } from "./instance-import-overlay"
import { InstanceTrashToast } from "./instance-trash-toast"
import { InstanceModal } from "./instance-modal"
import { ModpackConflictDialog } from "./modpack-conflict-dialog"
import { useBuilds } from "./use-builds"
import { useModSearch } from "./use-mod-search"
import { useMinecraftVersionOptions } from "@/src/hooks/use-minecraft-version-options"
import { useAccounts } from "@/src/AccountsContext"
import { useBuildLaunch } from "@/src/hooks/use-build-launch"
import type { ViewMode, DetailTab, ModSearchResult, ModVersion, ModSort } from "./types"
import { SORT_OPTIONS_BY_SOURCE } from "./sort-options"

export function InstancePage() {
  const [view, setView] = useState<ViewMode>("my")
  const [detailTab, setDetailTab] = useState<DetailTab>("general")
  const [createOpen, setCreateOpen] = useState(false)
  const [updatesCountByBuild, setUpdatesCountByBuild] = useState<Record<string, number>>({})
  /** Имя только что удалённой сборки — для плашки с отменой. */
  const [trashedNotice, setTrashedNotice] = useState<string | null>(null)
  const trashedNoticeTimerRef = useRef<number | null>(null)

  const { activeAccount } = useAccounts()
  const { launchInstance } = useBuildLaunch({ account: activeAccount ?? undefined })

  const [mrSearch, setMrSearch] = useState("")
  const [mrResults, setMrResults] = useState<ModSearchResult[]>([])
  const [mrLoading, setMrLoading] = useState(false)

  const [cfSearch, setCfSearch] = useState("")
  const [cfResults, setCfResults] = useState<ModSearchResult[]>([])
  const [cfLoading, setCfLoading] = useState(false)
  const [ftbSearch, setFtbSearch] = useState("")
  const [ftbResults, setFtbResults] = useState<ModSearchResult[]>([])
  const [ftbLoading, setFtbLoading] = useState(false)
  const [mrSortBy, setMrSortBy] = useState<ModSort>("downloads")
  const [cfSortBy, setCfSortBy] = useState<ModSort>("downloads")
  const { visibleVersions, versionsLoaded } = useMinecraftVersionOptions()
  const [selectedVersion, setSelectedVersion] = useState("all")
  const [selectedModLoader, setSelectedModLoader] = useState("all")
  const [mrPage, setMrPage] = useState(0)
  const [cfPage, setCfPage] = useState(0)
  const [ftbPage, setFtbPage] = useState(0)
  const [mrTotalHits, setMrTotalHits] = useState(0)
  const [cfTotalHits, setCfTotalHits] = useState(0)
  const [ftbTotalHits, setFtbTotalHits] = useState(0)

  const {
    builds, setBuilds, activeBuildId, setActiveBuildId, activeBuild,
    fileInputRef, createBuild, deleteBuild, trashBuild, undoTrashBuild, restoreBuildFromTrash, purgeBuildTrash, duplicateBuild, renameBuild, exportBuildZip, exportBuildModlist, setBuildGroup, renameGroup, deleteGroup, addCategory, collapsedGroups, toggleGroupCollapse, groups, categoryIcons, setCategoryIcon,
    updateBuild, addModToBuild, addLocalModToBuild,
    addContentToBuild, addLocalContentToBuild, removeContentFromBuild, reloadBuilds,
    toggleItemEnabled, updateItemVersion,
  } = useBuilds()

  const refreshUpdatesCount = useCallback(async () => {
    try {
      const cache = await window.electronAPI?.getContentUpdatesCache()
      const counts: Record<string, number> = {}
      for (const [buildId, entry] of Object.entries(cache ?? {})) {
        const count = entry?.updates?.length ?? 0
        if (count > 0) {
          const b = builds.find(item => item.id === buildId)
          const isLinked = b && (b.source === "modrinth" || b.source === "curseforge") && b.locked !== false
          if (!isLinked) {
            counts[buildId] = count
          }
        }
      }
      setUpdatesCountByBuild(counts)
    } catch {
      // ignore
    }
  }, [builds])

  useEffect(() => {
    void refreshUpdatesCount()
    const handler = () => void refreshUpdatesCount()
    window.addEventListener("content-updates-changed", handler)
    return () => window.removeEventListener("content-updates-changed", handler)
  }, [refreshUpdatesCount])

  useEffect(() => {
    if (view === "my") void refreshUpdatesCount()
  }, [view, refreshUpdatesCount])

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
    modSearch, setModSearch, modLoading,
    installingModSlug, setInstallingModSlug,
    modSource, setModSource, modSortBy, setModSortBy,
    modCategories, setModCategories,
    modPage, setModPage, modTotalHits, modTotalPages,
    categories,
    selectedDetails, modalTab, setModalTab,
    loadingModal, displayedModalVersions, displayResults,
    modalVersionsFallback, showAllModalVersions, setShowAllModalVersions, allModalVersionsCount,
    modalVersionsLoaderFiltered,
    modFileInputRef, openProjectModal, closeModal, resetModSearch, detailsKind,
    isInstalledFn,
  } = useModSearch(activeBuild, detailTab, view, activeBuildId)

  const {
    importProgress, importError, isCancellingImport, downloadingSlug, cfDownloadingId, ftbDownloadingId,
    installConflict, dismissInstallConflict, createInstallCopy,
    cancelImport, downloadFromModrinth, downloadVersionFromModrinth, downloadFromCurseforge, downloadVersionFromCurseforge, downloadFromFtb, downloadVersionFromFtb, handleImportFile,
  } = useImport(setBuilds, () => setView("my"))

  const fetchMrModpacks = useCallback(async (query: string, currentPage: number) => {
    setMrLoading(true)
    try {
      const searchQuery = query.trim()
      const key = `modrinth:search:modpack:${searchQuery}:${selectedVersion === "all" ? "" : selectedVersion}:${selectedModLoader === "all" ? "" : selectedModLoader}:${mrSortBy}:${currentPage}`
      const resp = await dataCache.getOrFetch(
        key,
        () => window.electronAPI?.modsModrinthSearch(
          searchQuery,
          "modpack",
          selectedVersion === "all" ? undefined : selectedVersion,
          selectedModLoader === "all" ? undefined : selectedModLoader as "vanilla" | "fabric" | "quilt" | "neoforge",
          mrSortBy,
          currentPage,
        ) ?? null,
        { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
      )
      const nextResults = resp?.results ?? []
      setMrResults(nextResults)
      setMrTotalHits(resp?.totalCount ?? 0)
    } catch {
      setMrResults([])
      setMrTotalHits(0)
    }
    finally { setMrLoading(false) }
  }, [mrSortBy, selectedModLoader, selectedVersion])

  const fetchCfModpacks = useCallback(async (query: string, currentPage: number) => {
    setCfLoading(true)
    try {
      const searchQuery = query.trim()
      const key = `curseforge:search:modpack:${searchQuery}:${selectedVersion === "all" ? "" : selectedVersion}:${selectedModLoader === "all" ? "" : selectedModLoader}:${cfSortBy}:${currentPage}`
      const resp = await dataCache.getOrFetch(
        key,
        () => window.electronAPI?.modsCurseforgeSearch(
          searchQuery,
          "modpack",
          selectedVersion === "all" ? undefined : selectedVersion,
          selectedModLoader === "all" ? undefined : selectedModLoader,
          cfSortBy,
          currentPage,
        ) ?? null,
        { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
      )
      const nextResults = resp?.results ?? []
      setCfResults(nextResults)
      setCfTotalHits(resp?.totalCount ?? 0)
    } catch {
      setCfResults([])
      setCfTotalHits(0)
    }
    finally { setCfLoading(false) }
  }, [cfSortBy, selectedModLoader, selectedVersion])

  useEffect(() => {
    if (view !== "modrinth") return
    const t = setTimeout(() => void fetchMrModpacks(mrSearch, mrPage), 350)
    return () => clearTimeout(t)
  }, [fetchMrModpacks, mrSearch, mrPage, mrSortBy, selectedModLoader, selectedVersion, view])

  useEffect(() => {
    if (view === "modrinth" && !mrSearch.trim()) {
      fetchMrModpacks("", mrPage)
    }
  }, [view, mrPage])

  useEffect(() => { setMrPage(0) }, [mrSearch, mrSortBy, selectedModLoader, selectedVersion])

  useEffect(() => {
    if (view !== "curseforge") return
    const t = setTimeout(() => void fetchCfModpacks(cfSearch, cfPage), 350)
    return () => clearTimeout(t)
  }, [cfSearch, cfPage, cfSortBy, fetchCfModpacks, selectedModLoader, selectedVersion, view])

  useEffect(() => {
    if (view === "curseforge" && !cfSearch.trim()) {
      fetchCfModpacks("", cfPage)
    }
  }, [view, cfPage])

  useEffect(() => { setCfPage(0) }, [cfSearch, cfSortBy, selectedModLoader, selectedVersion])

  const fetchFtbModpacks = useCallback(async (query: string, currentPage: number) => {
    setFtbLoading(true)
    try {
      const searchQuery = query.trim()
      const key = `ftb:search:${searchQuery}:${currentPage}`
      const resp = await dataCache.getOrFetch(
        key,
        () => window.electronAPI?.modsFtbSearch(searchQuery, currentPage) ?? null,
        { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
      )
      const nextResults = resp?.results ?? []
      setFtbResults(nextResults)
      setFtbTotalHits(resp?.totalCount ?? 0)
    } catch {
      setFtbResults([])
      setFtbTotalHits(0)
    }
    finally { setFtbLoading(false) }
  }, [])

  useEffect(() => {
    if (view !== "ftb") return
    const t = setTimeout(() => void fetchFtbModpacks(ftbSearch, ftbPage), 350)
    return () => clearTimeout(t)
  }, [fetchFtbModpacks, ftbSearch, ftbPage, view])

  useEffect(() => {
    if (view === "ftb" && !ftbSearch.trim()) {
      fetchFtbModpacks("", ftbPage)
    }
  }, [view, ftbPage])

  useEffect(() => { setFtbPage(0) }, [ftbSearch])

  const openBuildDetail = useCallback((id: string) => {
    setActiveBuildId(id)
    setView("detail")
    setDetailTab("general")
  }, [setActiveBuildId])

  const goToMyBuilds = useCallback(() => {
    setView("my"); setActiveBuildId(null); setDetailTab("general"); resetModSearch()
  }, [resetModSearch, setActiveBuildId])

  /**
   * Плашка «сборка в корзине» с отменой. Список сборок держит свою такую же
   * плашку; здесь она нужна для удаления прямо со страницы сборки.
   */
  const showTrashedNotice = useCallback((name: string) => {
    setTrashedNotice(name)
    if (trashedNoticeTimerRef.current !== null) window.clearTimeout(trashedNoticeTimerRef.current)
    trashedNoticeTimerRef.current = window.setTimeout(() => setTrashedNotice(null), 8000)
  }, [])

  const undoTrashFromNotice = useCallback(() => {
    if (trashedNoticeTimerRef.current !== null) window.clearTimeout(trashedNoticeTimerRef.current)
    setTrashedNotice(null)
    void undoTrashBuild()
  }, [undoTrashBuild])

  /**
   * Удаление сборки с её же страницы: возвращаемся к списку сборок и показываем
   * ту же плашку с отменой, что и при удалении из списка.
   */
  const trashBuildFromDetail = useCallback(async (id: string): Promise<boolean> => {
    const name = builds.find(b => b.id === id)?.name
    const ok = await trashBuild(id)
    if (!ok) return false
    setActiveBuildId(null)
    setDetailTab("general")
    resetModSearch()
    setView("my")
    if (name) showTrashedNotice(name)
    return true
  }, [builds, resetModSearch, setActiveBuildId, showTrashedNotice, trashBuild])

  /**
   * Активную сборку могли убрать не только кнопкой: синхронизация, импорт,
   * откат правок. В любом таком случае вместо пустого detail-вида показываем
   * список сборок.
   */
  const resolvedView: ViewMode = view === "detail" && !activeBuild ? "my" : view

  const handleOpenCreate = useCallback(() => setCreateOpen(true), [])
  const totalBuilds = builds.length
  const mrTotalPages = Math.max(1, Math.ceil(mrTotalHits / 20))
  const cfTotalPages = Math.max(1, Math.ceil(cfTotalHits / 20))
  const ftbTotalPages = Math.max(1, Math.ceil(ftbTotalHits / 20))

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

    if (selectedDetails.source === "ftb") {
      await downloadVersionFromFtb(modalItem, Number(version.id.replace("ftb-", "")))
      return
    }

    if (selectedDetails.modId) {
      await downloadVersionFromCurseforge(modalItem, Number(version.id))
    }
  }, [closeModal, downloadVersionFromCurseforge, downloadVersionFromFtb, downloadVersionFromModrinth, selectedDetails])

  if (view === "detail" && activeBuild) {
    return (
      <InstanceDetail
        detailsKind={detailsKind}
        activeBuild={activeBuild}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        goToMyBuilds={goToMyBuilds}
        updateBuild={updateBuild}
        renameBuild={renameBuild}
        onTrash={trashBuildFromDetail}
        fileInputRef={fileInputRef}
        reloadBuilds={reloadBuilds}
        modSearch={modSearch}
        setModSearch={setModSearch}
        modSource={modSource}
        setModSource={setModSource}
        modSortBy={modSortBy}
        setModSortBy={setModSortBy}
        modCategories={modCategories}
        setModCategories={setModCategories}
        categories={categories}
        modFileInputRef={modFileInputRef}
        addLocalModToBuild={addLocalModToBuild}
        addLocalContentToBuild={addLocalContentToBuild}
        removeContentFromBuild={removeContentFromBuild}
        modLoading={modLoading}
        modTotalHits={modTotalHits}
        modTotalPages={modTotalPages}
        modPage={modPage}
        setModPage={setModPage}
        displayResults={displayResults}
        isInstalledFn={isInstalledFn}
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
        versionsFallback={modalVersionsFallback}
        versionsLoaderFiltered={modalVersionsLoaderFiltered}
        onShowAllVersions={() => setShowAllModalVersions(true)}
        allVersionsCount={allModalVersionsCount}
        closeModal={closeModal}
      />
    )
  }

  return (
    <div className="relative h-full flex flex-col animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
      <InstanceImportOverlay
        importProgress={importProgress}
        importError={importError}
        isCancelling={isCancellingImport}
        onCancel={cancelImport}
      />

      <InstanceHeader
        view={resolvedView}
        setView={setView}
        onImportFile={handleImportFile}
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        onCreate={createBuild}
        onImported={reloadBuilds}
      />

      {resolvedView === "my" && (
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
          onCreateCategory={addCategory}
          onOpen={openBuildDetail}
          groups={groups}
          collapsedGroups={collapsedGroups}
          onToggleGroupCollapse={toggleGroupCollapse}
          categoryIcons={categoryIcons}
          onSetCategoryIcon={setCategoryIcon}
          updatesCountByBuild={updatesCountByBuild}
        />
      )}

      {resolvedView === "modrinth" && (
        <InstanceModrinth
          search={mrSearch}
          setSearch={setMrSearch}
          loading={mrLoading}
          results={mrResults}
          downloadingSlug={downloadingSlug}
          sortBy={mrSortBy}
          setSortBy={setMrSortBy}
          sortOptions={SORT_OPTIONS_BY_SOURCE.modrinth}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          versionsLoaded={versionsLoaded}
          versionOptions={visibleVersions}
          selectedModLoader={selectedModLoader}
          setSelectedModLoader={setSelectedModLoader}
          page={mrPage}
          totalPages={mrTotalPages}
          onPageChange={setMrPage}
          onOpenDetails={(project) => openProjectModal(project, "modpack")}
          onDownload={downloadFromModrinth}
        />
      )}

      {resolvedView === "curseforge" && (
        <InstanceCurseForge
          cfSearch={cfSearch}
          setCfSearch={setCfSearch}
          cfLoading={cfLoading}
          cfResults={cfResults}
          cfDownloadingId={cfDownloadingId}
          sortBy={cfSortBy}
          setSortBy={setCfSortBy}
          sortOptions={SORT_OPTIONS_BY_SOURCE.curseforge}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          versionsLoaded={versionsLoaded}
          versionOptions={visibleVersions}
          selectedModLoader={selectedModLoader}
          setSelectedModLoader={setSelectedModLoader}
          page={cfPage}
          totalPages={cfTotalPages}
          onPageChange={setCfPage}
          onOpenDetails={(project) => openProjectModal(project, "modpack")}
          onDownload={downloadFromCurseforge}
        />
      )}

      {resolvedView === "trash" && (
        <InstanceTrashView
          goToMyBuilds={goToMyBuilds}
          onRestore={restoreBuildFromTrash}
        />
      )}

      {resolvedView === "ftb" && (
        <InstanceFtb
          ftbSearch={ftbSearch}
          setFtbSearch={setFtbSearch}
          ftbLoading={ftbLoading}
          ftbResults={ftbResults}
          ftbDownloadingId={ftbDownloadingId}
          page={ftbPage}
          totalPages={ftbTotalPages}
          onPageChange={setFtbPage}
          onOpenDetails={(project) => openProjectModal(project, "modpack")}
          onDownload={downloadFromFtb}
        />
      )}

      {trashedNotice && (
        <InstanceTrashToast name={trashedNotice} onUndo={undoTrashFromNotice} />
      )}

      <InstanceModal
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        versionsFallback={modalVersionsFallback}
        versionsLoaderFiltered={modalVersionsLoaderFiltered}
        onShowAllVersions={() => setShowAllModalVersions(true)}
        allVersionsCount={allModalVersionsCount}
        onInstallVersion={handleInstallModalVersion}
        onClose={closeModal}
        projectKind={detailsKind}
      />

      <ModpackConflictDialog
        open={!!installConflict}
        conflict={installConflict}
        onCancel={dismissInstallConflict}
        onCreateCopy={(name) => void createInstallCopy(name)}
        onOpenExisting={() => {
          const id = installConflict?.existingBuildId
          dismissInstallConflict()
          closeModal()
          if (id) openBuildDetail(id)
        }}
      />
    </div>
  )
}
