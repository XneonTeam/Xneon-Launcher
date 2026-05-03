import { useCallback, useEffect, useMemo, useState } from "react"
import { InstanceDetail } from "./instance-detail"
import { InstanceList } from "./instance-list"
import { InstanceModrinth } from "./instance-modrinth"
import { InstanceCurseForge } from "./instance-curseforge"
import { InstanceHeader } from "./instance-header"
import { InstanceImportOverlay } from "./instance-import-overlay"
import { useBuilds } from "./use-builds"
import { useModSearch } from "./use-mod-search"
import { useImport } from "./use-import"
import type { ViewMode, DetailTab, ModSearchResult } from "./types"

export function InstancePage() {
  const [view, setView] = useState<ViewMode>("my")
  const [detailTab, setDetailTab] = useState<DetailTab>("general")
  const [createOpen, setCreateOpen] = useState(false)

  const [mrSearch, setMrSearch] = useState("")
  const [mrResults, setMrResults] = useState<ModSearchResult[]>([])
  const [mrLoading, setMrLoading] = useState(false)

  const [cfSearch, setCfSearch] = useState("")
  const [cfResults, setCfResults] = useState<ModSearchResult[]>([])
  const [cfLoading, setCfLoading] = useState(false)

  const {
    builds, setBuilds, activeBuildId, setActiveBuildId, activeBuild,
    fileInputRef, createBuild, deleteBuild, updateBuild, addModToBuild, addLocalModToBuild,
  } = useBuilds()

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
    importProgress, importError, downloadingSlug, cfDownloadingId,
    downloadFromModrinth, downloadFromCurseforge, handleImportFile,
  } = useImport(setBuilds, () => setView("my"))

  const fetchMrModpacks = useCallback(async (query: string) => {
    if (!query.trim()) { setMrResults([]); return }
    setMrLoading(true)
    try {
      const resp = await window.electronAPI?.modsModrinthSearch(query, "modpack", undefined, "downloads", 0)
      setMrResults(resp?.results ?? [])
    } catch { setMrResults([]) }
    finally { setMrLoading(false) }
  }, [])

  const fetchCfModpacks = useCallback(async (query: string) => {
    setCfLoading(true)
    try {
      const resp = await window.electronAPI?.modsCurseforgeSearch(query, "modpack", undefined, undefined, "downloads", 0)
      setCfResults(resp?.results ?? [])
    } catch { setCfResults([]) }
    finally { setCfLoading(false) }
  }, [])

  useEffect(() => {
    if (view !== "modrinth") return
    const t = setTimeout(() => void fetchMrModpacks(mrSearch), 350)
    return () => clearTimeout(t)
  }, [fetchMrModpacks, mrSearch, view])

  useEffect(() => {
    if (view !== "curseforge") return
    const t = setTimeout(() => void fetchCfModpacks(cfSearch), 350)
    return () => clearTimeout(t)
  }, [fetchCfModpacks, cfSearch, view])

  const openBuildDetail = (id: string) => {
    const build = builds.find(b => b.id === id)
    setActiveBuildId(id)
    setView("detail")
    setDetailTab(build?.modLoader === "vanilla" ? "resourcepacks" : "general")
  }

  const goToMyBuilds = () => {
    setView("my"); setActiveBuildId(null); setDetailTab("general"); resetModSearch()
  }

  const totalBuilds = useMemo(() => builds.length, [builds.length])

  if (view === "detail" && activeBuild) {
    return (
      <InstanceDetail
        activeBuild={activeBuild}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        goToMyBuilds={goToMyBuilds}
        updateBuild={updateBuild}
        fileInputRef={fileInputRef}
        modSearch={modSearch}
        setModSearch={setModSearch}
        modSource={modSource}
        setModSource={setModSource}
        modSortBy={modSortBy}
        setModSortBy={setModSortBy}
        modFileInputRef={modFileInputRef}
        addLocalModToBuild={addLocalModToBuild}
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
        setBuilds={setBuilds}
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
      <InstanceImportOverlay importProgress={importProgress} importError={importError} />

      <InstanceHeader
        view={view}
        setView={setView}
        onImportFile={handleImportFile}
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        onCreate={createBuild}
      />

      {view === "my" && (
        <InstanceList
          builds={builds}
          totalBuilds={totalBuilds}
          onCreate={() => setCreateOpen(true)}
          onDelete={deleteBuild}
          onOpen={openBuildDetail}
        />
      )}

      {view === "modrinth" && (
        <InstanceModrinth
          search={mrSearch}
          setSearch={setMrSearch}
          loading={mrLoading}
          results={mrResults}
          downloadingSlug={downloadingSlug}
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
          onDownload={downloadFromCurseforge}
        />
      )}
    </div>
  )
}
