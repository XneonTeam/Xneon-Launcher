import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconPlus, IconServer, IconTrash, IconLayoutGrid, IconLayoutList, IconPlayerPlay, IconPlayerStop, IconTerminal, IconFolder } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useMcServers, useMcServerState } from "@/src/hooks/use-mc-servers"
import { useMinecraftVersionOptions } from "@/src/hooks/use-minecraft-version-options"
import { dataCache, MOD_SEARCH_CACHE_TTL } from "@/lib/swr"
import { ServerTile } from "./server-tile"
import { ServerContextMenu } from "./server/server-context-menu"
import { ServerCreateDialog } from "./server-create-dialog"
import { ServerPackInstallDialog, type PackInstallTarget } from "./server-pack-install-dialog"
import { ServerTrashView } from "./server-trash-view"
import { ServersBrowse } from "./servers-browse"
import { InstanceModal } from "./instance/instance-modal"
import { LoaderIcon, loaderLabel } from "./instance/loader-icon"
import { PlatformBadge } from "./platform-icon"
import type { McServerInfo, ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./instance/use-mod-search"
import type { ModDetails, ModSearchResult, ModSort, ModVersion, ModalTab } from "./instance/types"

interface ServersPageProps {
  onSelectServer?: (server: McServerInfo) => void
}

const MODRINTH_SORT_OPTIONS: ModSort[] = ["relevance", "downloads", "follows", "newest", "updated"]
const CURSEFORGE_SORT_OPTIONS: ModSort[] = ["downloads", "newest", "updated", "featured", "rating"]
const PAGE_SIZE = 20

export function ServersPage({ onSelectServer }: ServersPageProps) {
  const { t } = useTranslation()
  const { servers, loading, createServer, deleteServer, duplicateServer, reload } = useMcServers()
  const { visibleVersions, versionsLoaded } = useMinecraftVersionOptions()
  const [showCreate, setShowCreate] = useState(false)
  const [view, setView] = useState<"servers" | "trash" | "modrinth" | "curseforge">("servers")
  const [layoutMode, setLayoutMode] = useState<"grid" | "list">("grid")

  // ── Marketplace state ──
  const [mrSearch, setMrSearch] = useState("")
  const [cfSearch, setCfSearch] = useState("")
  const [mrPage, setMrPage] = useState(0)
  const [cfPage, setCfPage] = useState(0)
  const [mrSortBy, setMrSortBy] = useState<ModSort>("relevance")
  const [cfSortBy, setCfSortBy] = useState<ModSort>("downloads")
  const [selectedVersion, setSelectedVersion] = useState("all")
  const [selectedModLoader, setSelectedModLoader] = useState("all")
  const [modCategories, setModCategories] = useState<SelectedModCategory[]>([])
  const [marketplaceCategories, setMarketplaceCategories] = useState<Array<ModCategory & { source?: "modrinth" | "curseforge" }>>([])
  const [mrLoading, setMrLoading] = useState(false)
  const [cfLoading, setCfLoading] = useState(false)
  const [mrResults, setMrResults] = useState<ModSearchResult[]>([])
  const [cfResults, setCfResults] = useState<ModSearchResult[]>([])
  const [mrTotalHits, setMrTotalHits] = useState(0)
  const [cfTotalHits, setCfTotalHits] = useState(0)
  const [mrInstallingKey, setMrInstallingKey] = useState<string | null>(null)
  const [cfInstallingKey, setCfInstallingKey] = useState<string | null>(null)

  // ── Details modal state ──
  const [selectedDetails, setSelectedDetails] = useState<ModDetails | null>(null)
  const [projectVersions, setProjectVersions] = useState<ModVersion[]>([])
  const [modalTab, setModalTab] = useState<ModalTab>("description")
  const [loadingModal, setLoadingModal] = useState(false)
  const [modalInstalling, setModalInstalling] = useState(false)

  // ── Pack install settings modal ──
  const [pendingPack, setPendingPack] = useState<PackInstallTarget | null>(null)
  const [showPackInstall, setShowPackInstall] = useState(false)

  const catsKey = modCategories.map(c => `${c.source ?? "both"}:${c.name}`).join(",")

  const fetchMrModpacks = useCallback(async (query: string, currentPage: number) => {
    setMrLoading(true)
    try {
      const searchQuery = query.trim()
      const mrCats = modCategories.filter(c => c.source !== "curseforge").map(c => c.name)
      const catsMr = mrCats.length > 0 ? mrCats : undefined
      const key = `servers:modrinth:${searchQuery}:${selectedVersion}:${selectedModLoader}:${mrSortBy}:${catsKey}:${currentPage}`
      const resp = await dataCache.getOrFetch(
        key,
        () => window.electronAPI?.modsModrinthSearch(
          searchQuery,
          "modpack",
          selectedVersion === "all" ? undefined : selectedVersion,
          selectedModLoader === "all" ? undefined : selectedModLoader as "vanilla" | "fabric" | "neoforge" | "quilt",
          mrSortBy,
          currentPage,
          catsMr,
          "server",
        ) ?? null,
        { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
      )
      setMrResults(resp?.results ?? [])
      setMrTotalHits(resp?.totalCount ?? 0)
    } catch {
      setMrResults([])
      setMrTotalHits(0)
    } finally { setMrLoading(false) }
  }, [mrSortBy, selectedModLoader, selectedVersion, modCategories, catsKey])

  const fetchCfModpacks = useCallback(async (query: string, currentPage: number) => {
    setCfLoading(true)
    try {
      const searchQuery = query.trim()
      const cfCats = modCategories.filter(c => c.source !== "modrinth").map(c => c.name)
      const catsCf = cfCats.length > 0 ? cfCats : undefined
      const key = `servers:curseforge:${searchQuery}:${selectedVersion}:${selectedModLoader}:${cfSortBy}:${catsKey}:${currentPage}`
      const resp = await dataCache.getOrFetch(
        key,
        () => window.electronAPI?.modsCurseforgeSearch(
          searchQuery,
          "modpack",
          selectedVersion === "all" ? undefined : selectedVersion,
          selectedModLoader === "all" ? undefined : selectedModLoader,
          cfSortBy,
          currentPage,
          catsCf,
          "server",
        ) ?? null,
        { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
      )
      setCfResults(resp?.results ?? [])
      setCfTotalHits(resp?.totalCount ?? 0)
    } catch {
      setCfResults([])
      setCfTotalHits(0)
    } finally { setCfLoading(false) }
  }, [cfSortBy, selectedModLoader, selectedVersion, modCategories, catsKey])

  useEffect(() => {
    if (view !== "modrinth") return
    const t = setTimeout(() => void fetchMrModpacks(mrSearch, mrPage), 350)
    return () => clearTimeout(t)
  }, [fetchMrModpacks, mrSearch, mrPage, view])

  useEffect(() => {
    if (view !== "curseforge") return
    const t = setTimeout(() => void fetchCfModpacks(cfSearch, cfPage), 350)
    return () => clearTimeout(t)
  }, [fetchCfModpacks, cfSearch, cfPage, view])

  useEffect(() => { setMrPage(0) }, [mrSearch, mrSortBy, selectedModLoader, selectedVersion, modCategories, catsKey])
  useEffect(() => { setCfPage(0) }, [cfSearch, cfSortBy, selectedModLoader, selectedVersion, modCategories, catsKey])

  useEffect(() => {
    if (view !== "modrinth" && view !== "curseforge") return
    if (marketplaceCategories.length > 0) return
    let cancelled = false
    const loadCategories = async () => {
      try {
        const [mrCats, cfCats] = await Promise.all([
          window.electronAPI?.modsModrinthCategories() ?? Promise.resolve([]),
          window.electronAPI?.modsCurseforgeCategories() ?? Promise.resolve([]),
        ])
        if (cancelled) return
        const merged = [
          ...(mrCats ?? []).map(c => ({ ...c, source: "modrinth" as const })),
          ...(cfCats ?? []).map(c => ({ ...c, source: "curseforge" as const })),
        ]
        if (merged.length > 0) setMarketplaceCategories(merged)
      } catch {}
    }
    loadCategories()
    return () => { cancelled = true }
  }, [view, marketplaceCategories.length])

  const installModrinthPack = (project: ModSearchResult) => {
    setPendingPack({
      source: "modrinth",
      projectSlug: project.slug,
      name: project.name,
      icon: project.iconUrl || undefined,
    })
    setShowPackInstall(true)
  }

  const installCfPack = (project: ModSearchResult) => {
    if (!project.modId || !project.primaryFileId) return
    setPendingPack({
      source: "curseforge",
      modId: project.modId,
      fileId: project.primaryFileId,
      name: project.name,
      icon: project.iconUrl || undefined,
    })
    setShowPackInstall(true)
  }

  const openServerPackModal = async (item: ModSearchResult) => {
    setModalTab("description")
    setLoadingModal(true)
    setSelectedDetails({
      id: item.id, slug: item.slug, name: item.name, summary: item.summary,
      description: item.summary, iconUrl: item.iconUrl, downloadCount: item.downloadCount,
      categories: item.categories, versions: [], gallery: [], source: item.source,
      modId: item.modId, projectId: item.projectId,
    })
    try {
      if (item.source === "modrinth") {
        const [details, versions] = await Promise.all([
          dataCache.getOrFetch(`servers-modrinth:details:${item.slug}`, () => window.electronAPI?.modsModrinthDetails(item.slug) ?? null, { immutable: true }),
          dataCache.getOrFetch(`servers-modrinth:versions:${item.slug}`, () => window.electronAPI?.modsModrinthVersions(item.slug) ?? null, { immutable: true }),
        ])
        if (details) setSelectedDetails(details)
        setProjectVersions(versions ?? [])
      } else if (item.source === "curseforge" && item.modId != null) {
        const details = await dataCache.getOrFetch(`servers-curseforge:details:${item.modId}`, () => window.electronAPI?.modsCurseforgeDetails(item.modId!) ?? null, { immutable: true })
        if (details) setSelectedDetails(details)
        setProjectVersions(details?.versions ?? [])
      }
    } catch {
      // ignore
    }
    setLoadingModal(false)
  }

  const closeServerPackModal = () => { setSelectedDetails(null); setProjectVersions([]) }

  const displayedModalVersions = useMemo(() => {
    if (!selectedDetails) return []
    const filtered = projectVersions.filter(v => {
      if (selectedVersion !== "all" && v.gameVersion && !v.gameVersion.split(", ").includes(selectedVersion)) return false
      if (selectedModLoader !== "all" && v.loaders && v.loaders.length > 0) {
        const loaders = v.loaders.map(l => l.toLowerCase())
        if (!loaders.includes(selectedModLoader)) return false
      }
      return true
    })
    return filtered.length > 0 ? filtered : projectVersions
  }, [projectVersions, selectedDetails, selectedModLoader, selectedVersion])

  const installModalVersion = (version: ModVersion) => {
    if (!selectedDetails) return
    if (selectedDetails.source === "modrinth") {
      setPendingPack({
        source: "modrinth",
        projectSlug: selectedDetails.slug,
        versionId: version.id,
        name: selectedDetails.name,
        icon: selectedDetails.iconUrl || undefined,
      })
    } else if (selectedDetails.source === "curseforge" && selectedDetails.modId != null) {
      setPendingPack({
        source: "curseforge",
        modId: selectedDetails.modId,
        fileId: Number(version.id),
        name: selectedDetails.name,
        icon: selectedDetails.iconUrl || undefined,
      })
    } else {
      return
    }
    setShowPackInstall(true)
  }

  return (
    <div className="flex flex-col h-full gap-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconServer className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t("servers.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("servers.onlineCount", { count: servers.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button key="servers" type="button" onClick={() => setView("servers")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              view === "servers" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <IconServer className="w-3.5 h-3.5" strokeWidth={1.75} />
            {t("servers.title")}
          </button>
          <button key="trash" type="button" onClick={() => setView("trash")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              view === "trash" ? "bg-red-500/20 text-red-400" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <IconTrash className="w-3.5 h-3.5" strokeWidth={1.75} />
            {t("servers.trash")}
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <button key="modrinth" type="button" onClick={() => setView("modrinth")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              view === "modrinth" ? "bg-green-500/20 text-green-400" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path fill="currentColor" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
            </svg>Modrinth
          </button>
          <button key="curseforge" type="button" onClick={() => setView("curseforge")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              view === "curseforge" ? "bg-orange-500/20 text-orange-400" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path fill="currentColor" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
            </svg>CurseForge
          </button>

          {view === "servers" && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border border-border">
                <button
                  type="button"
                  onClick={() => setLayoutMode("grid")}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    layoutMode === "grid" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
                  )}
                  title={t("servers.viewGrid")}
                >
                  <IconLayoutGrid className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("list")}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    layoutMode === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
                  )}
                  title={t("servers.viewList")}
                >
                  <IconLayoutList className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="w-px h-6 bg-border mx-1" />
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]"
              >
                <IconPlus className="w-4 h-4" strokeWidth={1.75} />
                {t("servers.addServer")}
              </button>
            </>
          )}
        </div>
      </div>

      {view === "trash" ? (
        <ServerTrashView onBack={() => setView("servers")} />
      ) : view === "modrinth" ? (
        <ServersBrowse
          source="modrinth"
          search={mrSearch}
          setSearch={setMrSearch}
          loading={mrLoading}
          results={mrResults}
          installingKey={mrInstallingKey}
          sortBy={mrSortBy}
          setSortBy={setMrSortBy}
          sortOptions={MODRINTH_SORT_OPTIONS}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          versionsLoaded={versionsLoaded}
          versionOptions={visibleVersions}
          selectedModLoader={selectedModLoader}
          setSelectedModLoader={setSelectedModLoader}
          page={mrPage}
          totalPages={Math.max(1, Math.ceil(mrTotalHits / PAGE_SIZE))}
          onPageChange={setMrPage}
          onInstall={installModrinthPack}
          onOpenDetails={openServerPackModal}
          categories={marketplaceCategories}
          modCategories={modCategories}
          setModCategories={setModCategories}
        />
      ) : view === "curseforge" ? (
        <ServersBrowse
          source="curseforge"
          search={cfSearch}
          setSearch={setCfSearch}
          loading={cfLoading}
          results={cfResults}
          installingKey={cfInstallingKey}
          sortBy={cfSortBy}
          setSortBy={setCfSortBy}
          sortOptions={CURSEFORGE_SORT_OPTIONS}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          versionsLoaded={versionsLoaded}
          versionOptions={visibleVersions}
          selectedModLoader={selectedModLoader}
          setSelectedModLoader={setSelectedModLoader}
          page={cfPage}
          totalPages={Math.max(1, Math.ceil(cfTotalHits / PAGE_SIZE))}
          onPageChange={setCfPage}
          onInstall={installCfPack}
          onOpenDetails={openServerPackModal}
          categories={marketplaceCategories}
          modCategories={modCategories}
          setModCategories={setModCategories}
        />
      ) : (
        <>
          {/* Server grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                <IconServer className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-medium text-foreground">{t("servers.noServers")}</p>
                <p className="text-sm text-muted-foreground mt-1">{t("servers.noServersDesc")}</p>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]"
              >
                <IconPlus className="w-4 h-4" strokeWidth={1.75} />
                {t("servers.addServer")}
              </button>
            </div>
          ) : (
            layoutMode === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 px-3 pb-4 overflow-y-auto flex-1 min-h-0 items-start">
                {servers.map(server => (
                  <ServerTileWrapper
                    key={server.id}
                    server={server}
                    onClick={() => onSelectServer?.(server)}
                    onDelete={() => deleteServer(server.id)}
                    onDuplicate={() => void duplicateServer(server.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1 px-3 pb-4 overflow-y-auto flex-1 min-h-0">
                {servers.map(server => (
                  <ServerListRow
                    key={server.id}
                    server={server}
                    onClick={() => onSelectServer?.(server)}
                    onDelete={() => deleteServer(server.id)}
                    onDuplicate={() => void duplicateServer(server.id)}
                  />
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Create dialog */}
      <ServerCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={createServer}
      />

      {/* Pack install settings modal */}
      <ServerPackInstallDialog
        open={showPackInstall}
        onOpenChange={setShowPackInstall}
        pack={pendingPack}
        onInstalled={() => reload()}
      />

      {/* Details modal */}
      {selectedDetails && (
        <InstanceModal
          selectedDetails={selectedDetails}
          modalTab={modalTab}
          setModalTab={setModalTab}
          loadingModal={loadingModal}
          displayedModalVersions={displayedModalVersions}
          onInstallVersion={installModalVersion}
          onClose={closeServerPackModal}
        />
      )}
    </div>
  )
}

function ServerTileWrapper({ server, onClick, onDelete, onDuplicate }: { server: McServerInfo; onClick: () => void; onDelete: () => void; onDuplicate: () => void }) {
  const { state, start, stop } = useMcServerState(server.id)

  return (
    <ServerTile
      server={server}
      state={state}
      onClick={onClick}
      onStart={start}
      onStop={stop}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
    />
  )
}

function ServerListRow({ server, onClick, onDelete, onDuplicate }: { server: McServerInfo; onClick: () => void; onDelete: () => void; onDuplicate: () => void }) {
  const { t } = useTranslation()
  const { state, start, stop } = useMcServerState(server.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  const isRunning = state.status === "running"
  const isBusy = state.status === "starting" || state.status === "stopping"

  const loaderName = loaderLabel(server.modloader)

  const handlePlayStop = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isBusy) return
    if (isRunning) stop()
    else start()
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  return (
    <>
      <div
        className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
          {server.icon ? (
            <img src={server.icon} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 flex items-center justify-center">
              <IconServer className="w-5 h-5 text-primary/40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{server.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <LoaderIcon loaderId={server.modloader} className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">{loaderName} · {server.gameVersion}</span>
            {server.source && (
              <PlatformBadge source={server.source} showLabel className="shrink-0 text-[10px] py-0 px-1.5" iconSize={11} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isRunning && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-green-500/15 text-green-500">
              {t("servers.running")}
            </span>
          )}
          <button
            onClick={handlePlayStop}
            disabled={isBusy}
            className={cn(
              "p-2 rounded-xl transition-all",
              isRunning
                ? "bg-red-500/80 hover:bg-red-500 text-white"
                : "bg-primary/80 hover:bg-primary text-primary-foreground",
              isBusy && "opacity-50 cursor-not-allowed"
            )}
          >
            {isRunning ? (
              <IconPlayerStop className="w-4 h-4" />
            ) : (
              <IconPlayerPlay className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <ServerContextMenu
          server={server}
          position={menuPos}
          isRunning={isRunning}
          isBusy={isBusy}
          onConnect={onClick}
          onToggleRun={() => { if (isRunning) stop(); else start() }}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  )
}