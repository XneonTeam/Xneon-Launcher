import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconRefresh, IconTrash, IconFolder, IconCoffee, IconChevronDown, IconChevronRight,
  IconPuzzle, IconPhoto, IconSparkles, IconMap, IconSettings, IconBug,
  IconDatabase, IconAlertTriangle, IconPackage, IconFolderOpen, IconServer,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/format"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import type { BuildStorageEntry, ServerStorageEntry, StorageScanResult } from "@xnlc/types"

type CleanKind = "build-logs" | "build-crash-reports" | "build-cache"

function SizeBar({ parts, total }: { parts: Array<{ size: number; className: string }>; total: number }) {
  if (total <= 0) return <div className="h-2 w-full rounded-full bg-muted" />
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {parts.filter((p) => p.size > 0).map((p, i) => (
        <div key={i} className={cn("h-full", p.className)} style={{ width: `${Math.max(0.5, (p.size / total) * 100)}%` }} />
      ))}
    </div>
  )
}

function CleanButton({ label, size, disabled, onClean }: {
  label: string
  size: number
  disabled: boolean
  onClean: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      disabled={disabled || size <= 0}
      onClick={onClean}
      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:hover:border-border"
    >
      <IconTrash className="h-3 w-3" strokeWidth={1.75} />
      {label} · {formatBytes(size)}
      {disabled && <span className="sr-only">{t("storage.cleaning")}</span>}
    </button>
  )
}

