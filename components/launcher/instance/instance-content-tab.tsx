import { memo, useEffect, useMemo, useRef, useState, useDeferredValue, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { EmptyState } from "@/components/ui/empty-state"
import { IconSearch, IconUpload, IconTrash, IconRefresh, IconList, IconPower, IconCheck, IconChevronDown, IconChevronRight, IconDownload, IconArrowRight, IconX, IconArrowUpCircle, IconLock, IconAlertTriangle, IconPuzzle, IconPhoto, IconSparkles } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "./spinner"
import { ModalLayer } from "@/components/ui/modal-layer"
import { Pagination } from "./pagination"
import { contentProjectKey, formatDownloads, isInstalledVersion, matchesBuildVersion } from "./utils"
import { InstanceUpdatesDialog } from "./instance-updates-dialog"
import { LoaderIcon } from "./loader-icon"
import { ChangelogContent } from "./changelog-content"
import { AddonRow } from "@/components/launcher/addon-row"
import { ProviderIcon } from "@/components/launcher/provider-icon"
import { SourceMark } from "@/components/launcher/source-mark"
import type { Build, BuildMod, ModSearchResult, ModSort, SearchSource, ModVersion } from "./types"
import type { ContentDropKind, ContentDropRejectReason, ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./use-mod-search"
import { getSortLabels, SORT_OPTIONS_BY_SOURCE } from "./sort-options"

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
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td className="px-4 py-2.5 align-top text-muted-foreground">{children}</td>,
}

function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

interface InstanceContentTabProps {
  activeBuild: Build
  title: string
  placeholder: string
  uploadLabel: string
  type: "mods" | "resourcepacks" | "shaders"
  modSearch: string
  setModSearch: (value: string) => void
  modSource: SearchSource
  setModSource: (value: SearchSource) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modCategories?: SelectedModCategory[]
  setModCategories?: (value: SelectedModCategory[]) => void
  categories?: ModCategory[]
  modTotalPages?: number
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  onUploadFile: (file: File) => void
  modLoading: boolean
  modTotalHits: number
  modPage: number
  setModPage: (page: number) => void
  displayResults: ModSearchResult[]
  isInstalledFn?: (project: ModSearchResult) => boolean
  openProjectModal: (item: ModSearchResult) => void
  installingModSlug: string | null
  setInstallingModSlug: (slug: string | null) => void
  addModToBuild: (buildId: string, mod: ModSearchResult) => void
  addContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", mod: ModSearchResult) => void | Promise<void>
  installContentToBuild: (mod: ModSearchResult, type: "resourcepacks" | "shaders", onPhase?: (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => void) => void | Promise<void>
  removeContentFromBuild: (buildId: string, type: "mods" | "resourcepacks" | "shaders", item: Build["mods"][number]) => Promise<boolean>
  installModToBuild: (mod: ModSearchResult, onPhase?: (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => void) => void | Promise<void>
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  toggleItemEnabled: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string) => void | Promise<boolean>
  updateItemVersion: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string, newVersion: ModVersion) => Promise<boolean>
}

export const InstanceContentTab = memo(function InstanceContentTab({
  activeBuild,
  title,
  placeholder,
  uploadLabel,
  type,
  modSearch,
  setModSearch,
  modSource,
  setModSource,
  modSortBy,
  setModSortBy,
  modCategories,
  setModCategories,
  categories,
  modFileInputRef,
  onUploadFile,
  modLoading,
  modTotalHits,
  modTotalPages,
  modPage,
  setModPage,
  displayResults,
  isInstalledFn,
  openProjectModal,
  installingModSlug,
  setInstallingModSlug,
  addModToBuild,
  addContentToBuild,
  installContentToBuild,
  removeContentFromBuild,
  installModToBuild,
  setBuilds,
  toggleItemEnabled,
  updateItemVersion,
}: InstanceContentTabProps) {
  const { t } = useTranslation()
  const { pushNotification } = useActivityCenter()
  const installedItems = type === "mods" ? activeBuild.mods : type === "resourcepacks" ? activeBuild.resourcepacks : activeBuild.shaders
  const emptyStateText = type === "mods" ? t("builds.findMods") : type === "resourcepacks" ? t("builds.findResourcePacks") : t("builds.findShaders")
  /** Иконка типа контента — та же, что у вкладки: моды/ресурспаки/шейдеры. */
  const typeIcon = type === "mods" ? IconPuzzle : type === "resourcepacks" ? IconPhoto : IconSparkles
  const notFoundText = type === "mods" ? t("builds.noModsFound") : type === "resourcepacks" ? t("builds.noResourcePacksFound") : t("builds.noShadersFound")
  const deferredResults = useDeferredValue(displayResults)

  const [removingSlug, setRemovingSlug] = useState<string | null>(null)
  const [installedSearch, setInstalledSearch] = useState("")

  // Перетаскивание файлов прямо в панель «Встановлено»: файл кладём в сборку как
  // есть — без проверок зависимостей и без запросов к API. Единственное, что
  // читаем, — метаданные архива (имя, версия, автор), они нужны для списка.
  const dragDepthRef = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [rejectedEntries, setRejectedEntries] = useState<Array<{ name: string; reason: ContentDropRejectReason }>>([])
  const contentKind: ContentDropKind = type === "mods" ? "mod" : type === "resourcepacks" ? "resourcepack" : "shader"

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Счётчик нужен, чтобы подсветка не мигала при проходе курсора по дочерним
    // узлам, но если курсор реально ушёл за пределы панели — снимаем сразу.
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    dragDepthRef.current = 0
    setDragActive(false)
  }, [])

  // Бросок мимо панели или за пределы окна: подсветка не должна залипать.
  useEffect(() => {
    if (!dragActive) return
    const reset = () => {
      dragDepthRef.current = 0
      setDragActive(false)
    }
    window.addEventListener("dragend", reset)
    window.addEventListener("drop", reset)
    return () => {
      window.removeEventListener("dragend", reset)
      window.removeEventListener("drop", reset)
    }
  }, [dragActive])

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)

    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return

    // Папку от файла отличает только main, поэтому расклад «подходит / не
    // подходит» спрашиваем у него, а не гадаем по расширению в рендерере.
    const entries = files.map(file => ({ file, path: window.electronAPI?.getFilePath(file) ?? "" }))
    const paths = entries.map(entry => entry.path).filter(Boolean)
    const classification = paths.length > 0
      ? await window.electronAPI?.classifyDropPaths(paths, contentKind)
      : null

    if (!classification) {
      // Разобрать не удалось — просто кладём файлы, как раньше.
      for (const entry of entries) await Promise.resolve(onUploadFile(entry.file))
      return
    }

    if (classification.rejected.length > 0) {
      setRejectedEntries(classification.rejected.map(entry => ({ name: entry.name, reason: entry.reason })))
      pushNotification({
        kind: "error",
        source: "install",
        title: t("builds.dropUnsupported"),
        message: classification.rejected.map(entry => entry.name).join(", "),
      })
    }

    const acceptedPaths = new Set(classification.accepted.map(entry => entry.path))
    for (const entry of entries) {
      if (!acceptedPaths.has(entry.path)) continue
      await Promise.resolve(onUploadFile(entry.file))
    }
  }, [contentKind, onUploadFile, pushNotification, t])
  const deferredInstalledSearch = useDeferredValue(installedSearch)
  const filteredInstalled = useMemo(() => {
    const q = deferredInstalledSearch.trim().toLowerCase()
    if (!q) return installedItems
    return installedItems.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.author ?? "").toLowerCase().includes(q) ||
      (i.slug ?? "").toLowerCase().includes(q)
    )
  }, [installedItems, deferredInstalledSearch])
  const [versionPickerItem, setVersionPickerItem] = useState<BuildMod | null>(null)
  const [versionPickerVersions, setVersionPickerVersions] = useState<ModVersion[]>([])
  const [versionPickerLoading, setVersionPickerLoading] = useState(false)
  const [selectedPickerVersion, setSelectedPickerVersion] = useState<ModVersion | null>(null)
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null)
  const [cfChangelogs, setCfChangelogs] = useState<Record<string, string>>({})
  const [loadingPickerChangelog, setLoadingPickerChangelog] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ fileName: string; current: number; total: number } | null>(null)
  // Этап установки: до байтов идёт сетевой этап (версии, зависимости) — его показываем словами.
  const [installPhase, setInstallPhase] = useState<"resolving" | "confirm" | "downloading" | "deps" | null>(null)
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [draftCats, setDraftCats] = useState<SelectedModCategory[]>([])
  const contentType = type === "mods" ? "mod" : type === "resourcepacks" ? "resourcepack" : "shader"
  type ContentCategory = ModCategory & { source?: "modrinth" | "curseforge" }
  const filteredCategories = useMemo(() => (categories ?? []).filter(c => c.projectType === contentType) as ContentCategory[], [categories, contentType])
  const [collapsedSourceGroups, setCollapsedSourceGroups] = useState<Set<string>>(() => new Set())
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [updatesCount, setUpdatesCount] = useState(0)
  const [loaderRequirementReport, setLoaderRequirementReport] = useState<BuildLoaderRequirementReport | null>(null)
  const [loaderWarningDismissed, setLoaderWarningDismissed] = useState(false)

  // Требование мода к версии загрузчика есть только внутри JAR, поэтому оно
  // читается из файлов сборки и сравнивается с выбранной версией загрузчика.
  useEffect(() => {
    if (type !== "mods" || !activeBuild.name || !activeBuild.loaderVersion) {
      setLoaderRequirementReport(null)
      return
    }
    setLoaderWarningDismissed(false)
    let cancelled = false
    window.electronAPI
      ?.checkBuildLoaderRequirements(activeBuild.name, activeBuild.modLoader, activeBuild.loaderVersion)
      .then(report => { if (!cancelled) setLoaderRequirementReport(report) })
      .catch(() => { if (!cancelled) setLoaderRequirementReport(null) })
    return () => { cancelled = true }
  }, [type, activeBuild.name, activeBuild.modLoader, activeBuild.loaderVersion, activeBuild.mods.length])

  const loaderIssues = useMemo(
    () => (loaderRequirementReport?.issues ?? []).filter(issue => !issue.satisfied),
    [loaderRequirementReport],
  )

  const refreshUpdatesCount = useCallback(async () => {
    try {
      const cache = await window.electronAPI?.getContentUpdatesCache()
      const entry = cache?.[activeBuild.id]
      const count = entry?.updates.filter((u) => u.contentType === type).length ?? 0
      setUpdatesCount(count)
    } catch {
      // ignore
    }
  }, [activeBuild.id, type])

  const isLocked = Boolean(
    (activeBuild.source === "modrinth" || activeBuild.source === "curseforge") &&
    activeBuild.locked !== false
  )

  useEffect(() => {
    void refreshUpdatesCount()
    const handler = () => void refreshUpdatesCount()
    window.addEventListener("content-updates-changed", handler)
    return () => window.removeEventListener("content-updates-changed", handler)
  }, [refreshUpdatesCount])

  // CurseForge не отдаёт changelog вместе со списком файлов — подтягиваем его
  // отдельным запросом для раскрытой версии в диалоге обновления.
  useEffect(() => {
    const item = versionPickerItem
    if (!item || item.source !== "curseforge" || !item.modId) return
    const ver = selectedPickerVersion
    if (!ver) return
    if (ver.changelog || cfChangelogs[ver.id]) return

    const fileId = Number(ver.id)
    if (!fileId || isNaN(fileId)) return

    let cancelled = false
    setLoadingPickerChangelog(true)
    void window.electronAPI?.modsCurseforgeChangelog(item.modId, fileId)
      .then((text) => {
        if (cancelled) return
        setCfChangelogs(prev => ({ ...prev, [ver.id]: text || "" }))
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoadingPickerChangelog(false) })

    return () => { cancelled = true }
  }, [versionPickerItem, selectedPickerVersion, cfChangelogs])

  useEffect(() => {
    const off = window.electronAPI?.onContentDownloadProgress?.((progress) => {
      setDownloadProgress(progress)
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    if (updatingSlug === null && installingModSlug === null) setDownloadProgress(null)
  }, [updatingSlug, installingModSlug])

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      {isLocked && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-500/90">
          <IconLock className="w-4 h-4 shrink-0" />
          <span>{t("buildDetail.lockedBanner")}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[300px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={modSearch}
            onChange={e => setModSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={modSource} onValueChange={(v) => setModSource(v as SearchSource)}>
            {/* Ширина по содержимому: значок + «Обе платформы» должны влезать целиком */}
            <SelectTrigger className="w-auto min-w-[150px] h-8 text-xs">
              {/* Значок подставляет сам SelectValue из выбранного пункта — второй не нужен */}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">
                <span className="flex items-center gap-1.5">
                  <SourceMark source="modrinth" />
                  <SourceMark source="curseforge" />
                  {t("servers.addons.bothPlatforms")}
                </span>
              </SelectItem>
              <SelectItem value="modrinth">
                <span className="flex items-center gap-1.5"><SourceMark source="modrinth" />Modrinth</span>
              </SelectItem>
              <SelectItem value="curseforge">
                <span className="flex items-center gap-1.5"><SourceMark source="curseforge" />CurseForge</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={modSortBy} onValueChange={(v) => setModSortBy(v as ModSort)}>
            <SelectTrigger className="w-auto min-w-[165px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS_BY_SOURCE[modSource].map((id) => (
                <SelectItem key={id} value={id}>{getSortLabels(t)[id]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={catDialogOpen} onOpenChange={(open) => {
            if (open) setDraftCats(modCategories ?? [])
            setCatDialogOpen(open)
          }}>
            <DialogTrigger asChild>
              <button
                type="button"
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  (modCategories?.length ?? 0) > 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >
                <IconList className="w-4 h-4" strokeWidth={1.75} />
                {(modCategories?.length ?? 0) > 0 ? t("servers.addons.categoriesCount", { count: modCategories!.length }) : t("servers.addons.categories")}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>{t("servers.addons.categoriesTitle")}</DialogTitle>
                <DialogDescription>{t("servers.addons.categoriesDesc")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-1">
                {filteredCategories.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">{t("servers.addons.noCategories")}</p>
                )}
                {(() => {
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
                          {key === "both" ? (
                            <span className="inline-flex items-center gap-1">
                              <ProviderIcon source="modrinth" />
                              <ProviderIcon source="curseforge" />
                            </span>
                          ) : (
                            <ProviderIcon source={key} />
                          )}
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
                  {t("buildDetail.resetAll")}
                </button>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setCatDialogOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModCategories?.(draftCats)
                    setCatDialogOpen(false)
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("buildDetail.search.submit")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <button
            type="button"
            onClick={() => modFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          >
            <IconUpload className="w-4 h-4" strokeWidth={1.75} />
            {uploadLabel}
          </button>
          <input
            ref={modFileInputRef}
            type="file"
            accept=".jar,.zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) {
                onUploadFile(file)
                e.target.value = ""
              }
            }}
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-4">
        {loaderIssues.length > 0 && !loaderWarningDismissed && (
          <div className="shrink-0 rounded-2xl border border-[#FF6625]/40 bg-[#FF6625]/10 p-3">
            <div className="flex items-start gap-2">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6625]" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {t("builds.loaderVersionMismatch", {
                    total: loaderIssues.length,
                    loader: `${activeBuild.modLoader} ${activeBuild.loaderVersion}`,
                  })}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {loaderIssues.slice(0, 5).map(issue => (
                    <li key={issue.fileName} className="truncate text-xs text-muted-foreground">
                      <span className="text-foreground/90">{issue.modName || issue.fileName}</span>
                      {" — "}
                      {t("builds.loaderVersionRequired", { loader: issue.loaderId, requirement: issue.requirement })}
                    </li>
                  ))}
                  {loaderIssues.length > 5 && (
                    <li className="text-xs text-muted-foreground">
                      {t("builds.loaderVersionMore", { more: loaderIssues.length - 5 })}
                    </li>
                  )}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setLoaderWarningDismissed(true)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("servers.cancel")}
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3 min-h-0 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <div
            className={cn(
              "relative flex flex-col min-h-0 rounded-2xl border bg-card/50 p-4 transition-colors",
              dragActive ? "border-dashed border-primary bg-primary/5" : "border-border",
            )}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {dragActive && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-background/75 backdrop-blur-[1px]">
                <IconUpload className="mb-2 h-6 w-6 text-primary" strokeWidth={1.75} />
                <p className="text-sm font-medium text-foreground">{t("builds.dropToAdd")}</p>
              </div>
            )}
            <div className="mb-2 flex items-center justify-between gap-3 shrink-0">
              <h3 className="text-sm font-medium text-foreground">{t("builds.installed")}</h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setUpdatesOpen(true)}
                  className={cn(
                    "relative flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                    updatesCount > 0
                      ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={t("updates.checkTitle")}
                >
                  <IconArrowUpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("updates.title")}
                  {updatesCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">
                      {updatesCount}
                    </span>
                  )}
                </button>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {installedSearch.trim() ? `${filteredInstalled.length}/${installedItems.length}` : installedItems.length}
                </span>
              </div>
            </div>

            {installedItems.length > 0 && (
              <div className="relative mb-3 shrink-0">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={installedSearch}
                  onChange={e => setInstalledSearch(e.target.value)}
                  placeholder={t("builds.searchInstalled")}
                  className="w-full pl-10 pr-8 py-2 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                {installedSearch && (
                  <button
                    type="button"
                    onClick={() => setInstalledSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={t("servers.cancel")}
                  >
                    <IconX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
              {installedItems.length === 0 ? (
                <EmptyState
                  variant="empty"
                  icon={typeIcon}
                  title={emptyStateText}
                  className="min-h-[180px] rounded-2xl border border-dashed border-border"
                />
              ) : filteredInstalled.length === 0 ? (
                <EmptyState
                  compact
                  title={t("builds.searchInstalledNoMatch")}
                  className="min-h-[120px] rounded-2xl border border-dashed border-border"
                />
              ) : filteredInstalled.map((item) => {
                const isEnabled = item.enabled ?? true
                return (
                <div key={item.id} className={`rounded-xl border p-3 transition-opacity ${isEnabled ? 'border-border bg-muted/20' : 'border-border/50 bg-muted/10 opacity-55'}`}>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleItemEnabled(activeBuild.id, type, item.id)}
                      className={`mt-0.5 rounded-lg border p-2 transition-colors hover:bg-muted/80 ${isEnabled ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}
                      aria-label={isEnabled ? t("common.disable") : t("common.enable")}
                      title={isEnabled ? t("common.disable") : t("common.enable")}
                    >
                      <IconPower className={`h-4 w-4 ${isEnabled ? 'fill-primary/20' : ''}`} strokeWidth={1.75} />
                    </button>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background border border-border">
                      {item.icon_url ? (
                        <img src={item.icon_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">{item.name[0]}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium text-foreground break-words truncate">{item.name}</span>
                        {item.source && item.source !== "local" && (
                          <SourceMark source={item.source} className="shrink-0" />
                        )}
                      </div>
                      {item.author && (
                        <div className="mt-0.5 text-xs text-muted-foreground/70 truncate">{item.author}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPickerVersion(null)
                          setVersionPickerItem(item)
                          setVersionPickerVersions([])
                          setVersionPickerLoading(true)
                          const fetchPromise = item.source === "modrinth" && item.projectId
                            ? window.electronAPI?.modsModrinthVersions(item.projectId)
                            : item.source === "curseforge" && item.modId
                              ? window.electronAPI?.modsCurseforgeDetails(item.modId).then(r => r?.versions ?? [])
                              : Promise.resolve([])
                          void Promise.resolve(fetchPromise).then((versions) => {
                            const list = (versions ?? []) as ModVersion[]
                            // Для модов фильтруем по загрузчику сборки (fabric/neoforge/...)
                            // и версии Minecraft, чтобы не показывать несовместимые.
                            const requireLoader = type === "mods"
                            const compatible = list.filter(v => matchesBuildVersion(v, activeBuild, requireLoader))
                            const gameOnly = list.filter(v => matchesBuildVersion(v, activeBuild, false))
                            const shown = compatible.length > 0 ? compatible : (gameOnly.length > 0 ? gameOnly : list)
                            setVersionPickerVersions(shown)
                            setVersionPickerLoading(false)
                            // Раскрываем changelog установленной версии сразу.
                            const current = shown.find(v => v.name === item.version || v.id === item.version)
                            if (current) setSelectedPickerVersion(current)
                          })
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        aria-label={t("common.refresh")}
                        title={t("common.refresh")}
                      >
                        <IconRefresh className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        disabled={removingSlug === item.slug}
                        onClick={() => {
                          setRemovingSlug(item.slug)
                          void removeContentFromBuild(activeBuild.id, type, item).finally(() => setRemovingSlug(null))
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={t("common.delete")}
                        title={t("common.delete")}
                      >
                        <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
              {!modLoading && displayResults.length > 0 && (
                <span className="text-xs text-muted-foreground">{t("buildDetail.resultsCount", { count: formatDownloads(modTotalHits) })}</span>
              )}
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto pr-1 mt-2">
              {displayResults.length > 0 ? (
                <div className="grid min-w-0 gap-2 pb-2">
                  {deferredResults.map(project => {
                    const installed = isInstalledFn?.(project) ?? false
                    const isInstalling = installingModSlug === contentProjectKey(project)
                    // Проценты берём только после сетевого этапа: иначе на «поиске версии»
                    // показывался бы чужой прогресс от прошлой установки.
                    const percent = isInstalling && installPhase !== "resolving" && downloadProgress && downloadProgress.total > 0
                      ? Math.min(100, Math.round((downloadProgress.current / downloadProgress.total) * 100))
                      : null
                    return (
                      <AddonRow
                        key={project.id}
                        project={project}
                        installed={installed}
                        installing={isInstalling}
                        percent={percent}
                        phase={isInstalling ? installPhase : null}
                        showCategories={type === "mods"}
                        installDisabled={installingModSlug !== null}
                        installLabel={t("builds.add")}
                        confirmMessage={isLocked
                          ? t("buildDetail.lockedInstallConfirm", { name: project.name })
                          : undefined}
                        onDetails={() => openProjectModal(project)}
                        onInstall={() => {
                          setInstallingModSlug(contentProjectKey(project))
                          setInstallPhase("resolving")
                          // Чужой прогресс от предыдущей загрузки не должен висеть на новой карточке.
                          setDownloadProgress(null)
                          const task = type === "mods"
                            ? installModToBuild(project, setInstallPhase)
                            : installContentToBuild(project, type, setInstallPhase)
                          Promise.resolve(task).finally(() => {
                            setInstallPhase(null)
                            setTimeout(() => setInstallingModSlug(null), 500)
                          })
                        }}
                      />
                    )
                  })}
                </div>
              ) : modLoading ? (
                <Spinner />
              ) : (modSearch || (modCategories?.length ?? 0) > 0) ? (
                <EmptyState title={notFoundText} className="h-full" />
              ) : (
                <EmptyState
                  title={t("addon.search.startHint")}
                  icon={IconSearch}
                  className="h-full rounded-2xl border border-dashed border-border"
                />
              )}
            </div>
            <Pagination
              currentPage={modPage - 1}
              totalPages={modTotalPages ?? 1}
              onPageChange={(p) => setModPage(p + 1)}
              className="mt-2"
            />
          </div>
        </div>
      </div>

      {versionPickerItem !== null && (        <ModalLayer
          className="z-[60] bg-background/80 backdrop-blur-sm"
          onClose={() => { setVersionPickerItem(null); setSelectedPickerVersion(null) }}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="p-5 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{t("addon.updateTitle", { name: versionPickerItem?.name })}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t("addon.currentVersion", { version: versionPickerItem?.version })}</p>
                </div>
                <button
                  onClick={() => { setVersionPickerItem(null); setSelectedPickerVersion(null) }}
                  className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {versionPickerLoading ? (
                <div className="flex items-center justify-center py-12">
                  <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" strokeWidth={1.75} />
                </div>
              ) : versionPickerVersions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("addon.versions.unavailable")}</p>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    // Установленная версия хранится как номер из jar, а в каталоге версия
                    // названа иначе — сравниваем общим помощником (см. utils).
                    const installed = versionPickerItem?.version
                    // Всё, что ниже текущей версии в списке (он отсортирован от новых к старым), — старее.
                    const installedIndex = versionPickerVersions.findIndex(ver => isInstalledVersion(ver, installed))

                    return versionPickerVersions.map((ver, index) => {
                    const isCurrent = isInstalledVersion(ver, installed)
                    const isSelected = selectedPickerVersion?.id === ver.id
                    const isOlder = installedIndex >= 0 ? index > installedIndex : false

                    return (
                      <button
                        key={ver.id}
                        type="button"
                        onClick={() => setSelectedPickerVersion(isSelected ? null : ver)}
                        className={cn(
                          "w-full text-left p-4 rounded-xl border transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : isCurrent
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-muted/20 hover:bg-muted/30"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{ver.name}</span>
                              {isCurrent && (
                                <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                  <IconCheck className="w-3 h-3" />
                                  {t("addon.versions.current")}
                                </span>
                              )}
                              {isOlder && !isCurrent && (
                                <span className="text-xs text-muted-foreground">{t("addon.versions.older")}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs text-muted-foreground">{ver.gameVersion ?? ""}</span>
                              {ver.loaders && (
                                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1.5">
                                  {(Array.isArray(ver.loaders) ? ver.loaders : [ver.loaders]).map(l => (
                                    <LoaderIcon key={String(l)} loaderId={String(l).toLowerCase()} className="w-3.5 h-3.5" />
                                  ))}
                                  <span>{Array.isArray(ver.loaders) ? ver.loaders.join(", ") : ver.loaders}</span>
                                </span>
                              )}
                              {ver.datePublished && (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(ver.datePublished).toLocaleDateString()}
                                </span>
                              )}
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
                          </div>
                          <IconArrowRight className={cn(
                            "w-4 h-4 transition-transform",
                            isSelected ? "rotate-90 text-primary" : "text-muted-foreground"
                          )} />
                        </div>

                        {isSelected && (
                          <div className="mt-4 pt-4 border-t border-border">
                            {(() => {
                              const changelogText = ver.changelog || cfChangelogs[ver.id]
                              if (changelogText) {
                                return (
                                  <div className="text-sm text-muted-foreground">
                                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">{t("addon.changelog.whatsChanged")}</div>
                                    <ChangelogContent content={changelogText} components={mdComponents} />
                                  </div>
                                )
                              }
                              if (loadingPickerChangelog) {
                                return (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                                    <IconRefresh className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={1.75} />
                                    <span>{t("addon.changelog.loadingDescription")}</span>
                                  </div>
                                )
                              }
                              return <p className="text-sm text-muted-foreground">{t("addon.changelog.emptyDescription")}</p>
                            })()}

                            <div className="flex items-center gap-3 mt-4">
                              {ver.files && ver.files.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {t("addon.filesCount", { count: ver.files.length })}
                                </span>
                              )}
                              {ver.downloadCount !== undefined && (
                                <span className="text-xs text-muted-foreground">
                                  {t("addon.downloadsCount", { count: ver.downloadCount.toLocaleString() })}
                                </span>
                              )}
                            </div>

                            {!isCurrent && (
                              <button
                                type="button"
                                disabled={updatingSlug === versionPickerItem?.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const item = versionPickerItem
                                  if (!item) return
                                  setUpdatingSlug(item.id)
                                  void updateItemVersion(activeBuild.id, type, item.id, ver).finally(() => {
                                    setUpdatingSlug(null)
                                    setSelectedPickerVersion(null)
                                    setVersionPickerItem(null)
                                  })
                                }}
                                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                                {t("addon.updateToThisVersion")}
                              </button>
                            )}

                            {updatingSlug === versionPickerItem?.id && downloadProgress && downloadProgress.total > 0 && (
                              <div className="mt-4">
                                <div className="flex items-center justify-end text-xs text-muted-foreground mb-1">
                                  <span className="shrink-0 ml-2">{Math.round((downloadProgress.current / downloadProgress.total) * 100)}%</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                                    style={{ width: `${Math.min(100, (downloadProgress.current / downloadProgress.total) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                    )
                    })
                  })()}
                </div>
              )}
            </div>
          </div>
        </ModalLayer>
      )}

      <InstanceUpdatesDialog
        activeBuild={activeBuild}
        open={updatesOpen}
        onOpenChange={setUpdatesOpen}
        updateItemVersion={updateItemVersion}
      />

      <Dialog open={rejectedEntries.length > 0} onOpenChange={open => { if (!open) setRejectedEntries([]) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("builds.dropRejectedTitle")}</DialogTitle>
            <DialogDescription>
              {type === "mods" ? t("builds.dropHintMods") : t("builds.dropHintContent")}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1 max-h-64 space-y-2 overflow-y-auto pr-1">
            {rejectedEntries.map((entry, index) => (
              <div key={`${entry.name}-${index}`} className="rounded-xl border border-border bg-muted/20 px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t(`builds.dropReject.${entry.reason}`)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setRejectedEntries([])}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("common.gotIt")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})
