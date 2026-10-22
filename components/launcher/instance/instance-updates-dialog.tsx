import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconRefresh, IconDownload, IconX, IconCheck, IconChevronDown, IconChevronRight, IconPackage, IconAlertCircle, IconLoader2 } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"
import { ModalLayer } from "@/components/ui/modal-layer"
import { ChangelogContent } from "./changelog-content"
import { PlatformBadge } from "@/components/launcher/platform-icon"
import type { Build, ModVersion } from "./types"
import type { BuildContentUpdates, ContentUpdateInfo, UpdateChannel } from "@xnlc/types"

const CHANNELS: Array<{ id: UpdateChannel; labelKey: string }> = [
  { id: "release", labelKey: "updates.channel.release" },
  { id: "beta", labelKey: "updates.channel.beta" },
  { id: "alpha", labelKey: "updates.channel.alpha" },
]

const CONTENT_TYPE_LABEL_KEYS: Record<ContentUpdateInfo["contentType"], string> = {
  mods: "builds.tab.mods",
  resourcepacks: "builds.tab.resourcepacks",
  shaders: "builds.tab.shaders",
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 data-ui="instance-instance-updates-dialog-h1-1" className="text-base font-bold text-foreground mt-4 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 data-ui="instance-instance-updates-dialog-h2-1" className="text-sm font-bold text-foreground mt-3 mb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 data-ui="instance-instance-updates-dialog-h3-1" className="text-sm font-semibold text-foreground mt-3 mb-1">{children}</h3>,
  p: ({ children }) => <p data-ui="instance-instance-updates-dialog-p-1" className="text-muted-foreground mb-2 leading-relaxed">{children}</p>,
  li: ({ children }) => <li data-ui="instance-instance-updates-dialog-li-1" className="text-muted-foreground ml-4 mb-0.5">{children}</li>,
  ul: ({ children }) => <ul data-ui="instance-instance-updates-dialog-ul-1" className="list-disc mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol data-ui="instance-instance-updates-dialog-ol-1" className="list-decimal mb-2 space-y-0.5">{children}</ol>,
  code: ({ children }) => <code data-ui="instance-instance-updates-dialog-code-1" className="bg-muted px-1 py-0.5 rounded text-xs font-mono text-foreground">{children}</code>,
  pre: ({ children }) => <pre data-ui="instance-instance-updates-dialog-pre-1" className="bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto mb-2">{children}</pre>,
  a: ({ href, children }) => <a data-ui="instance-instance-updates-dialog-a-1" href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  strong: ({ children }) => <strong data-ui="instance-instance-updates-dialog-strong-1" className="text-foreground font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote data-ui="instance-instance-updates-dialog-blockquote-1" className="border-l-2 border-primary/50 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr data-ui="instance-instance-updates-dialog-hr-1" className="border-border my-4" />,
  img: ({ src, alt }) => <img data-ui="instance-instance-updates-dialog-img-1" src={src} alt={alt || ""} className="rounded-lg max-w-full my-2" />,
  table: ({ children }) => (
    <div data-ui="instance-instance-updates-dialog-div-1" className="my-3 overflow-x-auto rounded-xl border border-border">
      <table data-ui="instance-instance-updates-dialog-table-1" className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead data-ui="instance-instance-updates-dialog-thead-1" className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody data-ui="instance-instance-updates-dialog-tbody-1">{children}</tbody>,
  tr: ({ children }) => <tr data-ui="instance-instance-updates-dialog-tr-1" className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th data-ui="instance-instance-updates-dialog-th-1" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td data-ui="instance-instance-updates-dialog-td-1" className="px-4 py-2.5 align-top text-muted-foreground">{children}</td>,
}

interface InstanceUpdatesDialogProps {
  activeBuild: Build
  open: boolean
  onOpenChange: (open: boolean) => void
  updateItemVersion: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string, newVersion: ModVersion) => Promise<boolean>
}

