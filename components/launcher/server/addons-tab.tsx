import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react"
import { useTranslation } from "react-i18next"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import {
  IconSearch, IconUpload, IconInfoCircle,
  IconCheck, IconDownload, IconLoader2, IconPlug, IconList,
  IconChevronDown, IconChevronRight, IconX, IconFileText, IconPhoto,
  IconHistory, IconRefresh, IconTrash,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "../instance/spinner"
import { Pagination } from "../instance/pagination"
import { formatDownloads } from "../instance/utils"
import { SORT_LABELS, SORT_OPTIONS_BY_SOURCE } from "../instance/sort-options"
import { dataCache, MOD_SEARCH_CACHE_TTL } from "@/lib/swr"
import type { McServerInfo, McFsEntry } from "@xnlc/types"
import type { ModSearchResult, ModSort, ModVersion, ModDetails, ModContentType } from "@xnlc/types"
import type { ModCategory } from "@xnlc/types"
import type { SearchSource } from "../instance/types"

const MODS_PER_PAGE = 20
type ModalTab = "description" | "gallery" | "changelog" | "versions"

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-foreground mt-6 mb-3 pb-2 border-b border-border">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold text-foreground mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-foreground mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p className="text-muted-foreground mb-3 leading-relaxed">{children}</p>,
  li: ({ children }) => <li className="text-muted-foreground ml-4 mb-1">{children}</li>,
  ul: ({ children }) => <ul className="list-disc mb-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal mb-4 space-y-1">{children}</ol>,
  code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4">{children}</pre>,
  a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-primary/50 pl-4 my-4 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr className="border-border my-6" />,
  img: ({ src, alt }) => <img src={src} alt={alt || ""} className="rounded-lg max-w-full my-4" />,
}

const MODLOADER_MODS = ["forge", "fabric", "quilt", "neoforge"]
const MODLOADER_PLUGINS = ["paper", "spigot", "bukkit", "purpur", "folia", "sponge", "bungeecord", "velocity", "waterfall"]

function getContentType(modloader: string): ModContentType | null {
  if (MODLOADER_MODS.includes(modloader)) return "mod"
  if (MODLOADER_PLUGINS.includes(modloader)) return "plugin"
  return null
}

function getContentDir(modloader: string): string {
  if (MODLOADER_MODS.includes(modloader)) return "mods"
  if (MODLOADER_PLUGINS.includes(modloader)) return "plugins"
  return ""
}

