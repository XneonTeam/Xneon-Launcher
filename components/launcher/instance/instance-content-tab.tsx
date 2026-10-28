import { CONTENT_ENTER_DELAYED } from "../content-motion"
import { memo, useEffect, useMemo, useRef, useState, useDeferredValue, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { EmptyState } from "@/components/ui/empty-state"
import { IconSearch, IconUpload, IconTrash, IconRefresh, IconPower, IconCheck, IconDownload, IconArrowRight, IconX, IconRefreshDot, IconLock, IconAlertTriangle, IconPuzzle, IconPhoto, IconSparkles, IconLoader2 } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "./spinner"
import { ModalLayer } from "@/components/ui/modal-layer"
import { ModalTitleIcon } from "@/components/ui/modal-title-icon"
import { Pagination } from "./pagination"
import { MODS_PER_PAGE } from "./constants"
import { contentProjectKey, formatDownloads, isInstalledVersion, matchesBuildVersion } from "./utils"
import { LoaderIcon } from "./loader-icon"
import { InstanceUpdatesDialog } from "./instance-updates-dialog"
import { CategoriesDialog } from "./categories-dialog"
import { ChangelogContent } from "./changelog-content"
import { AddonRow } from "@/components/launcher/addon-row"
import { SourceMark } from "@/components/launcher/source-mark"
import type { Build, BuildMod, ModSearchResult, ModSort, SearchSource, ModVersion } from "./types"
import type { ContentDropKind, ContentDropRejectReason, ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./use-mod-search"
import { getSortLabels, SORT_OPTIONS_BY_SOURCE } from "./sort-options"

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 data-ui="instance-instance-content-tab-h1-1" className="text-2xl font-bold text-foreground mt-6 mb-3 pb-2 border-b border-border">{children}</h1>,
  h2: ({ children }) => <h2 data-ui="instance-instance-content-tab-h2-1" className="text-xl font-bold text-foreground mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 data-ui="instance-instance-content-tab-h3-1" className="text-lg font-semibold text-foreground mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p data-ui="instance-instance-content-tab-p-1" className="text-muted-foreground mb-3 leading-relaxed">{children}</p>,
  li: ({ children }) => <li data-ui="instance-instance-content-tab-li-1" className="text-muted-foreground ml-4 mb-1">{children}</li>,
  ul: ({ children }) => <ul data-ui="instance-instance-content-tab-ul-1" className="list-disc mb-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol data-ui="instance-instance-content-tab-ol-1" className="list-decimal mb-4 space-y-1">{children}</ol>,
  code: ({ children }) => <code data-ui="instance-instance-content-tab-code-1" className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">{children}</code>,
  pre: ({ children }) => <pre data-ui="instance-instance-content-tab-pre-1" className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4">{children}</pre>,
  a: ({ href, children }) => <a data-ui="instance-instance-content-tab-a-1" href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  strong: ({ children }) => <strong data-ui="instance-instance-content-tab-strong-1" className="text-foreground font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote data-ui="instance-instance-content-tab-blockquote-1" className="border-l-4 border-primary/50 pl-4 my-4 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr data-ui="instance-instance-content-tab-hr-1" className="border-border my-6" />,
  img: ({ src, alt }) => <img data-ui="instance-instance-content-tab-img-1" src={src} alt={alt || ""} className="rounded-lg max-w-full my-4" />,
  table: ({ children }) => (
    <div data-ui="instance-instance-content-tab-div-1" className="my-4 overflow-x-auto rounded-xl border border-border">
      <table data-ui="instance-instance-content-tab-table-1" className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead data-ui="instance-instance-content-tab-thead-1" className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody data-ui="instance-instance-content-tab-tbody-1">{children}</tbody>,
  tr: ({ children }) => <tr data-ui="instance-instance-content-tab-tr-1" className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th data-ui="instance-instance-content-tab-th-1" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td data-ui="instance-instance-content-tab-td-1" className="px-4 py-2.5 align-top text-muted-foreground">{children}</td>,
}

export function normalizeContentIdentity(value?: string): string {
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
  openProjectModal: (item: ModSearchResult, kind?: "mod" | "resourcepack" | "shader" | "modpack" | "datapack" | "plugin") => void
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
  /** Страница списка установленного контента (0-based, как в Pagination). */
  const [installedPage, setInstalledPage] = useState(0)

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

  /**
   * Пагинация списка установленного контента. Раньше левая половина рендерила
   * все элементы сразу: на модпаке в 163 мода это сотни карточек с иконками и
   * обработчиками в DOM, что заметно тормозило открытие вкладки. Правая
   * половина (результаты поиска) пагинацию уже имела — приводим к одному виду.
   */
  const installedTotalPages = Math.max(1, Math.ceil(filteredInstalled.length / MODS_PER_PAGE))
  // Страница могла «повиснуть» после удаления модов или смены фильтра —
  // подрезаем её к актуальному числу страниц вместо пустого экрана.
  const installedPageSafe = Math.min(installedPage, installedTotalPages - 1)
  const pagedInstalled = useMemo(
    () => filteredInstalled.slice(installedPageSafe * MODS_PER_PAGE, (installedPageSafe + 1) * MODS_PER_PAGE),
    [filteredInstalled, installedPageSafe],
  )

  // Новый поисковый запрос, другая сборка или другой тип контента — всегда
  // начинаем с первой страницы.
  useEffect(() => {
    setInstalledPage(0)
  }, [deferredInstalledSearch, activeBuild.id, type])
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
  const contentType = type === "mods" ? "mod" : type === "resourcepacks" ? "resourcepack" : "shader"
  type ContentCategory = ModCategory & { source?: "modrinth" | "curseforge" }
  const filteredCategories = useMemo(() => (categories ?? []).filter(c => c.projectType === contentType) as ContentCategory[], [categories, contentType])
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
      // Счётчики, а не весь кэш: полный ответ весит мегабайты (data-URL иконки).
      const counts = await window.electronAPI?.getContentUpdatesCounts?.()
      const entry = counts?.[activeBuild.id]
      const count = type === "mods"
        ? (entry?.mods ?? 0)
        : type === "resourcepacks"
          ? (entry?.resourcepacks ?? 0)
          : (entry?.shaders ?? 0)
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
    <div key={type} data-ui="instance-instance-content-tab-div-2" data-component="instance-content-tab" className={`flex-1 min-h-0 flex flex-col gap-4 ${CONTENT_ENTER_DELAYED}`}>
      {isLocked && (
        <div data-ui="instance-instance-content-tab-div-3" className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border border-warning/20 bg-warning/5 text-xs text-warning/90">
          <IconLock className="w-4 h-4 shrink-0" />
          <span data-ui="instance-instance-content-tab-span-1">{t("buildDetail.lockedBanner")}</span>
        </div>
      )}
      <div data-ui="instance-instance-content-tab-div-4" className="flex items-center justify-between gap-3 flex-wrap">
        <div data-ui="instance-instance-content-tab-div-5" className="relative flex-1 min-w-[300px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input data-ui="instance-instance-content-tab-input-1"
            type="text"
            value={modSearch}
            onChange={e => setModSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div data-ui="instance-instance-content-tab-div-6" className="flex items-center gap-2">
          <Select value={modSource} onValueChange={(v) => setModSource(v as SearchSource)}>
            {/* Ширина по содержимому: значок + «Обе платформы» должны влезать целиком */}
            <SelectTrigger className="w-auto min-w-[150px] h-8 text-xs rounded-xl bg-muted/50 border border-border text-foreground">
              {/* Значок подставляет сам SelectValue из выбранного пункта — второй не нужен */}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Порядок пунктов: Modrinth → CurseForge → обе платформы (и Modrinth по умолчанию). */}
              <SelectItem value="modrinth">
                <span data-ui="instance-instance-content-tab-span-2" className="flex items-center gap-1.5"><SourceMark source="modrinth" />Modrinth</span>
              </SelectItem>
              <SelectItem value="curseforge">
                <span data-ui="instance-instance-content-tab-span-3" className="flex items-center gap-1.5"><SourceMark source="curseforge" />CurseForge</span>
              </SelectItem>
              <SelectItem value="both">
                <span data-ui="instance-instance-content-tab-span-4" className="flex items-center gap-1.5">
                  <SourceMark source="modrinth" />
                  <SourceMark source="curseforge" />
                  {t("servers.addons.bothPlatforms")}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={modSortBy} onValueChange={(v) => setModSortBy(v as ModSort)}>
            <SelectTrigger className="w-auto min-w-[165px] h-8 text-xs rounded-xl bg-muted/50 border border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS_BY_SOURCE[modSource].map((id) => (
                <SelectItem key={id} value={id}>{getSortLabels(t)[id]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CategoriesDialog
            categories={filteredCategories}
            selected={modCategories ?? []}
            onApply={(value) => setModCategories?.(value)}
            triggerClassName="px-4 py-2.5 rounded-xl text-sm"
          />
          <button data-ui="instance-instance-content-tab-button-1"
            type="button"
            onClick={() => modFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          >
            <IconUpload className="w-4 h-4" strokeWidth={1.75} />
            {uploadLabel}
          </button>
          <input data-ui="instance-instance-content-tab-input-2"
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

      <div data-ui="instance-instance-content-tab-div-7" className="flex flex-1 min-h-0 flex-col gap-4">
        {loaderIssues.length > 0 && !loaderWarningDismissed && (
          <div data-ui="instance-instance-content-tab-div-8" className="shrink-0 rounded-2xl border border-warning/40 bg-warning/10 p-3">
            <div data-ui="instance-instance-content-tab-div-9" className="flex items-start gap-2">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
              <div data-ui="instance-instance-content-tab-div-10" className="min-w-0 flex-1">
                <p data-ui="instance-instance-content-tab-p-2" className="text-sm font-medium text-foreground">
                  {t("builds.loaderVersionMismatch", {
                    total: loaderIssues.length,
                    loader: `${activeBuild.modLoader} ${activeBuild.loaderVersion}`,
                  })}
                </p>
                <ul data-ui="instance-instance-content-tab-ul-2" className="mt-1.5 space-y-0.5">
                  {loaderIssues.slice(0, 5).map(issue => (
                    <li data-ui="instance-instance-content-tab-li-2" key={issue.fileName} className="truncate text-xs text-muted-foreground">
                      <span data-ui="instance-instance-content-tab-span-5" className="text-foreground/90">{issue.modName || issue.fileName}</span>
                      {" — "}
                      {t("builds.loaderVersionRequired", { loader: issue.loaderId, requirement: issue.requirement })}
                    </li>
                  ))}
                  {loaderIssues.length > 5 && (
                    <li data-ui="instance-instance-content-tab-li-3" className="text-xs text-muted-foreground">
                      {t("builds.loaderVersionMore", { more: loaderIssues.length - 5 })}
                    </li>
                  )}
                </ul>
              </div>
              <button data-ui="instance-instance-content-tab-button-2"
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

        <div data-ui="instance-instance-content-tab-div-11" className="grid gap-3 min-h-0 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <div data-ui="instance-instance-content-tab-div-12"
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
              <div data-ui="instance-instance-content-tab-div-13" className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-background/75 backdrop-blur-[1px]">
                <IconUpload className="mb-2 h-6 w-6 text-primary" strokeWidth={1.75} />
                <p data-ui="instance-instance-content-tab-p-3" className="text-sm font-medium text-foreground">{t("builds.dropToAdd")}</p>
              </div>
            )}
            <div data-ui="instance-instance-content-tab-div-14" className="mb-2 flex items-center justify-between gap-3 shrink-0">
              <h3 data-ui="instance-instance-content-tab-h3-2" className="text-sm font-medium text-foreground">{t("builds.installed")}</h3>
              <div data-ui="instance-instance-content-tab-div-15" className="flex items-center gap-1.5">
                <button data-ui="instance-instance-content-tab-button-3"
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
                  <IconRefreshDot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {t("updates.title")}
                  {updatesCount > 0 && (
                    <span data-ui="instance-instance-content-tab-span-6" className="ml-0.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">
                      {updatesCount}
                    </span>
                  )}
                </button>
                <span data-ui="instance-instance-content-tab-span-7" className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {installedSearch.trim() ? `${filteredInstalled.length}/${installedItems.length}` : installedItems.length}
                </span>
              </div>
            </div>

            {installedItems.length > 0 && (
              <div data-ui="instance-instance-content-tab-div-16" className="relative mb-3 shrink-0">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input data-ui="instance-instance-content-tab-input-3"
                  type="text"
                  value={installedSearch}
                  onChange={e => setInstalledSearch(e.target.value)}
                  placeholder={t("builds.searchInstalled")}
                  className="w-full pl-10 pr-8 py-2 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                {installedSearch && (
                  <button data-ui="instance-instance-content-tab-button-4"
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

            <div data-ui="instance-instance-content-tab-div-17" className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
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
              ) : pagedInstalled.map((item) => {
                const isEnabled = item.enabled ?? true
                return (
                <div data-ui="instance-instance-content-tab-div-18" key={item.id} className={`rounded-xl border bg-background p-3 transition-opacity ${isEnabled ? 'border-border' : 'border-border/50 opacity-55'}`}>
                  <div data-ui="instance-instance-content-tab-div-19" className="flex items-start gap-3">
                    <button data-ui="instance-instance-content-tab-button-5"
                      type="button"
                      onClick={() => toggleItemEnabled(activeBuild.id, type, item.id)}
                      className={`mt-0.5 rounded-lg border p-2 transition-colors hover:bg-muted/80 ${isEnabled ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}
                      aria-label={isEnabled ? t("common.disable") : t("common.enable")}
                      title={isEnabled ? t("common.disable") : t("common.enable")}
                    >
                      <IconPower className={`h-4 w-4 ${isEnabled ? 'fill-primary/20' : ''}`} strokeWidth={1.75} />
                    </button>
                    <div data-ui="instance-instance-content-tab-div-20" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background border border-border">
                      {item.icon_url ? (
                        <img data-ui="instance-instance-content-tab-img-2" src={item.icon_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        <span data-ui="instance-instance-content-tab-span-8" className="text-sm font-semibold text-muted-foreground">{item.name[0]}</span>
                      )}
                    </div>
                    <div data-ui="instance-instance-content-tab-div-21" className="min-w-0 flex-1">
                      <div data-ui="instance-instance-content-tab-div-22" className="flex items-center gap-1.5 min-w-0">
                        <span data-ui="instance-instance-content-tab-span-9" className="text-sm font-medium text-foreground break-words truncate">{item.name}</span>
                        {item.source && item.source !== "local" && (
                          <SourceMark source={item.source} className="shrink-0" />
                        )}
                      </div>
                      {item.author && (
                        <div data-ui="instance-instance-content-tab-div-23" className="mt-0.5 text-xs text-muted-foreground/70 truncate">{item.author}</div>
                      )}
                    </div>
                    <div data-ui="instance-instance-content-tab-div-24" className="flex shrink-0 items-center gap-1">
                      <button data-ui="instance-instance-content-tab-button-6"
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
                              : window.electronAPI?.modsModrinthVersions("", item.id)
                          void Promise.resolve(fetchPromise).then(async versions => {
                            // При неполных или устаревших метаданных определяем проект по файлу.
                            if (!versions?.length && (item.projectId || item.modId)) {
                              return await window.electronAPI?.modsModrinthVersions("", item.id)
                            }
                            return versions
                          }).then((versions) => {
                            const list = (versions ?? []) as ModVersion[]
                            // Для модов фильтруем по загрузчику сборки (fabric/neoforge/...)
                            // и версии Minecraft, чтобы не показывать несовместимые.
                            const requireLoader = type === "mods"
                            const compatible = list.filter(v => matchesBuildVersion(v, activeBuild, requireLoader))
                            const gameOnly = list.filter(v => matchesBuildVersion(v, activeBuild, false))
                            const shown = compatible.length > 0 ? compatible : (gameOnly.length > 0 ? gameOnly : list)
                            setVersionPickerVersions(shown)
                            // Раскрываем changelog установленной версии сразу.
                            const current = shown.find(v => isInstalledVersion(v, item, activeBuild.version))
                            if (current) setSelectedPickerVersion(current)
                          }).catch(error => {
                            console.error("Failed to load installed content versions:", error)
                            pushNotification({ kind: "error", source: "install", title: t("common.errorTitle"), message: String(error) })
                          }).finally(() => setVersionPickerLoading(false))
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        aria-label={t("common.refresh")}
                        title={t("common.refresh")}
                      >
                        <IconRefresh className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button data-ui="instance-instance-content-tab-button-7"
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

            <Pagination
              currentPage={installedPageSafe}
              totalPages={installedTotalPages}
              onPageChange={setInstalledPage}
              className="mt-3 shrink-0"
            />
          </div>

          <div data-ui="instance-instance-content-tab-div-25" className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-border bg-card/40 p-4">
            <div data-ui="instance-instance-content-tab-div-26" className="flex items-center justify-between shrink-0">
              <h3 data-ui="instance-instance-content-tab-h3-3" className="text-sm font-medium text-muted-foreground">{title}</h3>
              {!modLoading && displayResults.length > 0 && (
                <span data-ui="instance-instance-content-tab-span-10" className="text-xs text-muted-foreground">{t("buildDetail.resultsCount", { count: formatDownloads(modTotalHits) })}</span>
              )}
            </div>

            <div data-ui="instance-instance-content-tab-div-27" className="flex-1 min-h-0 min-w-0 overflow-y-auto pr-1 mt-2">
              {displayResults.length > 0 ? (
                <div data-ui="instance-instance-content-tab-div-28" className="grid min-w-0 gap-2 pb-2">
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
                        projectKind={type === "mods" ? "mod" : type === "resourcepacks" ? "resourcepack" : "shader"}
                        confirmMessage={isLocked
                          ? t("buildDetail.lockedInstallConfirm", { name: project.name })
                          : undefined}
                        onDetails={() => openProjectModal(project, type === "mods" ? "mod" : type === "resourcepacks" ? "resourcepack" : "shader")}
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

      {versionPickerItem !== null && (        <ModalLayer windowId="instance-instance-content-tab-window-1"
          className="z-[60] "
          onClose={() => { setVersionPickerItem(null); setSelectedPickerVersion(null) }}
        >
          <div data-ui="instance-instance-content-tab-div-29"
            className="w-full max-w-2xl max-h-[80vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
          >
            <div data-ui="instance-instance-content-tab-div-30" className="p-5 border-b border-border flex-shrink-0">
              <div data-ui="instance-instance-content-tab-div-31" className="flex items-center justify-between">
                <div data-ui="instance-instance-content-tab-div-32">
                  <h3 data-ui="instance-instance-content-tab-h3-4" className="flex items-center gap-2 text-lg font-bold text-foreground"><ModalTitleIcon><IconPuzzle className="h-4 w-4" strokeWidth={1.75} /></ModalTitleIcon>{t("addon.updateTitle", { name: versionPickerItem?.name })}</h3>
                  <p data-ui="instance-instance-content-tab-p-4" className="text-sm text-muted-foreground mt-1">{t("addon.currentVersion", { version: versionPickerItem?.version })}</p>
                </div>
                <button data-ui="instance-instance-content-tab-button-8"
                  onClick={() => { setVersionPickerItem(null); setSelectedPickerVersion(null) }}
                  className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div data-ui="instance-instance-content-tab-div-33" className="flex-1 overflow-y-auto p-5">
              {versionPickerLoading ? (
                <div data-ui="instance-instance-content-tab-div-34" className="flex items-center justify-center py-12">
                  <IconLoader2 className="h-5 w-5 text-primary animate-spin" strokeWidth={1.75} />
                </div>
              ) : versionPickerVersions.length === 0 ? (
                <p data-ui="instance-instance-content-tab-p-5" className="py-6 text-center text-sm text-muted-foreground">{t("addon.versions.unavailable")}</p>
              ) : (
                <div data-ui="instance-instance-content-tab-div-35" className="space-y-2">
                  {(() => {
                    // Установленная версия хранится как номер из jar, а в каталоге версия
                    // названа иначе — сравниваем общим помощником (см. utils).
                    // Всё, что ниже текущей версии в списке (он отсортирован от новых к старым), — старее.
                    const installedRef = versionPickerItem
                    const installedIndex = versionPickerVersions.findIndex(ver => isInstalledVersion(ver, installedRef, activeBuild?.version))

                    return versionPickerVersions.map((ver, index) => {
                    const isCurrent = index === installedIndex
                    const isSelected = selectedPickerVersion?.id === ver.id
                    const isOlder = installedIndex >= 0 ? index > installedIndex : false

                    return (
                      <button data-ui="instance-instance-content-tab-button-9"
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
                        <div data-ui="instance-instance-content-tab-div-36" className="flex items-center justify-between">
                          <div data-ui="instance-instance-content-tab-div-37" className="flex-1">
                            <div data-ui="instance-instance-content-tab-div-38" className="flex items-center gap-2">
                              <span data-ui="instance-instance-content-tab-span-11" className="font-medium text-foreground">{ver.name}</span>
                              {isCurrent && (
                                <span data-ui="instance-instance-content-tab-span-12" className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                  <IconCheck className="w-3 h-3" />
                                  {t("addon.versions.current")}
                                </span>
                              )}
                              {isOlder && !isCurrent && (
                                <span data-ui="instance-instance-content-tab-span-13" className="text-xs text-muted-foreground">{t("addon.versions.older")}</span>
                              )}
                            </div>
                            <div data-ui="instance-instance-content-tab-div-39" className="flex flex-wrap items-center gap-2 mt-1">
                              <span data-ui="instance-instance-content-tab-span-20" className="text-xs text-muted-foreground">{ver.gameVersion ?? ""}</span>
                              {ver.loaders && ver.loaders.length > 0 && (
                                <span data-ui="instance-instance-content-tab-span-21" className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                  {ver.loaders.map(loader => (
                                    <LoaderIcon key={String(loader)} loaderId={String(loader).toLowerCase()} className="w-3.5 h-3.5" />
                                  ))}
                                  <span>{ver.loaders.join(", ")}</span>
                                </span>
                              )}
                              {ver.datePublished && (
                                <span data-ui="instance-instance-content-tab-span-14" className="text-xs text-muted-foreground">
                                  {new Date(ver.datePublished).toLocaleDateString()}
                                </span>
                              )}
                              {ver.versionType && (
                                <span data-ui="instance-instance-content-tab-span-15" className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                  ver.versionType === "release" ? "bg-success/10 text-success"
                                    : ver.versionType === "beta" ? "bg-warning/10 text-warning"
                                      : "bg-destructive/10 text-destructive"
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
                          <div data-ui="instance-instance-content-tab-div-40" className="mt-4 pt-4 border-t border-border">
                            {(() => {
                              const changelogText = ver.changelog || cfChangelogs[ver.id]
                              if (changelogText) {
                                return (
                                  <div data-ui="instance-instance-content-tab-div-41" className="text-sm text-muted-foreground">
                                    <div data-ui="instance-instance-content-tab-div-42" className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">{t("addon.changelog.whatsChanged")}</div>
                                    <ChangelogContent content={changelogText} components={mdComponents} />
                                  </div>
                                )
                              }
                              if (loadingPickerChangelog) {
                                return (
                                  <div data-ui="instance-instance-content-tab-div-43" className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                                    <IconLoader2 className="h-3.5 w-3.5 text-primary animate-spin" strokeWidth={1.75} />
                                    <span data-ui="instance-instance-content-tab-span-16">{t("addon.changelog.loadingDescription")}</span>
                                  </div>
                                )
                              }
                              return <p data-ui="instance-instance-content-tab-p-6" className="text-sm text-muted-foreground">{t("addon.changelog.emptyDescription")}</p>
                            })()}

                            <div data-ui="instance-instance-content-tab-div-44" className="flex items-center gap-3 mt-4">
                              {ver.files && ver.files.length > 0 && (
                                <span data-ui="instance-instance-content-tab-span-17" className="text-xs text-muted-foreground">
                                  {t("addon.filesCount", { count: ver.files.length })}
                                </span>
                              )}
                              {ver.downloadCount !== undefined && (
                                <span data-ui="instance-instance-content-tab-span-18" className="text-xs text-muted-foreground">
                                  {t("addon.downloadsCount", { count: ver.downloadCount.toLocaleString() })}
                                </span>
                              )}
                            </div>

                            {!isCurrent && (
                              <button data-ui="instance-instance-content-tab-button-10"
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
                              <div data-ui="instance-instance-content-tab-div-45" className="mt-4">
                                <div data-ui="instance-instance-content-tab-div-46" className="flex items-center justify-end text-xs text-muted-foreground mb-1">
                                  <span data-ui="instance-instance-content-tab-span-19" className="shrink-0 ml-2">{Math.round((downloadProgress.current / downloadProgress.total) * 100)}%</span>
                                </div>
                                <div data-ui="instance-instance-content-tab-div-47" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div data-ui="instance-instance-content-tab-div-48"
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
        <DialogContent data-window="instance-instance-content-tab-window-2" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ModalTitleIcon><IconAlertTriangle className="h-4 w-4" strokeWidth={1.75} /></ModalTitleIcon>{t("builds.dropRejectedTitle")}</DialogTitle>
            <DialogDescription>
              {type === "mods" ? t("builds.dropHintMods") : t("builds.dropHintContent")}
            </DialogDescription>
          </DialogHeader>
          <div data-ui="instance-instance-content-tab-div-49" className="mt-1 max-h-64 space-y-2 overflow-y-auto pr-1">
            {rejectedEntries.map((entry, index) => (
              <div data-ui="instance-instance-content-tab-div-50" key={`${entry.name}-${index}`} className="rounded-xl border border-border bg-muted/20 px-3 py-2">
                <p data-ui="instance-instance-content-tab-p-7" className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                <p data-ui="instance-instance-content-tab-p-8" className="mt-0.5 text-xs text-muted-foreground">{t(`builds.dropReject.${entry.reason}`)}</p>
              </div>
            ))}
          </div>
          <div data-ui="instance-instance-content-tab-div-51" className="mt-3 flex justify-end">
            <button data-ui="instance-instance-content-tab-button-11"
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
