import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react"
import { useTranslation } from "react-i18next"
import {
  IconSearch, IconUpload, IconPlug, IconPuzzle, IconLoader2,
} from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { SourceMark } from "@/components/launcher/source-mark"
import { Spinner } from "../instance/spinner"
import { Pagination } from "../instance/pagination"
import { contentProjectKey, formatDownloads } from "../instance/utils"
import { getSortLabels, SORT_OPTIONS_BY_SOURCE } from "../instance/sort-options"
import { dataCache, MOD_SEARCH_CACHE_TTL } from "@/lib/swr"
import type { McServerInfo, McFsEntry } from "@xnlc/types"
import type { ModSearchResult, ModSort, ModVersion, ModDetails, ModContentType, ModCategory } from "@xnlc/types"
import type { SearchSource } from "../instance/types"
import { AddonDetailModal } from "@/components/launcher/addon-detail-modal"
import { AddonRow } from "@/components/launcher/addon-row"
import { AddonCategoryDialog } from "./addons/addon-category-dialog"
import {
  MODS_PER_PAGE, getContentType, getContentDir, isVersionCompatibleWithServer,
} from "./addons/utils"
import type { ModalTab, SelectedAddonCategory } from "./addons/types"

interface AddonsTabProps {
  server: McServerInfo
}