function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

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
  const [source, setSource] = useState<SearchSource>("both")
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
  const [selectedCategories, setSelectedCategories] = useState<{ name: string; source?: "modrinth" | "curseforge" }[]>([])
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [draftCats, setDraftCats] = useState<{ name: string; source?: "modrinth" | "curseforge" }[]>([])
  const [collapsedSourceGroups, setCollapsedSourceGroups] = useState<Set<string>>(() => new Set())
  const [removingSlug, setRemovingSlug] = useState<string | null>(null)
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null)

  const searchVersionRef = useRef(0)

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
    setInstallingSlug(project.slug)
    setUpdatingSlug(project.slug)

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
      setUpdatingSlug(null)
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

  const handleRemove = useCallback(async (file: McFsEntry) => {
    if (!contentDir) return
    setRemovingSlug(file.name)
    try {
      await window.electronAPI?.mcServerFsDelete(server.id, `${contentDir}/${file.name}`)
      await loadInstalled()
    } catch (err) {
      console.error("Remove failed:", err)
    } finally {
      setRemovingSlug(null)
    }
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

  const label = contentType === "plugin" ? t("servers.addons.plugins") : t("servers.addons.mods")
  const emptyStateText = contentType === "plugin" ? t("servers.addons.findPlugins") : t("servers.addons.findMods")
  const notFoundText = contentType === "plugin" ? t("servers.addons.pluginsNotFound") : t("servers.addons.modsNotFound")
  const searchTitle = contentType === "plugin" ? t("servers.addons.plugins") : t("servers.addons.mods")

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[300px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder={emptyStateText}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={v => { setSource(v as SearchSource); setPage(1) }}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">{t("servers.addons.bothPlatforms")}</SelectItem>
              <SelectItem value="modrinth">Modrinth</SelectItem>
              <SelectItem value="curseforge">CurseForge</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={v => { setSortBy(v as ModSort); setPage(1) }}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS_BY_SOURCE[source].map(id => (
                <SelectItem key={id} value={id}>{SORT_LABELS[id]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={catDialogOpen} onOpenChange={(open) => {
            if (open) setDraftCats(selectedCategories ?? [])
            setCatDialogOpen(open)
          }}>
            <DialogTrigger asChild>
              <button
                type="button"
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  (selectedCategories?.length ?? 0) > 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >
                <IconList className="w-4 h-4" strokeWidth={1.75} />
                {(selectedCategories?.length ?? 0) > 0 ? t("servers.addons.categoriesCount", { count: selectedCategories!.length }) : t("servers.addons.categories")}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>{t("servers.addons.categoriesTitle")}</DialogTitle>
                <DialogDescription>{t("servers.addons.categoriesDesc")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-1">
                {(() => {
                  type ContentCategory = ModCategory & { source?: "modrinth" | "curseforge" }
                  const filteredCategories = (categories ?? []).filter(c => c.projectType === contentType || (contentType === "plugin" && c.projectType === "mod")) as ContentCategory[]
                  if (filteredCategories.length === 0) {
                    return <p className="text-xs text-muted-foreground py-2">{t("servers.addons.noCategories")}</p>
                  }
                  const groups = new Map<string, ContentCategory[]>()
                  for (const cat of filteredCategories) {
                    const key = cat.source ?? "both"
                    const list = groups.get(key)
                    if (list) list.push(cat)
                    else groups.set(key, [cat])
                  }
                  const groupLabels: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge", both: t("servers.addons.bothPlatforms") }
                  return [...groups.entries()].map(([key, cats]) => {
                    const collapsed = collapsedSourceGroups.has(key)
                    return (
                      <div key={key} className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => setCollapsedSourceGroups(prev => {
                            const next = new Set(prev)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })}
                          className="flex w-full items-center gap-2 px-2 py-2 rounded-xl bg-muted/60 border border-border/70 hover:bg-muted/90 text-xs font-semibold text-foreground transition-colors"
                        >
                          {collapsed
                            ? <IconChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            : <IconChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                          <span className="min-w-0 flex-1 text-left truncate">{groupLabels[key] ?? key}</span>
                          <span className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">{cats.length}</span>
                        </button>
                        {!collapsed && cats.map((cat) => {
                          const checked = draftCats.some(c => c.name === cat.name)
                          const hasSvg = cat.icon && cat.icon.trimStart().startsWith("<svg")
                          const hasImg = cat.icon && !hasSvg && cat.icon.startsWith("http")
                          return (
                            <label
                              key={`${key}:${cat.name}`}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  if (v) setDraftCats((prev) => [...prev, { name: cat.name, source: cat.source }])
                                  else setDraftCats((prev) => prev.filter((c) => c.name !== cat.name))
                                }}
                              />
                              {hasSvg && (
                                <span
                                  className="w-4 h-4 shrink-0 text-muted-foreground [&_svg]:w-full [&_svg]:h-full"
                                  dangerouslySetInnerHTML={{ __html: cat.icon }}
                                />
                              )}
                              {hasImg && (
                                <img
                                  src={cat.icon}
                                  alt=""
                                  className="w-4 h-4 shrink-0 rounded-sm object-contain"
                                />
                              )}
                              <span className="flex-1">{cat.name}</span>
                              {cat.header !== "categories" && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{cat.header}</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    )
                  })
                })()}
              </div>
              {(draftCats.length > 0) && (
                <button
                  type="button"
                  onClick={() => setDraftCats([])}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
                >
                  {t("servers.addons.resetAll")}
                </button>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setCatDialogOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("servers.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategories(draftCats)
                    setPage(1)
                    setCatDialogOpen(false)
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("servers.addons.find")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
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
              {deferredResults.map(project => {
                const installed = isInstalled(project)
                return (
                <div key={project.id} className="group flex items-center gap-3.5 rounded-xl border border-border bg-card px-3.5 py-2.5 transition-colors hover:border-primary/50">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-muted flex-shrink-0">
                    {project.iconUrl ? (
                      <img src={project.iconUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-muted-foreground">{project.name[0]}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{project.name}</p>
                      {project.source === "modrinth" ? (
                        <svg className="h-3.5 w-3.5 shrink-0 text-[#1bd96a]" viewBox="0 0 24 24" fill="currentColor"><path d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73 11 10.999 0 0 0-2.17 3.11 11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02.2-.04.22.1-.26-1.7l-.36-1.37-1.01-.06a8.5 8.489 0 0 1-5.18-1.8 5.34 5.34 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97 2.07-.43 2.06-.43 1.47-1.47c.8-.8 1.48-1.5 1.48-1.52 0-.09-.42-1.63-.46-1.7-.04-.06-.2-.03-1.02.18-.53.13-1.2.3-1.45.4l-.48.15-.53.53-.53.53-.93.1-.93.07-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6.43-.57c.68-.9.68-.9 1.46-1.1.4-.1.65-.2.83-.33.13-.099.65-.579 1.14-1.069l.9-.9-.7-.7-.7-.7-1.95.54c-1.07.3-1.96.53-1.97.53-.03 0-2.23 2.48-2.63 2.97l-.29.35.28 1.03c.16.56.3 1.16.31 1.34l.03.3-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1-.08-.1-.23-.6-.32-1.03-.18-.86-.17-2.75.02-3.73a8.84 8.839 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1.06-.17.5-2.999.47-3.039-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38-.06.23-.46 2.42-.46 2.52 0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2 8.38 8.379 0 0 1 2.16 3.449 6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.37 9.369 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38-.38.32-1.54 1.1-1.7 1.14-.1.03-.1.06-.07.26.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/></svg>
                      ) : (
                        <svg className="h-3.5 w-3.5 shrink-0 text-[#f16436]" viewBox="0 0 24 24" fill="currentColor"><path d="M18.326 9.2145S23.2261 8.4418 24 6.1882h-7.5066V4.4H0l2.0318 2.3576V9.173s5.1267-.2665 7.1098 1.2372c2.7146 2.516-3.053 5.917-3.053 5.917L5.0995 19.6c1.5465-1.4726 4.494-3.3775 9.8983-3.2857-2.0565.65-4.1245 1.6651-5.7344 3.2857h10.9248l-1.0288-3.2726s-7.918-4.6688-.8336-7.1127z"/></svg>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{formatDownloads(project.downloadCount)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                        {project.source}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openDetails(project)}
                      className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80"
                    >
                      <IconInfoCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {t("builds.details")}
                    </button>
                    {installed ? (
                      <span className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary">
                        <IconCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {t("builds.installed")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={installingSlug === project.slug}
                        onClick={() => handleDownload(project)}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {installingSlug === project.slug
                          ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                          : <IconDownload className="h-3.5 w-3.5" strokeWidth={1.75} />}
                        {t("servers.installModpack")}
                      </button>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          ) : loading ? (
            <Spinner />
          ) : (search || (selectedCategories?.length ?? 0) > 0) ? (
            <div className="flex h-full flex-col items-center justify-center">
              <IconSearch className="mb-2 h-6 w-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{notFoundText}</p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
              <IconSearch className="mb-2 h-6 w-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("servers.addons.startSearch")}</p>
            </div>
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
      {selectedDetails && (() => {
        const body = selectedDetails.body
        const gallery = selectedDetails.gallery
        return (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => { setSelectedDetails(null); setDetailVersions([]) }}
        >
          <div
            className="w-full max-w-5xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-border flex-shrink-0">
              <div className="flex items-start gap-4">
                {selectedDetails.iconUrl ? (
                  <img src={selectedDetails.iconUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl font-bold">{selectedDetails.name[0]}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-foreground">{selectedDetails.name}</h2>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{selectedDetails.summary}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-muted-foreground">{formatDownloads(selectedDetails.downloadCount)} {t("servers.addons.downloads")}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{selectedDetails.source}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelectedDetails(null); setDetailVersions([]) }}
                      className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <IconX className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border px-2 flex-shrink-0">
              {([
                { id: "description" as ModalTab, icon: IconFileText },
                { id: "gallery" as ModalTab, icon: IconPhoto },
                { id: "changelog" as ModalTab, icon: IconHistory },
                { id: "versions" as ModalTab, icon: IconDownload },
              ]).map(({ id, icon: TabIcon }) => (
                <button
                  key={id}
                  onClick={() => setModalTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors relative capitalize rounded-t-lg",
                    modalTab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <TabIcon className="w-4 h-4" strokeWidth={1.75} />
                  {id}
                  {modalTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-12">
                  <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {modalTab === "description" && (
                    <div>
                      {body ? (
                        <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{body}</ReactMarkdown>
                      ) : (
                        <p className="text-muted-foreground">{selectedDetails.summary}</p>
                      )}
                    </div>
                  )}

                  {modalTab === "gallery" && (
                    <div className="grid grid-cols-2 gap-4">
                      {gallery && gallery.length > 0 ? (
                        gallery.map((img, i) => (
                          <img key={i} src={img.url} alt={img.title || ""} className="rounded-xl w-full hover:scale-[1.02] transition-transform" />
                        ))
                      ) : (
                        <p className="col-span-2 text-center text-muted-foreground py-12">{t("servers.addons.noScreenshots")}</p>
                      )}
                    </div>
                  )}

                  {modalTab === "changelog" && (
                    <div className="space-y-4">
                      {detailVersions.length > 0 ? (
                        detailVersions.slice(0, 5).map(ver => (
                          <div key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-foreground">{ver.name}</h4>
                              <span className="text-xs text-muted-foreground">{ver.datePublished ? new Date(ver.datePublished).toLocaleDateString() : ""}</span>
                            </div>
                            {ver.changelog ? (
                              <div className="text-sm text-muted-foreground">
                                <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{ver.changelog}</ReactMarkdown>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">{t("servers.addons.noChangelog")}</p>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-center text-muted-foreground py-12">{t("servers.addons.noChangelog")}</p>
                      )}
                    </div>
                  )}

                  {modalTab === "versions" && (
                    <div className="space-y-2">
                      {detailVersions.length > 0 ? (
                        detailVersions.slice(0, 50).map(ver => {
                          const compatible = ver.gameVersion.includes(server.gameVersion)
                          return (
                          <div key={ver.id} className={cn(
                            "p-4 rounded-xl border flex items-center justify-between transition-colors",
                            compatible
                              ? "bg-muted/20 border-border hover:bg-muted/30"
                              : "bg-muted/10 border-border/50 opacity-60"
                          )}>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-foreground">{ver.name}</p>
                                {ver.versionType && (
                                  <span className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                    ver.versionType === "release" ? "bg-green-500/10 text-green-500"
                                      : ver.versionType === "beta" ? "bg-yellow-500/10 text-yellow-500"
                                        : "bg-red-500/10 text-red-500"
                                  )}>
                                    {ver.versionType}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-muted-foreground">{ver.gameVersion}</span>
                                {ver.loaders && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                    {Array.isArray(ver.loaders) ? ver.loaders.join(", ") : ""}
                                  </span>
                                )}
                                {ver.datePublished && (
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(ver.datePublished).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            {ver.downloadUrl && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!contentDir) return
                                  setInstallingSlug(selectedDetails.slug)
                                  await window.electronAPI?.mcServerFsDownload(
                                    server.id, contentDir, ver.downloadUrl!, ver.fileName || `${selectedDetails.name}.jar`,
                                  )
                                  await loadInstalled()
                                  setInstallingSlug(null)
                                  setSelectedDetails(null)
                                }}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0 ml-3"
                              >
                                <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                                {t("servers.addons.download")}
                              </button>
                            )}
                          </div>
                          )
                        })
                      ) : (
                        <p className="text-center text-muted-foreground py-12">{t("servers.addons.noVersions")}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
