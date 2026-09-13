import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconRefresh, IconDownload, IconX, IconCheck, IconChevronDown, IconChevronRight, IconPackage, IconAlertCircle, IconLoader2, IconCircleCheck, IconFlask, IconFlame } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"
import { PlatformBadge } from "@/components/launcher/platform-icon"
import type { Build, ModVersion } from "./types"
import type { BuildContentUpdates, ContentUpdateInfo, UpdateChannel } from "@xnlc/types"

const CHANNELS: Array<{ id: UpdateChannel; labelKey: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }> = [
  { id: "release", labelKey: "updates.channel.release", icon: IconCircleCheck },
  { id: "beta", labelKey: "updates.channel.beta", icon: IconFlask },
  { id: "alpha", labelKey: "updates.channel.alpha", icon: IconFlame },
]

const CONTENT_TYPE_LABEL_KEYS: Record<ContentUpdateInfo["contentType"], string> = {
  mods: "builds.tab.mods",
  resourcepacks: "builds.tab.resourcepacks",
  shaders: "builds.tab.shaders",
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className="text-base font-bold text-foreground mt-4 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-foreground mt-3 mb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">{children}</h3>,
  p: ({ children }) => <p className="text-muted-foreground mb-2 leading-relaxed">{children}</p>,
  li: ({ children }) => <li className="text-muted-foreground ml-4 mb-0.5">{children}</li>,
  ul: ({ children }) => <ul className="list-disc mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal mb-2 space-y-0.5">{children}</ol>,
  code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto mb-2">{children}</pre>,
  a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/50 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr className="border-border my-4" />,
  img: ({ src, alt }) => <img src={src} alt={alt || ""} className="rounded-lg max-w-full my-2" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-border">
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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-foreground truncate">{t("updates.title")} — {activeBuild.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {checking
                  ? t("updates.checking")
                  : result
                    ? t("updates.checkedAt", { time: new Date(result.checkedAt).toLocaleTimeString() })
                    : " "}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={checking}
                onClick={() => void runCheck(channel)}
                className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title={t("updates.recheck")}
              >
                <IconRefresh className={cn("w-4 h-4", checking && "animate-spin")} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mt-3">
            <span className="text-xs text-muted-foreground mr-1">{t("updates.channel")}</span>
            {CHANNELS.map((c) => {
              const Icon = c.icon
              const isSelected = channel === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleChannelChange(c.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/60 border border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className={cn(
                    "w-3.5 h-3.5 shrink-0",
                    isSelected
                      ? "text-primary-foreground"
                      : c.id === "release"
                        ? "text-green-500"
                        : c.id === "beta"
                          ? "text-yellow-500"
                          : "text-orange-500"
                  )} strokeWidth={2} />
                  <span>{t(c.labelKey)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {checking && !result ? (
            <div className="flex items-center justify-center py-16">
              <IconRefresh className="h-6 w-6 animate-spin text-muted-foreground" strokeWidth={1.75} />
            </div>
          ) : totalUpdates === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <IconCheck className="h-8 w-8 text-green-500 mb-3" strokeWidth={1.75} />
              <p className="text-sm font-medium text-foreground">{t("updates.allUpToDate")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("updates.allUpToDateDesc")}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {[...groupedUpdates.entries()].map(([contentType, updates]) => (
                <div key={contentType}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t(CONTENT_TYPE_LABEL_KEYS[contentType])}
                    </span>
                    <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-semibold">
                      {updates.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {updates.map((update) => {
                      const isUpdating = updatingIds.has(update.itemId)
                      const isFailed = failedIds.has(update.itemId)
                      const isExpanded = expanded.has(update.itemId)
                      const progress = downloadProgress?.itemId === update.itemId ? downloadProgress : null
                      const isIndeterminate = progress?.percent === null
                      return (
                        <div
                          key={update.itemId}
                          className={cn(
                            "rounded-xl border border-border bg-muted/20 p-3 transition-colors",
                            progress && "border-primary/40 bg-primary/5",
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background border border-border">
                              {update.iconUrl ? (
                                <img src={update.iconUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <IconPackage className="h-5 w-5 text-muted-foreground/50" strokeWidth={1.75} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-foreground truncate">{update.name}</span>
                                {update.source && (
                                  <PlatformBadge source={update.source} className="shrink-0 p-1" iconSize={12} />
                                )}
                                {update.latestVersion.versionType && update.latestVersion.versionType !== "release" && (
                                  <span className={cn(
                                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                    update.latestVersion.versionType === "beta" ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500",
                                  )}>
                                    {update.latestVersion.versionType}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                                <span className="truncate">{update.currentVersion}</span>
                                <span className="text-primary">→</span>
                                <span className="truncate font-medium text-primary" title={update.latestVersion.name}>
                                  {update.latestVersion.versionNumber || update.latestVersion.name}
                                </span>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {!!update.latestVersion.changelog && (
                                <button
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
                              <button
                                type="button"
                                disabled={isUpdating || !!updateAllState}
                                onClick={() => void handleUpdateOne(update)}
                                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isUpdating
                                  ? <IconRefresh className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                                  : <IconDownload className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                {t("updates.update")}
                              </button>
                            </div>
                          </div>
                          {progress && (
                            <div className="mt-3">
                              <div className="mb-1.5 flex items-center justify-between gap-3">
                                <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" strokeWidth={2} />
                                  <span className="truncate">{t("updates.preparing")}</span>
                                </span>
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {isIndeterminate ? "" : `${progress.percent}%`}
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
                                    isIndeterminate && "animate-pulse",
                                  )}
                                  style={{ width: isIndeterminate ? "100%" : `${Math.max(2, progress?.percent ?? 0)}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {isFailed && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                              <IconAlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {t("updates.updateFailed")}
                            </div>
                          )}
                          {isExpanded && !!update.latestVersion.changelog && (
                            <div className="mt-3 border-t border-border pt-3 text-sm">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>
                                {update.latestVersion.changelog}
                              </ReactMarkdown>
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
          <div className="p-4 border-t border-border flex items-center justify-between gap-3 flex-shrink-0">
            <span className="text-xs text-muted-foreground">
              {t("updates.total", { count: totalUpdates })}
            </span>
            <button
              type="button"
              disabled={!!updateAllState || checking}
              onClick={() => void handleUpdateAll()}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateAllState
                ? <><IconRefresh className="w-4 h-4 animate-spin" strokeWidth={1.75} />{t("updates.updatingAll", { done: updateAllState.done, total: updateAllState.total })}</>
                : <><IconDownload className="w-4 h-4" strokeWidth={1.75} />{t("updates.updateAll")}</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