export const InstanceUpdatesDialog = memo(function InstanceUpdatesDialog({
  activeBuild,
  open,
  onOpenChange,
  updateItemVersion,
}: InstanceUpdatesDialogProps) {
  const { t } = useTranslation()
  const [channel, setChannel] = useState<UpdateChannel>("release")
  const [result, setResult] = useState<BuildContentUpdates | null>(null)
  const [checking, setChecking] = useState(false)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [updateAllState, setUpdateAllState] = useState<{ done: number; total: number } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<{ itemId: string; percent: number | null; fileName?: string } | null>(null)
  const activeDownloadRef = useRef<string | null>(null)
  const checkSeqRef = useRef(0)

  /**
   * Иконки установленного контента по id. Кэш обновлений хранит только сетевые
   * ссылки: встроенные в JAR иконки — это data-URL на десятки килобайт каждая,
   * и на ~200 обновлений они раздували одну строку настроек до мегабайт.
   */
  const installedIcons = useMemo(() => {
    const map = new Map<string, string>()
    const lists = [activeBuild.mods, activeBuild.resourcepacks, activeBuild.shaders]
    for (const list of lists) {
      for (const item of list ?? []) {
        if (item?.id && item.icon_url) map.set(item.id, item.icon_url)
      }
    }
    return map
  }, [activeBuild.mods, activeBuild.resourcepacks, activeBuild.shaders])

  // Прогресс скачивания нового файла — рисуем полоску прямо на элементе обновления
  useEffect(() => {
    const off = window.electronAPI?.onContentDownloadProgress?.((progress) => {
      const itemId = activeDownloadRef.current
      if (!itemId) return
      const percent = progress.total > 0
        ? Math.min(100, Math.round((progress.current / progress.total) * 100))
        : null
      setDownloadProgress({ itemId, percent, fileName: progress.fileName })
    })
    return () => off?.()
  }, [])

  const runCheck = useCallback(async (selectedChannel: UpdateChannel) => {
    const seq = ++checkSeqRef.current
    setChecking(true)
    try {
      const fresh = await window.electronAPI?.checkBuildContentUpdates(activeBuild.id, selectedChannel)
      if (seq !== checkSeqRef.current) return
      setResult(fresh ?? { buildId: activeBuild.id, channel: selectedChannel, checkedAt: Date.now(), updates: [] })
      window.dispatchEvent(new CustomEvent("content-updates-changed"))
    } finally {
      if (seq === checkSeqRef.current) setChecking(false)
    }
  }, [activeBuild.id])

  // On open: show cached results immediately, then refresh in background.
  useEffect(() => {
    if (!open) return
    setResult(null)
    setFailedIds(new Set())
    setExpanded(new Set())
    setUpdateAllState(null)
    let cancelled = false
    void window.electronAPI?.getContentUpdatesCache().then((cache) => {
      if (cancelled) return
      const cached = cache?.[activeBuild.id]
      if (cached) {
        setResult(cached)
        setChannel(cached.channel ?? "release")
      }
    })
    void runCheck(channel)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeBuild.id])

  const handleChannelChange = useCallback((next: UpdateChannel) => {
    setChannel(next)
    void runCheck(next)
  }, [runCheck])

  const handleDismissLocal = useCallback((itemId: string) => {
    setResult((prev) => prev ? { ...prev, updates: prev.updates.filter((u) => u.itemId !== itemId) } : prev)
    void window.electronAPI?.dismissContentUpdate(activeBuild.id, itemId)
    window.dispatchEvent(new CustomEvent("content-updates-changed"))
  }, [activeBuild.id])

  const applyUpdate = useCallback(async (update: ContentUpdateInfo): Promise<boolean> => {
    let version = update.latestVersion
    // CurseForge versions don't carry file URLs — resolve on demand.
    if (update.source === "curseforge" && !version.files?.[0]?.url) {
      const fileId = Number(version.id)
      const url = update.modId && Number.isFinite(fileId)
        ? await window.electronAPI?.modsCurseforgeDownloadUrl(fileId, update.modId)
        : null
      if (!url) return false
      version = {
        ...version,
        files: [{ url, filename: version.fileName || `${version.id}.jar`, size: version.fileSize ?? 0 }],
      }
    }
    return updateItemVersion(activeBuild.id, update.contentType, update.itemId, version)
  }, [activeBuild.id, updateItemVersion])

  const handleUpdateOne = useCallback(async (update: ContentUpdateInfo) => {
    setUpdatingIds((prev) => new Set(prev).add(update.itemId))
    setFailedIds((prev) => { const next = new Set(prev); next.delete(update.itemId); return next })
    activeDownloadRef.current = update.itemId
    setDownloadProgress({ itemId: update.itemId, percent: null })
    try {
      const ok = await applyUpdate(update)
      if (ok) {
        handleDismissLocal(update.itemId)
      } else {
        setFailedIds((prev) => new Set(prev).add(update.itemId))
      }
    } finally {
      activeDownloadRef.current = null
      setDownloadProgress(null)
      setUpdatingIds((prev) => { const next = new Set(prev); next.delete(update.itemId); return next })
    }
  }, [applyUpdate, handleDismissLocal])

  const handleUpdateAll = useCallback(async () => {
    const queue = result?.updates ?? []
    if (queue.length === 0 || updateAllState) return
    setUpdateAllState({ done: 0, total: queue.length })
    for (const update of queue) {
      setUpdatingIds((prev) => new Set(prev).add(update.itemId))
      activeDownloadRef.current = update.itemId
      setDownloadProgress({ itemId: update.itemId, percent: null })
      try {
        const ok = await applyUpdate(update)
        if (ok) {
          handleDismissLocal(update.itemId)
        } else {
          setFailedIds((prev) => new Set(prev).add(update.itemId))
        }
      } finally {
        activeDownloadRef.current = null
        setDownloadProgress(null)
        setUpdatingIds((prev) => { const next = new Set(prev); next.delete(update.itemId); return next })
        setUpdateAllState((prev) => prev ? { ...prev, done: prev.done + 1 } : prev)
      }
    }
    setUpdateAllState(null)
  }, [result, updateAllState, applyUpdate, handleDismissLocal])

  const groupedUpdates = useMemo(() => {
    const groups = new Map<ContentUpdateInfo["contentType"], ContentUpdateInfo[]>()
    for (const update of result?.updates ?? []) {
      const list = groups.get(update.contentType)
      if (list) list.push(update)
      else groups.set(update.contentType, [update])
    }
    return groups
  }, [result])

  const totalUpdates = result?.updates.length ?? 0

  if (!open) return null

  return (
    <ModalLayer windowId="instance-instance-updates-dialog-window-1"
      className="z-[60] "
      onClose={() => onOpenChange(false)}
    >
      <div data-ui="instance-instance-updates-dialog-div-2" data-component="instance-updates-dialog"
        className="w-full max-w-2xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
      >
        <div data-ui="instance-instance-updates-dialog-div-3" className="p-5 border-b border-border flex-shrink-0">
          <div data-ui="instance-instance-updates-dialog-div-4" className="flex items-center justify-between gap-3">
            <div data-ui="instance-instance-updates-dialog-div-5" className="min-w-0">
              <h3 data-ui="instance-instance-updates-dialog-h3-2" className="text-lg font-bold text-foreground truncate">{t("updates.title")} — {activeBuild.name}</h3>
              <p data-ui="instance-instance-updates-dialog-p-2" className="text-xs text-muted-foreground mt-0.5">
                {checking
                  ? t("updates.checking")
                  : result
                    ? t("updates.checkedAt", { time: new Date(result.checkedAt).toLocaleTimeString() })
                    : " "}
              </p>
            </div>
            <div data-ui="instance-instance-updates-dialog-div-6" className="flex items-center gap-2 shrink-0">
              <button data-ui="instance-instance-updates-dialog-button-1"
                type="button"
                disabled={checking}
                onClick={() => void runCheck(channel)}
                className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title={t("updates.recheck")}
              >
                {checking ? <IconLoader2 className="w-4 h-4 text-primary animate-spin" strokeWidth={1.75} /> : <IconRefresh className="w-4 h-4" strokeWidth={1.75} />}
              </button>
              <button data-ui="instance-instance-updates-dialog-button-2"
                type="button"
                onClick={() => onOpenChange(false)}
                className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div data-ui="instance-instance-updates-dialog-div-7" className="flex items-center gap-1.5 mt-3">
            <span data-ui="instance-instance-updates-dialog-span-1" className="text-xs text-muted-foreground mr-1">{t("updates.channel")}</span>
            {CHANNELS.map((c) => {
              const isSelected = channel === c.id
              const tone = c.id === "release"
                ? "bg-success/15 text-success"
                : c.id === "beta"
                  ? "bg-warning/15 text-warning"
                  : "bg-destructive/15 text-destructive"
              return (
                <button data-ui="instance-instance-updates-dialog-button-3"
                  key={c.id}
                  type="button"
                  onClick={() => handleChannelChange(c.id)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase transition-colors",
                    tone,
                    isSelected ? "ring-1 ring-current" : "opacity-60 hover:opacity-100",
                  )}
                >
                  {t(c.labelKey)}
                </button>
              )
            })}
          </div>
        </div>

        <div data-ui="instance-instance-updates-dialog-div-8" className="flex-1 min-h-0 overflow-y-auto p-5">
          {checking && !result ? (
            <div data-ui="instance-instance-updates-dialog-div-9" className="flex items-center justify-center py-16">
              <IconLoader2 className="h-6 w-6 text-primary animate-spin" strokeWidth={1.75} />
            </div>
          ) : totalUpdates === 0 ? (
            <div data-ui="instance-instance-updates-dialog-div-10" className="flex flex-col items-center justify-center py-16 text-center">
              <IconCheck className="h-8 w-8 text-success mb-3" strokeWidth={1.75} />
              <p data-ui="instance-instance-updates-dialog-p-3" className="text-sm font-medium text-foreground">{t("updates.allUpToDate")}</p>
              <p data-ui="instance-instance-updates-dialog-p-4" className="text-xs text-muted-foreground mt-1">{t("updates.allUpToDateDesc")}</p>
            </div>
          ) : (
            <div data-ui="instance-instance-updates-dialog-div-11" className="space-y-5">
              {[...groupedUpdates.entries()].map(([contentType, updates]) => (
                <div data-ui="instance-instance-updates-dialog-div-12" key={contentType}>
                  <div data-ui="instance-instance-updates-dialog-div-13" className="flex items-center gap-2 mb-2">
                    <span data-ui="instance-instance-updates-dialog-span-2" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t(CONTENT_TYPE_LABEL_KEYS[contentType])}
                    </span>
                    <span data-ui="instance-instance-updates-dialog-span-3" className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-semibold">
                      {updates.length}
                    </span>
                  </div>
                  <div data-ui="instance-instance-updates-dialog-div-14" className="space-y-2">
                    {updates.map((update) => {
                      const isUpdating = updatingIds.has(update.itemId)
                      const isFailed = failedIds.has(update.itemId)
                      const isExpanded = expanded.has(update.itemId)
                      const progress = downloadProgress?.itemId === update.itemId ? downloadProgress : null
                      const isIndeterminate = progress?.percent === null
                      return (
                        <div data-ui="instance-instance-updates-dialog-div-15"
                          key={update.itemId}
                          className={cn(
                            "rounded-xl border border-border bg-muted/20 p-3 transition-colors",
                            progress && "border-primary/40 bg-primary/5",
                          )}
                        >
                          <div data-ui="instance-instance-updates-dialog-div-16" className="flex items-center gap-3">
                            <div data-ui="instance-instance-updates-dialog-div-17" className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background border border-border">
                              {(update.iconUrl ?? installedIcons.get(update.itemId)) ? (
                                <img data-ui="instance-instance-updates-dialog-img-2" src={update.iconUrl ?? installedIcons.get(update.itemId)} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <IconPackage className="h-5 w-5 text-muted-foreground/50" strokeWidth={1.75} />
                              )}
                            </div>
                            <div data-ui="instance-instance-updates-dialog-div-18" className="min-w-0 flex-1">
                              <div data-ui="instance-instance-updates-dialog-div-19" className="flex items-center gap-1.5">
                                <span data-ui="instance-instance-updates-dialog-span-4" className="text-sm font-medium text-foreground truncate">{update.name}</span>
                                {update.source && (
                                  <PlatformBadge source={update.source} className="shrink-0 p-1" iconSize={12} />
                                )}
                                {update.latestVersion.versionType && (
                                  <span data-ui="instance-instance-updates-dialog-span-5" className={cn(
                                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                    update.latestVersion.versionType === "release" ? "bg-success/10 text-success"
                                      : update.latestVersion.versionType === "beta" ? "bg-warning/10 text-warning"
                                        : "bg-destructive/10 text-destructive",
                                  )}>
                                    {update.latestVersion.versionType}
                                  </span>
                                )}
                              </div>
                              <div data-ui="instance-instance-updates-dialog-div-20" className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                                <span data-ui="instance-instance-updates-dialog-span-6" className="truncate">{update.currentVersion}</span>
                                <span data-ui="instance-instance-updates-dialog-span-7" className="text-primary">→</span>
                                <span data-ui="instance-instance-updates-dialog-span-8" className="truncate font-medium text-primary" title={update.latestVersion.name}>
                                  {update.latestVersion.versionNumber || update.latestVersion.name}
                                </span>
                              </div>
                            </div>
                            <div data-ui="instance-instance-updates-dialog-div-21" className="flex shrink-0 items-center gap-1">
                              {!!update.latestVersion.changelog && (
                                <button data-ui="instance-instance-updates-dialog-button-4"
                                  type="button"
                                  onClick={() => setExpanded((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(update.itemId)) next.delete(update.itemId)
                                    else next.add(update.itemId)
                                    return next
                                  })}
                                  className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  title={t("updates.changelog")}
                                >
                                  {isExpanded
                                    ? <IconChevronDown className="h-4 w-4" strokeWidth={1.75} />
                                    : <IconChevronRight className="h-4 w-4" strokeWidth={1.75} />}
                                </button>
                              )}
                              <button data-ui="instance-instance-updates-dialog-button-5"
                                type="button"
                                disabled={isUpdating || !!updateAllState}
                                onClick={() => void handleUpdateOne(update)}
                                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isUpdating
                                  ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                                  : <IconDownload className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                {t("updates.update")}
                              </button>
                            </div>
                          </div>
                          {progress && (
                            <div data-ui="instance-instance-updates-dialog-div-22" className="mt-3">
                              <div data-ui="instance-instance-updates-dialog-div-23" className="mb-1.5 flex items-center justify-between gap-3">
                                <span data-ui="instance-instance-updates-dialog-span-9" className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" strokeWidth={2} />
                                  <span data-ui="instance-instance-updates-dialog-span-10" className="truncate">{t("updates.preparing")}</span>
                                </span>
                                <span data-ui="instance-instance-updates-dialog-span-11" className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {isIndeterminate ? "" : `${progress.percent}%`}
                                </span>
                              </div>
                              <div data-ui="instance-instance-updates-dialog-div-24" className={cn("h-1.5 w-full rounded-full bg-muted", isIndeterminate && "progress-indeterminate")}>
                                {/* Подготовка идёт без байтов — полоса бежит; со скачиванием заполняется. */}
                                {!isIndeterminate && (
                                  <div data-ui="instance-instance-updates-dialog-div-25"
                                    className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                                    style={{ width: `${Math.max(2, progress?.percent ?? 0)}%` }}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                          {isFailed && (
                            <div data-ui="instance-instance-updates-dialog-div-26" className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                              <IconAlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {t("updates.updateFailed")}
                            </div>
                          )}
                          {isExpanded && !!update.latestVersion.changelog && (
                            <div data-ui="instance-instance-updates-dialog-div-27" className="mt-3 border-t border-border pt-3 text-sm">
                              <ChangelogContent content={update.latestVersion.changelog} components={mdComponents} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {totalUpdates > 0 && (
          <div data-ui="instance-instance-updates-dialog-div-28" className="p-4 border-t border-border flex items-center justify-between gap-3 flex-shrink-0">
            <span data-ui="instance-instance-updates-dialog-span-12" className="text-xs text-muted-foreground">
              {t("updates.total", { count: totalUpdates })}
            </span>
            <button data-ui="instance-instance-updates-dialog-button-6"
              type="button"
              disabled={!!updateAllState || checking}
              onClick={() => void handleUpdateAll()}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateAllState
                ? <><IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />{t("updates.updatingAll", { done: updateAllState.done, total: updateAllState.total })}</>
                : <><IconDownload className="w-4 h-4" strokeWidth={1.75} />{t("updates.updateAll")}</>}
            </button>
          </div>
        )}
      </div>
    </ModalLayer>
  )
})
