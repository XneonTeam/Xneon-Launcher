import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IconSearch, IconPuzzle, IconStack2, IconPhoto, IconSparkles } from "@tabler/icons-react"
import { contentTypes, gameVersions, modSortOptions, MODS_PER_PAGE } from "./constants"
import { ModsList } from "./mods-list"
import { ModrinthModal, CFModal } from "./mods-modal"
import { Pagination } from "./mods-ui"
import type { ContentType, Source, ModSort, ModalTab, ModSearchResult, ModSearchResponse, ModDetails, ModVersion } from "./types"

export function ModsPage() {
  const { t } = useTranslation()
  const [activeType, setActiveType] = useState<ContentType>("mod")
  const [source, setSource] = useState<Source>("modrinth")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedVersion, setSelectedVersion] = useState("1.21")
  const [showAlpha, setShowAlpha] = useState(false)
  const [showBeta, setShowBeta] = useState(false)
  const [showSnapshot, setShowSnapshot] = useState(false)

  useEffect(() => {
    void window.electronAPI?.getSetting("showAlpha").then(v => setShowAlpha(v === "true"))
    void window.electronAPI?.getSetting("showBeta").then(v => setShowBeta(v === "true"))
    void window.electronAPI?.getSetting("showSnapshot").then(v => setShowSnapshot(v === "true"))
  }, [])
  const [sortBy, setSortBy] = useState<ModSort>("downloads")

  const [results, setResults] = useState<ModSearchResult[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [page, setPage] = useState(0)

  const [loading, setLoading] = useState(true)

  const [selectedDetails, setSelectedDetails] = useState<ModDetails | null>(null)
  const [projectVersions, setProjectVersions] = useState<ModVersion[]>([])
  const [loadingModal, setLoadingModal] = useState(false)
  const [modalTab, setModalTab] = useState<ModalTab>("description")

  const fetchMods = useCallback(async (currentPage: number) => {
    setLoading(true)
    try {
      let resp: ModSearchResponse
      if (source === "modrinth") {
        resp = await window.electronAPI!.modsModrinthSearch(searchQuery, activeType, selectedVersion, sortBy, currentPage)
      } else {
        resp = await window.electronAPI!.modsCurseforgeSearch(searchQuery, activeType, selectedVersion, undefined, sortBy, currentPage)
      }
      setResults(resp.results ?? [])
      setTotalHits(resp.totalCount ?? 0)
    } catch {
      setResults([]); setTotalHits(0)
    }
    setLoading(false)
  }, [source, activeType, searchQuery, selectedVersion, sortBy])

  useEffect(() => { setPage(0) }, [source, activeType, searchQuery, selectedVersion, sortBy])

  useEffect(() => {
    const timer = setTimeout(() => fetchMods(page), 300)
    return () => clearTimeout(timer)
  }, [fetchMods, page])

  const openModModal = async (item: ModSearchResult) => {
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
          window.electronAPI!.modsModrinthDetails(item.slug),
          window.electronAPI!.modsModrinthVersions(item.slug),
        ])
        if (details) setSelectedDetails(details)
        setProjectVersions(versions ?? [])
      } else if (item.source === "curseforge" && item.modId) {
        const details = await window.electronAPI!.modsCurseforgeDetails(item.modId)
        if (details) setSelectedDetails(details)
        setProjectVersions(details?.versions ?? [])
      }
    } catch {}
    setLoadingModal(false)
  }

  const installFile = async (fileId: number, modId: number) => {
    try {
      const url = await window.electronAPI?.modsCurseforgeDownloadUrl(fileId, modId)
      if (url) window.open(url, "_blank")
    } catch {}
  }

  const totalPages = Math.max(1, Math.ceil(totalHits / MODS_PER_PAGE))

  const Header = () => {
    const CONTENT_ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
      mod: IconPuzzle, modpack: IconStack2, resourcepack: IconPhoto, shader: IconSparkles,
    }
    return (
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <IconPuzzle className="w-5 h-5 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t("mods.title")}</h2>
              <p className="text-sm text-muted-foreground">{totalHits > 0 ? `${totalHits.toLocaleString()} ${t("mods.results")}` : t("mods.search")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {contentTypes.map(type => {
              const Icon = CONTENT_ICONS[type.id]
              return (
                <button key={type.id} onClick={() => setActiveType(type.id)} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all", activeType === type.id ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  {t(`mods.category.${type.id}`)}
                </button>
              )
            })}
            <div className="w-px h-6 bg-border mx-1" />
            <button onClick={() => setSource("modrinth")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", source === "modrinth" ? "bg-green-500/20 text-green-400" : "bg-muted/50 text-muted-foreground")}>
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path fill="currentColor" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
              </svg>Modrinth
            </button>
            <button onClick={() => setSource("curseforge")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", source === "curseforge" ? "bg-orange-500/20 text-orange-400" : "bg-muted/50 text-muted-foreground")}>
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path fill="currentColor" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
              </svg>CurseForge
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
      <Header />

      <div className="flex items-center gap-3 mb-1">
        <div className="flex-1 relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t("mods.search")} className="w-full h-10 pl-10 pr-4 py-2 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
        </div>
        <Select value={sortBy} onValueChange={v => setSortBy(v as ModSort)}>
          <SelectTrigger className="w-[200px] h-[34px] rounded-xl bg-muted/50 border-border text-foreground">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {modSortOptions.map(o => <SelectItem key={o.id} value={o.id}>{t(`mods.sort.${o.id}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <select value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)} className="px-4 py-1.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm focus:outline-none focus:border-primary">
          {gameVersions.filter(v =>
            v.type === "release" ||
            (v.type === "beta" && showBeta) ||
            (v.type === "alpha" && showAlpha) ||
            (v.type === "snapshot" && showSnapshot)
          ).map(v => <option key={v.version} value={v.version}>{v.version}</option>)}
        </select>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 rounded-b-xl w-full pr-2">
          <ModsList
            loading={loading}
            source={source}
            results={results}
            onOpenMod={openModModal}
            onInstallMod={item => {
              if (item.source === "modrinth") window.open(`https://modrinth.com/mod/${item.slug}`, "_blank")
              else if (item.primaryFileId && item.modId) installFile(item.primaryFileId, item.modId)
            }}
          />
        </div>
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          className="mt-auto"
        />
      </div>

      {selectedDetails && (
        selectedDetails.source === "modrinth" ? (
          <ModrinthModal
            details={selectedDetails}
            versions={projectVersions}
            loading={loadingModal}
            modalTab={modalTab}
            setModalTab={setModalTab}
            onClose={() => { setSelectedDetails(null); setProjectVersions([]) }}
          />
        ) : (
          <CFModal
            details={selectedDetails}
            loading={loadingModal}
            modalTab={modalTab}
            setModalTab={setModalTab}
            onClose={() => { setSelectedDetails(null); setProjectVersions([]) }}
            onInstall={installFile}
          />
        )
      )}
    </div>
  )
}