function BuildStorageRow({ entry, onClean, cleaning }: {
  entry: BuildStorageEntry
  onClean: (kind: CleanKind) => void
  cleaning: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const cleanable = entry.logs + entry.crashReports + entry.cache

  const parts = [
    { size: entry.mods, className: "bg-primary" },
    { size: entry.resourcepacks, className: "bg-violet-500" },
    { size: entry.shaderpacks, className: "bg-sky-500" },
    { size: entry.saves, className: "bg-green-500" },
    { size: entry.config, className: "bg-yellow-500" },
    { size: entry.logs + entry.crashReports + entry.cache, className: "bg-red-400" },
    { size: entry.other, className: "bg-muted-foreground/40" },
  ]

  const breakdown: Array<{ icon: React.ReactNode; label: string; size: number }> = [
    { icon: <IconPuzzle className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />, label: t("storage.category.mods"), size: entry.mods },
    { icon: <IconPhoto className="h-3.5 w-3.5 text-violet-500" strokeWidth={1.75} />, label: t("storage.category.resourcepacks"), size: entry.resourcepacks },
    { icon: <IconSparkles className="h-3.5 w-3.5 text-sky-500" strokeWidth={1.75} />, label: t("storage.category.shaderpacks"), size: entry.shaderpacks },
    { icon: <IconMap className="h-3.5 w-3.5 text-green-500" strokeWidth={1.75} />, label: t("storage.category.saves"), size: entry.saves },
    { icon: <IconSettings className="h-3.5 w-3.5 text-yellow-500" strokeWidth={1.75} />, label: t("storage.category.config"), size: entry.config },
    { icon: <IconBug className="h-3.5 w-3.5 text-red-400" strokeWidth={1.75} />, label: t("storage.category.logsAndCache"), size: entry.logs + entry.crashReports + entry.cache },
  ]

  return (
    <div className="rounded-xl border border-border bg-muted/20">
      <div className="flex w-full items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? <IconChevronDown className="h-4 w-4" strokeWidth={1.75} />
            : <IconChevronRight className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
          {entry.icon ? (
            <img src={entry.icon} alt="" className="h-full w-full object-cover" />
          ) : (
            <IconPackage className="h-5 w-5 text-primary/40" strokeWidth={1.75} />
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
            <span className="shrink-0 text-sm font-semibold text-foreground">{formatBytes(entry.total)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{entry.version}</span>
            <span className="flex items-center gap-1 capitalize">
              <LoaderIcon loaderId={entry.modLoader} className="w-3.5 h-3.5 flex-shrink-0" />
              {entry.modLoader}
            </span>
            {cleanable > 0 && (
              <span className="text-green-400/80">· {t("storage.canFree", { size: formatBytes(cleanable) })}</span>
            )}
          </div>
          <div className="mt-1.5">
            <SizeBar parts={parts} total={entry.total} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => void window.electronAPI?.openPath(entry.path)}
          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("storage.openFolder")}
        >
          <IconFolderOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border/60 px-4 pb-3 pt-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {breakdown.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
                {item.icon}
                <span className="truncate">{item.label}</span>
                <span className="ml-auto shrink-0 font-medium text-foreground">{formatBytes(item.size)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <CleanButton label={t("storage.clean.logs")} size={entry.logs} disabled={cleaning} onClean={() => onClean("build-logs")} />
            <CleanButton label={t("storage.clean.crashReports")} size={entry.crashReports} disabled={cleaning} onClean={() => onClean("build-crash-reports")} />
            <CleanButton label={t("storage.clean.cache")} size={entry.cache} disabled={cleaning} onClean={() => onClean("build-cache")} />
            {cleanable <= 0 && (
              <span className="text-[11px] text-muted-foreground">{t("storage.nothingToClean")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ServerStorageRow({ entry }: { entry: ServerStorageEntry }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const parts = [
    { size: entry.world, className: "bg-green-500" },
    { size: entry.mods, className: "bg-primary" },
    { size: entry.config, className: "bg-yellow-500" },
    { size: entry.logs, className: "bg-red-400" },
    { size: entry.plugins, className: "bg-sky-500" },
    { size: entry.cache, className: "bg-violet-500" },
    { size: entry.other, className: "bg-muted-foreground/40" },
  ]

  const breakdown: Array<{ icon: React.ReactNode; label: string; size: number }> = [
    { icon: <IconMap className="h-3.5 w-3.5 text-green-500" strokeWidth={1.75} />, label: t("storage.category.world"), size: entry.world },
    { icon: <IconPuzzle className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />, label: t("storage.category.mods"), size: entry.mods },
    { icon: <IconSettings className="h-3.5 w-3.5 text-yellow-500" strokeWidth={1.75} />, label: t("storage.category.config"), size: entry.config },
    { icon: <IconBug className="h-3.5 w-3.5 text-red-400" strokeWidth={1.75} />, label: t("storage.category.logsAndCache"), size: entry.logs + entry.cache },
    { icon: <IconServer className="h-3.5 w-3.5 text-sky-500" strokeWidth={1.75} />, label: t("storage.category.plugins"), size: entry.plugins },
  ]

  return (
    <div className="rounded-xl border border-border bg-muted/20">
      <div className="flex w-full items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? <IconChevronDown className="h-4 w-4" strokeWidth={1.75} />
            : <IconChevronRight className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
          {entry.icon ? (
            <img src={entry.icon} alt="" className="h-full w-full object-cover" />
          ) : (
            <IconServer className="h-5 w-5 text-primary/40" strokeWidth={1.75} />
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
            <span className="shrink-0 text-sm font-semibold text-foreground">{formatBytes(entry.total)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {entry.gameVersion && <span>{entry.gameVersion}</span>}
            <span className="flex items-center gap-1 capitalize">
              <LoaderIcon loaderId={entry.modLoader} className="w-3.5 h-3.5 flex-shrink-0" />
              {entry.modLoader}
            </span>
          </div>
          <div className="mt-1.5">
            <SizeBar parts={parts} total={entry.total} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => void window.electronAPI?.openPath(entry.path)}
          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("storage.openFolder")}
        >
          <IconFolderOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border/60 px-4 pb-3 pt-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {breakdown.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
                {item.icon}
                <span className="truncate">{item.label}</span>
                <span className="ml-auto shrink-0 font-medium text-foreground">{formatBytes(item.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsStorage() {
  const { t } = useTranslation()
  const [scan, setScan] = useState<StorageScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFreed, setLastFreed] = useState<number | null>(null)

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI?.scanStorage()
      if (result) setScan(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void runScan()
  }, [runScan])

  const handleClean = useCallback(async (buildId: string, kind: CleanKind) => {
    setCleaning(true)
    try {
      const result = await window.electronAPI?.cleanStorage({ kind, buildId })
      if (result?.success) {
        setLastFreed(result.freedBytes)
        await runScan()
      } else if (result?.error) {
        setError(result.error)
      }
    } finally {
      setCleaning(false)
    }
  }, [runScan])

  const handleCleanTrash = useCallback(async () => {
    setCleaning(true)
    try {
      const result = await window.electronAPI?.cleanStorage({ kind: "trash" })
      if (result?.success) {
        setLastFreed(result.freedBytes)
        await runScan()
      }
    } finally {
      setCleaning(false)
    }
  }, [runScan])

  const handleDeleteRuntime = useCallback(async (runtimePath: string) => {
    setCleaning(true)
    try {
      const result = await window.electronAPI?.cleanStorage({ kind: "java-runtime", path: runtimePath })
      if (result?.success) {
        setLastFreed(result.freedBytes)
        await runScan()
      } else if (result?.error) {
        setError(result.error)
      }
    } finally {
      setCleaning(false)
    }
  }, [runScan])

  const totals = useMemo(() => {
    if (!scan) return null
    const buildsTotal = scan.builds.reduce((sum, b) => sum + b.total, 0)
    const cleanable = scan.builds.reduce((sum, b) => sum + b.logs + b.crashReports + b.cache, 0)
    const serversTotal = scan.servers.reduce((sum, s) => sum + s.total, 0)
    return { buildsTotal, cleanable, serversTotal }
  }, [scan])

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
            <IconDatabase className="w-5 h-5 text-primary" strokeWidth={1.75} />
            {t("storage.title")}
          </h3>
          <button
            type="button"
            disabled={loading}
            onClick={() => void runScan()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <IconRefresh className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
            {loading ? t("storage.scanning") : t("storage.rescan")}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <IconAlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {error}
          </div>
        )}

        {lastFreed !== null && lastFreed > 0 && (
          <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-2.5 text-sm text-green-400">
            {t("storage.freed", { size: formatBytes(lastFreed) })}
          </div>
        )}

        {loading && !scan ? (
          <div className="flex items-center justify-center py-16">
            <IconRefresh className="h-6 w-6 animate-spin text-muted-foreground" strokeWidth={1.75} />
          </div>
        ) : scan && totals ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground">{t("storage.summary.builds")}</div>
                <div className="mt-0.5 text-lg font-bold text-foreground">{formatBytes(totals.buildsTotal)}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground">{t("storage.summary.servers")}</div>
                <div className="mt-0.5 text-lg font-bold text-foreground">{formatBytes(totals.serversTotal)}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground">{t("storage.summary.java")}</div>
                <div className="mt-0.5 text-lg font-bold text-foreground">{formatBytes(scan.javaRuntimes.size)}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground">{t("storage.summary.trash")}</div>
                <div className="mt-0.5 text-lg font-bold text-foreground">{formatBytes(scan.trash.size)}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground">{t("storage.summary.cleanable")}</div>
                <div className="mt-0.5 text-lg font-bold text-green-400">{formatBytes(totals.cleanable + scan.trash.size)}</div>
              </div>
            </div>

            {scan.trash.size > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                  {t("storage.trashBin")} · {formatBytes(scan.trash.size)}
                </div>
                <button
                  type="button"
                  disabled={cleaning}
                  onClick={() => void handleCleanTrash()}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <IconTrash className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("storage.cleanTrash")}
                </button>
              </div>
            )}

            <section className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">{t("storage.buildsSection")}</h4>
              {scan.builds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("storage.noBuilds")}</p>
              ) : (
                scan.builds.map((entry) => (
                  <BuildStorageRow
                    key={entry.buildId}
                    entry={entry}
                    cleaning={cleaning}
                    onClean={(kind) => void handleClean(entry.buildId, kind)}
                  />
                ))
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <IconServer className="h-4 w-4 text-primary" strokeWidth={1.75} />
                {t("storage.serversSection")}
              </h4>
              {scan.servers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("storage.noServers")}</p>
              ) : (
                scan.servers.map((entry) => (
                  <ServerStorageRow key={entry.serverId} entry={entry} />
                ))
              )}
            </section>

            {scan.javaRuntimes.entries.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <IconCoffee className="h-4 w-4 text-primary" strokeWidth={1.75} />
                  {t("storage.javaSection")}
                </h4>
                <p className="text-xs text-muted-foreground">{t("storage.javaHint")}</p>
                <div className="space-y-1.5">
                  {scan.javaRuntimes.entries.map((runtime) => (
                    <div key={runtime.path} className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-2.5">
                      <IconCoffee className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{runtime.label}</div>
                        {runtime.versionLabel && (
                          <div className="truncate text-[11px] text-muted-foreground">{runtime.versionLabel} · {runtime.component}</div>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-medium text-foreground">{formatBytes(runtime.size)}</span>
                      <button
                        type="button"
                        disabled={cleaning}
                        onClick={() => void handleDeleteRuntime(runtime.path)}
                        className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title={t("storage.deleteRuntime")}
                      >
                        <IconTrash className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconFolder className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="truncate">{scan.gameDir.path}</span>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