export function AddonsTab({ server }: AddonsTabProps) {
  const { t } = useTranslation()
  const contentType = getContentType(server.modloader)
  const contentDir = getContentDir(server.modloader)

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ModSearchResult[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<ModSort>("downloads")
  const [source, setSource] = useState<SearchSource>("modrinth")
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [installedFiles, setInstalledFiles] = useState<McFsEntry[]>([])
  const [resolvedPlugins, setResolvedPlugins] = useState<Array<{ name: string; sha1: string; projectId?: string; versionId?: string }>>([])
  const [selectedDetails, setSelectedDetails] = useState<ModDetails | null>(null)
  const [detailVersions, setDetailVersions] = useState<ModVersion[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [modalTab, setModalTab] = useState<ModalTab>("description")
  const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null)
  const deferredResults = useDeferredValue(results)
  const [categories, setCategories] = useState<ModCategory[]>([])
  const [selectedCategories, setSelectedCategories] = useState<SelectedAddonCategory[]>([])

  const searchVersionRef = useRef(0)

  // Сортировки у платформ разные: при смене платформы сбрасываем недоступную,
  // иначе на Modrinth оставалось бы «Избранное», которого там нет.
  useEffect(() => {
    const allowed = SORT_OPTIONS_BY_SOURCE[source]
    if (!allowed.includes(sortBy)) {
      setSortBy(allowed[0] ?? "downloads")
      setPage(1)
    }
  }, [source, sortBy])

  // Показываем только совместимые версии — как в инстансах.
  const compatibleDetailVersions = useMemo(
    () => detailVersions.filter(ver => isVersionCompatibleWithServer(ver, server.gameVersion, server.modloader)),
    [detailVersions, server.gameVersion, server.modloader],
  )

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const loadInstalled = useCallback(async () => {
    if (!contentDir) return
    try {
      const entries = await window.electronAPI?.mcServerFsList(server.id, contentDir)
      setInstalledFiles(entries ?? [])
      const resolved = await window.electronAPI?.mcServerResolveInstalled(server.id, contentDir)
      setResolvedPlugins(resolved ?? [])
    } catch {
      setInstalledFiles([])
      setResolvedPlugins([])
    }
  }, [server.id, contentDir])

  useEffect(() => {
    loadInstalled()
  }, [loadInstalled])

  useEffect(() => {
    if (!contentType) return
    const loadCategories = async () => {
      try {
        if (source === "both") {
          const [mrCats, cfCats] = await Promise.all([
            window.electronAPI?.modsModrinthCategories(),
            window.electronAPI?.modsCurseforgeCategories(),
          ])
          const merged = [
            ...(mrCats ?? []).map(c => ({ ...c, source: "modrinth" as const })),
            ...(cfCats ?? []).map(c => ({ ...c, source: "curseforge" as const })),
          ]
          if (merged.length > 0) setCategories(merged as ModCategory[])
        } else if (source === "curseforge") {
          const cats = await window.electronAPI?.modsCurseforgeCategories()
          if (cats) setCategories(cats.map(c => ({ ...c, source: "curseforge" as const })) as ModCategory[])
        } else {
          const cats = await window.electronAPI?.modsModrinthCategories()
          if (cats) setCategories(cats.map(c => ({ ...c, source: "modrinth" as const })) as ModCategory[])
        }
      } catch {}
    }
    loadCategories()
  }, [contentType, source])

  const isInstalled = useCallback((project: ModSearchResult): boolean => {
    if (project.source === "modrinth" && project.projectId) {
      return resolvedPlugins.some(r => r.projectId === project.projectId)
    }
    if (project.source === "curseforge" && typeof project.modId === "number") {
      return installedFiles.some(f => f.name.toLowerCase().includes(project.slug?.toLowerCase() ?? ""))
    }
    const nameLower = project.name.toLowerCase()
    return installedFiles.some(f => {
      const fLower = f.name.toLowerCase()
      return fLower.includes(nameLower) || fLower.includes(project.slug?.toLowerCase() ?? "")
    })
  }, [resolvedPlugins, installedFiles])

  /**
   * Имя файла уже установленного плагина для открытого в окне проекта: по нему
   * отмечаем текущую версию в списке (имя файла версии у платформы и на диске совпадает).
   */
  const installedFileName = useMemo(() => {
    if (!selectedDetails) return undefined
    const slug = selectedDetails.slug?.toLowerCase()
    const name = selectedDetails.name.toLowerCase()
    return installedFiles.find(f => {
      if (f.isDir) return false
      const fileLower = f.name.toLowerCase()
      return (slug ? fileLower.includes(slug) : false) || fileLower.includes(name)
    })?.name
  }, [selectedDetails, installedFiles])

  const searchModrinth = useCallback((
    query: string, type: ModContentType, version: string | undefined,
    sort: ModSort, page: number, cats?: string[],
  ) => {
    const key = `modrinth:server-search:${type}:${query ?? ""}:${version ?? ""}:${sort}:${page}:${(cats ?? []).join(",")}`
    return dataCache.getOrFetch(
      key,
      () => window.electronAPI?.modsModrinthSearch(query, type, version, undefined, sort, page, cats) ?? null,
      { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
    )
  }, [])

  const searchCurseforge = useCallback((
    query: string, type: ModContentType, version: string | undefined,
    sort: ModSort, page: number, cats?: string[],
  ) => {
    const key = `curseforge:server-search:${type}:${query ?? ""}:${version ?? ""}:${sort}:${page}:${(cats ?? []).join(",")}`
    return dataCache.getOrFetch(
      key,
      () => window.electronAPI?.modsCurseforgeSearch(query, type, version, undefined, sort, page, cats) ?? null,
      { ttl: MOD_SEARCH_CACHE_TTL, persist: true },
    )
  }, [])

  useEffect(() => {
    if (!contentType) return
    const ct = contentType as ModContentType
    const version = ++searchVersionRef.current
    setLoading(true)

    const doSearch = async () => {
      try {
        const gameVersion = server.gameVersion
        let mrResults: ModSearchResult[] = []
        let cfResults: ModSearchResult[] = []
        let mrTotal = 0
        let cfTotal = 0

        const apiPage = page - 1
        const mrCats = selectedCategories.filter(c => c.source !== "curseforge").map(c => c.name)
        const cfCats = selectedCategories.filter(c => c.source !== "modrinth").map(c => c.name)
        const catsMr = mrCats.length > 0 ? mrCats : undefined
        const catsCf = cfCats.length > 0 ? cfCats : undefined

        if (source === "both" || source === "modrinth") {
          try {
            const resp = await searchModrinth(debouncedSearch, ct, gameVersion, sortBy, apiPage, catsMr)
            if (resp) {
              mrResults = resp.results ?? []
              mrTotal = resp.totalCount ?? 0
            }
          } catch {}
        }

        if (source === "both" || source === "curseforge") {
          try {
            const resp = await searchCurseforge(debouncedSearch, ct, gameVersion, sortBy, apiPage, catsCf)
            if (resp) {
              cfResults = resp.results ?? []
              cfTotal = resp.totalCount ?? 0
            }
          } catch {}
        }

        if (version !== searchVersionRef.current) return

        let merged: ModSearchResult[]
        if (source === "both") {
          merged = [...mrResults, ...cfResults].sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0))
        } else {
          merged = source === "modrinth" ? mrResults : cfResults
        }

        setResults(merged)
        setTotalHits(mrTotal + cfTotal)
      } catch {
        if (version !== searchVersionRef.current) return
        setResults([])
        setTotalHits(0)
      } finally {
        if (version === searchVersionRef.current) setLoading(false)
      }
    }

    doSearch()
  }, [debouncedSearch, contentType, server.gameVersion, sortBy, source, page, selectedCategories, searchModrinth, searchCurseforge])

  const totalPages = Math.max(1, Math.ceil(totalHits / MODS_PER_PAGE))

  const handleDownload = useCallback(async (project: ModSearchResult) => {
    if (!contentDir || installingSlug) return
    setInstallingSlug(contentProjectKey(project))

    try {
      let downloadUrl: string | null = null
      let fileName = `${project.name}.jar`

      if (project.source === "modrinth" && project.projectId) {
        const versions = await window.electronAPI?.modsModrinthVersions(project.projectId!)
        if (versions && versions.length > 0) {
          const loader = server.modloader
          const compatible = versions.filter(v => {
            const gvs = v.gameVersion.split(/[|,/]/).map(s => s.trim()).filter(Boolean)
            const gameOk = gvs.length === 0 || gvs.includes(server.gameVersion)
            const loaders = v.loaders ?? []
            const loaderOk = loaders.length === 0 || loaders.includes(loader)
              || (loader === "paper" && loaders.includes("folia"))
              || (loader === "folia" && loaders.includes("paper"))
            return gameOk && loaderOk
          })
          const ver = compatible.length > 0 ? compatible[0] : versions[0]
          downloadUrl = ver.downloadUrl ?? null
          fileName = ver.fileName || fileName
        }
      } else if (project.source === "curseforge" && project.modId && project.primaryFileId) {
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(project.primaryFileId, project.modId)
        if (url) {
          downloadUrl = url
          fileName = project.primaryFileName || fileName
        }
      }

      if (!downloadUrl) return

      await window.electronAPI?.mcServerFsDownload(server.id, contentDir, downloadUrl, fileName)
      await loadInstalled()
    } catch (err) {
      console.error("Download failed:", err)
    } finally {
      setInstallingSlug(null)
    }
  }, [contentDir, installingSlug, server.id, server.gameVersion, server.modloader, loadInstalled])

  const handleUpload = useCallback(async (file: File) => {
    if (!contentDir) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const content = new TextDecoder("latin1").decode(arrayBuffer)
      await window.electronAPI?.mcServerFsWrite(server.id, `${contentDir}/${file.name}`, content)
      await loadInstalled()
    } catch {}
  }, [contentDir, server.id, loadInstalled])

  const openDetails = useCallback(async (project: ModSearchResult) => {
    setModalTab("description")
    setLoadingDetail(true)
    setSelectedDetails({
      id: project.id, slug: project.slug, name: project.name, summary: project.summary,
      description: project.summary, iconUrl: project.iconUrl, downloadCount: project.downloadCount,
      categories: project.categories, versions: [], gallery: [], source: project.source,
      modId: project.modId, projectId: project.projectId,
    })
    setDetailVersions([])
    try {
      if (project.source === "modrinth" && project.slug) {
        const [d, v] = await Promise.all([
          dataCache.getOrFetch(`modrinth:details:${project.slug}`, () => window.electronAPI?.modsModrinthDetails(project.slug) ?? null, { immutable: true }),
          dataCache.getOrFetch(`modrinth:versions:${project.slug}`, () => window.electronAPI?.modsModrinthVersions(project.projectId ?? project.slug) ?? null, { immutable: true }),
        ])
        if (d) setSelectedDetails(d)
        setDetailVersions(v ?? [])
      } else if (project.source === "curseforge" && project.modId) {
        const d = await dataCache.getOrFetch(`curseforge:details:${project.modId}`, () => window.electronAPI?.modsCurseforgeDetails(project.modId!) ?? null, { immutable: true })
        if (d) setSelectedDetails(d)
        setDetailVersions(d?.versions ?? [])
      }
    } catch {}
    setLoadingDetail(false)
  }, [])

  const closeDetails = useCallback(() => {
    setSelectedDetails(null)
    setDetailVersions([])
  }, [])

  if (!contentType) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
          <IconPlug className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <div>
          <p className="font-medium text-foreground">{t("servers.addons.noAddons")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("servers.addons.noAddonsDesc")}
          </p>
        </div>
      </div>
    )
  }

  const emptyStateText = contentType === "plugin" ? t("servers.addons.findPlugins") : t("servers.addons.findMods")
  const notFoundText = contentType === "plugin" ? t("servers.addons.pluginsNotFound") : t("servers.addons.modsNotFound")
  const searchTitle = contentType === "plugin" ? t("servers.addons.plugins") : t("servers.addons.mods")

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder={emptyStateText}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={v => { setSource(v as SearchSource); setPage(1) }}>
            {/* Ширина по содержимому: значок + «Обе платформы» должны влезать целиком */}
            <SelectTrigger className="w-auto min-w-[150px] h-8 text-xs">
              {/* Значок подставляет сам SelectValue из выбранного пункта — второй не нужен */}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Порядок пунктов: Modrinth → CurseForge → обе платформы (и Modrinth по умолчанию). */}
              <SelectItem value="modrinth">
                <span className="flex items-center gap-1.5"><SourceMark source="modrinth" />Modrinth</span>
              </SelectItem>
              <SelectItem value="curseforge">
                <span className="flex items-center gap-1.5"><SourceMark source="curseforge" />CurseForge</span>
              </SelectItem>
              <SelectItem value="both">
                <span className="flex items-center gap-1.5">
                  <SourceMark source="modrinth" />
                  <SourceMark source="curseforge" />
                  {t("servers.addons.bothPlatforms")}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={v => { setSortBy(v as ModSort); setPage(1) }}>
            <SelectTrigger className="w-auto min-w-[165px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS_BY_SOURCE[source].map(id => (
                <SelectItem key={id} value={id}>{getSortLabels(t)[id]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AddonCategoryDialog
            categories={categories}
            contentType={contentType}
            selectedCategories={selectedCategories}
            onApply={(cats) => { setSelectedCategories(cats); setPage(1) }}
          />
          <button
            type="button"
            onClick={() => fileInputRef?.click()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          >
            <IconUpload className="w-4 h-4" strokeWidth={1.75} />
            {t("servers.addons.uploadJar")}
          </button>
          <input
            ref={setFileInputRef}
            type="file"
            accept=".jar,.zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) {
                handleUpload(file)
                e.target.value = ""
              }
            }}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-border bg-card/40 p-4">
        <div className="flex items-center justify-between shrink-0">
          <h3 className="text-sm font-medium text-muted-foreground">{searchTitle}</h3>
          {!loading && results.length > 0 && (
            <span className="text-xs text-muted-foreground">{formatDownloads(totalHits)} {t("servers.addons.results")}</span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 mt-2">
          {results.length > 0 ? (
            <div className="grid gap-2 pb-2">
              {deferredResults.map(project => (
                <AddonRow
                  key={project.id}
                  project={project}
                  installed={isInstalled(project)}
                  installing={installingSlug === contentProjectKey(project)}
                  installLabel={t("servers.installModpack")}
                  projectKind={contentType === "plugin" ? "plugin" : "mod"}
                  onDetails={() => openDetails(project)}
                  onInstall={() => handleDownload(project)}
                />
              ))}
            </div>
          ) : loading ? (
            <Spinner />
          ) : (search || selectedCategories.length > 0) ? (
            <EmptyState title={notFoundText} className="h-full" />
          ) : (
            <EmptyState
              title={t("servers.addons.startSearch")}
              icon={IconSearch}
              className="h-full rounded-2xl border border-dashed border-border"
            />
          )}
        </div>
        <Pagination
          currentPage={page - 1}
          totalPages={totalPages}
          onPageChange={p => setPage(p + 1)}
          className="mt-2 shrink-0"
        />
      </div>

      {/* Detail modal */}
      <AddonDetailModal
        selectedDetails={selectedDetails}
        displayedModalVersions={compatibleDetailVersions}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingDetail}
        onClose={closeDetails}
        targetLabel={t("addon.target.server")}
        projectKind={contentType === "plugin" ? "plugin" : "mod"}
        installedVersion={installedFileName}
        onInstallVersion={(ver) => (async () => {
          if (!contentDir || !selectedDetails) return false
          setInstallingSlug(contentProjectKey(selectedDetails))
          try {
            let downloadUrl = ver.downloadUrl ?? null
            // У версий CurseForge прямой ссылки в ответе нет — запрашиваем её
            // отдельно, иначе кнопка «Скачать» молча ничего не делала.
            if (!downloadUrl && selectedDetails.source === "curseforge" && selectedDetails.modId) {
              downloadUrl = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(ver.id), selectedDetails.modId) ?? null
            }
            // Если автор запретил раздачу через API, файл всё равно лежит на
            // официальном CDN — собираем прямую ссылку по id (та же схема, что
            // в curseforgeGetFiles).
            if (!downloadUrl && selectedDetails.source === "curseforge" && ver.fileName) {
              const fileId = Number(ver.id)
              if (Number.isFinite(fileId) && fileId > 0) {
                downloadUrl = `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(ver.fileName)}`
              }
            }
            if (!downloadUrl) return false
            await window.electronAPI?.mcServerFsDownload(
              server.id, contentDir, downloadUrl, ver.fileName || `${selectedDetails.name}.jar`,
            )
            await loadInstalled()
            return true
          } finally {
            setInstallingSlug(null)
          }
        })()}
      />
    </div>
  )
}
