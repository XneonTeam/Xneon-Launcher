import { Checkbox } from "@/components/ui/checkbox"
import { datapackVersionFile } from "@/lib/datapack-version"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { useContentEnter, CONTENT_ENTER_DELAYED } from "../content-motion"
import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react"
import { useTranslation } from "react-i18next"
import {
  IconDownload, IconX, IconSearch, IconUpload, IconPlug, IconPuzzle, IconLoader2,
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
  datapacks?: boolean
  canReload?: boolean
}

export function AddonsTab({ server, datapacks = false, canReload = false }: AddonsTabProps) {
  const { t } = useTranslation()
  const contentType = datapacks ? "datapack" : getContentType(server.modloader)
  const contentDir = datapacks ? "datapacks" : getContentDir(server.modloader)
  const { pushNotification } = useActivityCenter()
  const reportError = (error: unknown) => pushNotification({ kind: "error", source: "install", title: t("servers.datapacks.title"), message: error instanceof Error ? error.message : String(error) })
  const compatible = useCallback((version: ModVersion) => datapacks
    ? Boolean(datapackVersionFile(version)) && version.gameVersion.split(/[|,/]/).map(value => value.trim()).includes(server.gameVersion)
    : isVersionCompatibleWithServer(version, server.gameVersion, server.modloader), [datapacks, server.gameVersion, server.modloader])
  const activeAttempt = useRef<{ id: string; cancelled: boolean } | null>(null)
  const cancelAttempt = () => {
    const attempt = activeAttempt.current
    if (!attempt) return
    attempt.cancelled = true
    activeAttempt.current = null
    setInstallingSlug(null)
    if (datapacks) void window.electronAPI?.mcServerDatapacksCancel(server.id, attempt.id).catch(console.error)
  }
  useEffect(() => () => {
    const attempt = activeAttempt.current
    if (attempt) {
      attempt.cancelled = true
      if (datapacks) void window.electronAPI?.mcServerDatapacksCancel(server.id, attempt.id).catch(console.error)
    }
  }, [server.id, datapacks])
  const installFile = async (name: string, url: string, requestId?: string) => {
    const result = datapacks
      ? await window.electronAPI?.mcServerDatapacksInstall(server.id, name, { url, requestId })
      : await window.electronAPI?.mcServerFsDownload(server.id, contentDir, url, name)
    if (!result?.success) throw new Error(result?.error || t("worlds.errors.datapackDownload"))
  }

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const contentEnter = useContentEnter(!loading)
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
  const [selectedProjects, setSelectedProjects] = useState<Record<string, ModSearchResult>>({})
  const [batchInstalling, setBatchInstalling] = useState(false)
  const batchGeneration = useRef(0)
  const batchRunning = useRef(false)
  useEffect(() => {
    setSelectedProjects({})
    return () => { batchGeneration.current++ }
  }, [server.id, datapacks])
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
    () => detailVersions.filter(compatible).map(version => datapacks ? { ...version, ...datapackVersionFile(version)! } : version),
    [detailVersions, compatible, datapacks],
  )

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const loadInstalled = useCallback(async () => {
    if (!contentDir) return
    try {
      if (datapacks) {
        const result = await window.electronAPI?.mcServerDatapacksList(server.id)
        setInstalledFiles(result?.entries ?? [])
        const resolved = result ? await window.electronAPI?.mcServerResolveInstalled(server.id, result.directory) : []
        setResolvedPlugins(resolved ?? [])
        return
      }
      const entries = await window.electronAPI?.mcServerFsList(server.id, contentDir)
      setInstalledFiles(entries ?? [])
      const resolved = await window.electronAPI?.mcServerResolveInstalled(server.id, contentDir)
      setResolvedPlugins(resolved ?? [])
    } catch (error) {
      setInstalledFiles([])
      setResolvedPlugins([])
      if (datapacks) reportError(error)
    }
  }, [server.id, contentDir, datapacks])

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
      if (resolvedPlugins.some(r => r.projectId === project.projectId)) return true
      if (!datapacks) return false
    }
    if (project.source === "curseforge" && typeof project.modId === "number") {
      return installedFiles.some(f => f.name.toLowerCase().includes(project.slug?.toLowerCase() ?? ""))
    }
    const nameLower = project.name.toLowerCase()
    return installedFiles.some(f => {
      const fLower = f.name.toLowerCase()
      return fLower.includes(nameLower) || fLower.includes(project.slug?.toLowerCase() ?? "")
    })
  }, [resolvedPlugins, installedFiles, datapacks])
  useEffect(() => {
    setSelectedProjects(current => {
      const remaining = Object.entries(current).filter(([, project]) => !isInstalled(project))
      return remaining.length === Object.keys(current).length ? current : Object.fromEntries(remaining)
    })
  }, [isInstalled])


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
    if (!contentDir || activeAttempt.current) return false
    const attempt = { id: crypto.randomUUID(), cancelled: false }
    activeAttempt.current = attempt
    setInstallingSlug(contentProjectKey(project))

    try {
      let downloadUrl: string | null = null
      let fileName = `${project.slug || project.name}.${datapacks ? "zip" : "jar"}`

      if (project.source === "modrinth" && project.projectId) {
        const versions = await window.electronAPI?.modsModrinthVersions(project.projectId!)
        if (versions && versions.length > 0) {
          const matching = versions.filter(compatible)
          const ver = matching[0]
          if (!ver) throw new Error(t("worlds.errors.datapackNoVersion"))
          const file = datapacks ? datapackVersionFile(ver)! : ver
          downloadUrl = file.downloadUrl ?? null
          fileName = file.fileName || fileName
        }
      } else if (project.source === "curseforge" && project.modId && project.primaryFileId) {
        let fileId = project.primaryFileId
        if (datapacks) {
          const details = await window.electronAPI?.modsCurseforgeDetails(project.modId)
          const version = details?.versions.filter(compatible)[0]
          if (!version) throw new Error(t("worlds.errors.datapackNoVersion"))
          fileId = Number(version.id)
          fileName = datapackVersionFile(version)!.fileName
        }
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(fileId, project.modId)
        if (url) {
          downloadUrl = url
          if (!datapacks) fileName = project.primaryFileName || fileName
        }
      }

      if (!downloadUrl || attempt.cancelled) return false

      await installFile(fileName, downloadUrl, attempt.id)
      await loadInstalled()
      return !attempt.cancelled
    } catch (err) {
      if (!attempt.cancelled) reportError(err)
      return false
    } finally {
      if (activeAttempt.current === attempt) {
        activeAttempt.current = null
        setInstallingSlug(null)
      }
    }
  }, [contentDir, installingSlug, server.id, server.gameVersion, server.modloader, loadInstalled, compatible, datapacks])

  const installSelected = async () => {
    if (batchRunning.current || activeAttempt.current) return
    const projects = Object.values(selectedProjects).filter(project => !isInstalled(project))
    if (!projects.length) return
    batchRunning.current = true
    setBatchInstalling(true)
    const generation = batchGeneration.current
    try {
      for (const project of projects) {
        if (generation !== batchGeneration.current) break
        if (await handleDownload(project)) {
          setSelectedProjects(current => {
            const next = { ...current }
            delete next[contentProjectKey(project)]
            return next
          })
        }
      }
    } finally {
      batchRunning.current = false
      setBatchInstalling(false)
    }
  }
  const selectable = results.filter(project => !isInstalled(project))
  const allSelected = selectable.length > 0 && selectable.every(project => selectedProjects[contentProjectKey(project)])

  const handleUpload = useCallback(async (file: File) => {
    if (!contentDir) return
    try {
      if (datapacks) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(",")[1])
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        const result = await window.electronAPI?.mcServerDatapacksInstall(server.id, file.name, { base64 })
        if (!result?.success) throw new Error(result?.error || t("worlds.errors.datapackInstall"))
        await loadInstalled()
        return
      }
      const arrayBuffer = await file.arrayBuffer()
      const content = new TextDecoder("latin1").decode(arrayBuffer)
      await window.electronAPI?.mcServerFsWrite(server.id, `${contentDir}/${file.name}`, content)
      await loadInstalled()
    } catch (error) { reportError(error) }
  }, [contentDir, server.id, loadInstalled, datapacks])

  const openDetails = useCallback(async (project: ModSearchResult) => {
    setModalTab("changelog")
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
      <div data-ui="server-addons-tab-div-1" data-component="addons-tab" className={`flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card px-4 text-center ${CONTENT_ENTER_DELAYED}`}>
        <div data-ui="server-addons-tab-div-2" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
          <IconPlug className="w-10 h-10" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div data-ui="server-addons-tab-div-3">
          <p data-ui="server-addons-tab-p-1" className="font-medium text-foreground">{t("servers.addons.noAddons")}</p>
          <p data-ui="server-addons-tab-p-2" className="text-sm text-muted-foreground mt-1">
            {t("servers.addons.noAddonsDesc")}
          </p>
        </div>
      </div>
    )
  }

  const emptyStateText = datapacks ? t("servers.datapacks.find") : contentType === "plugin" ? t("servers.addons.findPlugins") : t("servers.addons.findMods")
  const notFoundText = datapacks ? t("servers.datapacks.notFound") : contentType === "plugin" ? t("servers.addons.pluginsNotFound") : t("servers.addons.modsNotFound")
  const searchTitle = datapacks ? t("servers.datapacks.title") : contentType === "plugin" ? t("servers.addons.plugins") : t("servers.addons.mods")

  return (
    <div data-ui="server-addons-tab-div-4" data-component="addons-tab" className="flex-1 min-h-0 flex flex-col gap-2">
      {/* Toolbar */}
      <div data-ui="server-addons-tab-div-5" className={`flex items-center justify-between gap-3 flex-wrap ${CONTENT_ENTER_DELAYED}`}>
        <div data-ui="server-addons-tab-div-6" className="relative flex-1 min-w-[240px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input data-ui="server-addons-tab-input-1"
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder={emptyStateText}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div data-ui="server-addons-tab-div-7" className="flex items-center gap-2">
          <Select value={source} onValueChange={v => { setSource(v as SearchSource); setPage(1) }}>
            {/* Ширина по содержимому: значок + «Обе платформы» должны влезать целиком */}
            <SelectTrigger className="w-auto min-w-[150px] h-8 text-xs rounded-xl bg-muted/50 border border-border text-foreground">
              {/* Значок подставляет сам SelectValue из выбранного пункта — второй не нужен */}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Порядок пунктов: Modrinth → CurseForge → обе платформы (и Modrinth по умолчанию). */}
              <SelectItem value="modrinth">
                <span data-ui="server-addons-tab-span-1" className="flex items-center gap-1.5"><SourceMark source="modrinth" />Modrinth</span>
              </SelectItem>
              <SelectItem value="curseforge">
                <span data-ui="server-addons-tab-span-2" className="flex items-center gap-1.5"><SourceMark source="curseforge" />CurseForge</span>
              </SelectItem>
              <SelectItem value="both">
                <span data-ui="server-addons-tab-span-3" className="flex items-center gap-1.5">
                  <SourceMark source="modrinth" />
                  <SourceMark source="curseforge" />
                  {t("servers.addons.bothPlatforms")}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={v => { setSortBy(v as ModSort); setPage(1) }}>
            <SelectTrigger className="w-auto min-w-[165px] h-8 text-xs rounded-xl bg-muted/50 border border-border text-foreground">
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
          <button data-ui="server-addons-tab-button-1"
            type="button"
            onClick={() => fileInputRef?.click()}
            disabled={batchInstalling || installingSlug !== null}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          >
            <IconUpload className="w-4 h-4" strokeWidth={1.75} />
            {t(datapacks ? "servers.datapacks.upload" : "servers.addons.uploadJar")}
          </button>
          <input data-ui="server-addons-tab-input-2"
            ref={setFileInputRef}
            type="file"
            accept={datapacks ? ".zip" : ".jar,.zip"}
            multiple
            className="hidden"
            onChange={async e => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ""
              for (const file of files) await handleUpload(file)
            }}
          />
        </div>
      </div>

      {/* Main content */}
      <div data-ui="server-addons-tab-div-8" className="flex-1 min-h-0 flex flex-col rounded-2xl border border-border bg-card/40 p-4">
        <div data-ui="server-addons-tab-div-9" className="flex items-center justify-between shrink-0">
          <h3 data-ui="server-addons-tab-h3-1" className="text-sm font-medium text-muted-foreground">{searchTitle}</h3>
          {!loading && results.length > 0 && (
            <span data-ui="server-addons-tab-span-4" className="text-xs text-muted-foreground">{formatDownloads(totalHits)} {t("servers.addons.results")}</span>
          )}
        </div>

        <div data-ui="server-addons-tab-div-10" className={`flex-1 min-h-0 overflow-y-auto pr-1 mt-2 ${contentEnter ?? ""}`}>
          {results.length > 0 ? (
            <div data-ui="server-addons-tab-div-11" className="grid gap-2 pb-2">
              {deferredResults.map(project => (
                <AddonRow
                  key={project.id}
                  project={project}
                  installed={isInstalled(project)}
                  selected={Boolean(selectedProjects[contentProjectKey(project)])}
                  selectionDisabled={batchInstalling || installingSlug !== null}
                  onSelectionChange={checked => setSelectedProjects(current => {
                    const next = { ...current }
                    if (checked) next[contentProjectKey(project)] = project
                    else delete next[contentProjectKey(project)]
                    return next
                  })}
                  installDisabled={batchInstalling || installingSlug !== null}
                  installing={installingSlug === contentProjectKey(project)}
                  installLabel={t("servers.installModpack")}
                  projectKind={datapacks ? "datapack" : contentType === "plugin" ? "plugin" : "mod"}
                  onDetails={() => openDetails(project)}
                  onCancelDownload={datapacks ? cancelAttempt : undefined}
                  onInstall={() => handleDownload(project)}
                />
              ))}
            </div>
          ) : loading ? (
            <Spinner />
          ) : (search || selectedCategories.length > 0) ? (
            <EmptyState title={notFoundText} className="h-full rounded-none border-0 bg-transparent" />
          ) : (
            <EmptyState
              title={t("servers.addons.startSearch")}
              icon={IconSearch}
              className="h-full rounded-none border-0 bg-transparent"
            />
          )}
        </div>
        {(Object.keys(selectedProjects).length > 0 || batchInstalling) && (
          <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={allSelected} disabled={batchInstalling || installingSlug !== null} onCheckedChange={checked => setSelectedProjects(current => {
                const next = { ...current }
                for (const project of selectable) {
                  if (checked === true) next[contentProjectKey(project)] = project
                  else delete next[contentProjectKey(project)]
                }
                return next
              })} />{t("addon.batch.selectAll")}
            </label>
            <span className="text-xs text-muted-foreground">{t("addon.batch.selected", { count: Object.keys(selectedProjects).length })}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={batchInstalling} onClick={() => setSelectedProjects({})} className="rounded-lg bg-muted px-3 py-2 text-xs disabled:opacity-50">{t("addon.batch.clear")}</button>
              {batchInstalling ? <button type="button" onClick={() => { batchGeneration.current++; if (datapacks) cancelAttempt() }} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs"><IconX className="size-4 text-primary" />{t("common.cancel")}</button>
                : <button type="button" disabled={installingSlug !== null} onClick={() => void installSelected()} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><IconDownload className="size-4" />{t("addon.batch.install")}</button>}
            </div>
          </div>
        )}
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
        projectKind={datapacks ? "datapack" : contentType === "plugin" ? "plugin" : "mod"}
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
            if (!compatible(ver)) return false
            await installFile(ver.fileName || `${selectedDetails.slug || selectedDetails.name}.${datapacks ? "zip" : "jar"}`, downloadUrl)
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
