import { useContentEnter } from "../content-motion"
import "./settings-storage.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconRefresh, IconTrash, IconFolder, IconCoffee, IconChevronDown, IconChevronRight,
  IconPuzzle, IconPhoto, IconSparkles, IconMap, IconSettings, IconBug,
  IconDatabase, IconAlertTriangle, IconFolderOpen, IconServer, IconLoader2, IconColorSwatch,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/format"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import { EntityIcon } from "@/components/launcher/instance/entity-icon"
import { fsErrorMessage } from "@/lib/fs-errors"
import type { BuildStorageEntry, ServerStorageEntry, StorageScanResult } from "@xnlc/types"
import { getCachedStorageScan, loadStorageScan } from "./storage-scan-cache"

type CleanKind = "build-logs" | "build-crash-reports" | "build-cache"

function StorageSummary({ label, value, icon: Icon, tone }: {
  label: string; value: number; icon: React.ElementType; tone: "builds" | "servers" | "java" | "trash" | "cleanable"
}) {
  return (
    <div className="storage-summary" data-tone={tone}>
      <div className="storage-summary-heading">
        <span className="storage-summary-symbol"><Icon className="h-4 w-4 text-current" strokeWidth={1.7} aria-hidden="true" /></span>
        <span>{label}</span>
      </div>
      <div className="storage-summary-value">{formatBytes(value)}</div>
    </div>
  )
}

function SizeBar({ parts, total }: { parts: Array<{ size: number; className: string }>; total: number }) {
  if (total <= 0) return <div data-ui="settings-settings-storage-div-1" data-component="size-bar" className="h-2 w-full rounded-full bg-muted" />
  return (
    <div data-ui="settings-settings-storage-div-2" data-component="size-bar" className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {parts.filter((p) => p.size > 0).map((p, i) => (
        <div data-ui="settings-settings-storage-div-3" key={i} className={cn("h-full", p.className)} style={{ width: `${Math.max(0.5, (p.size / total) * 100)}%` }} />
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
    <button data-ui="settings-settings-storage-button-1" data-component="clean-button"
      type="button"
      disabled={disabled || size <= 0}
      onClick={onClean}
      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:hover:border-border"
    >
      <IconTrash className="h-3 w-3" strokeWidth={1.75} />
      {label} · {formatBytes(size)}
      {disabled && <span data-ui="settings-settings-storage-span-1" className="sr-only">{t("storage.cleaning")}</span>}
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
    { size: entry.mods, className: "storage-part-mods" },
    { size: entry.resourcepacks, className: "storage-part-resources" },
    { size: entry.shaderpacks, className: "storage-part-shaders" },
    { size: entry.saves, className: "storage-part-worlds" },
    { size: entry.config, className: "storage-part-config" },
    { size: entry.logs + entry.crashReports + entry.cache, className: "storage-part-cache" },
    { size: entry.other, className: "storage-part-other" },
  ]

  const breakdown: Array<{ icon: React.ReactNode; label: string; size: number }> = [
    { icon: <IconPuzzle className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />, label: t("storage.category.mods"), size: entry.mods },
    { icon: <IconPhoto className="h-3.5 w-3.5 text-[var(--storage-resources)]" strokeWidth={1.75} />, label: t("storage.category.resourcepacks"), size: entry.resourcepacks },
    { icon: <IconSparkles className="h-3.5 w-3.5 text-[var(--storage-shaders)]" strokeWidth={1.75} />, label: t("storage.category.shaderpacks"), size: entry.shaderpacks },
    { icon: <IconMap className="h-3.5 w-3.5 text-[var(--storage-worlds)]" strokeWidth={1.75} />, label: t("storage.category.saves"), size: entry.saves },
    { icon: <IconSettings className="h-3.5 w-3.5 text-[var(--storage-config)]" strokeWidth={1.75} />, label: t("storage.category.config"), size: entry.config },
    { icon: <IconBug className="h-3.5 w-3.5 text-[var(--storage-cache)]" strokeWidth={1.75} />, label: t("storage.category.logsAndCache"), size: entry.logs + entry.crashReports + entry.cache },
  ]

  return (
    <div data-ui="settings-settings-storage-div-4" data-component="build-storage-row" className="storage-row">
      <div data-ui="settings-settings-storage-div-5" className="flex w-full items-center gap-3 p-3">
        <button data-ui="settings-settings-storage-button-2"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? <IconChevronDown className="h-4 w-4" strokeWidth={1.75} />
            : <IconChevronRight className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        <div data-ui="settings-settings-storage-div-6" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
          {entry.icon ? (
            // Встроенные логотипы Xneon лежат в public как SVG с захардкоженным
            // оранжевым — EntityIcon подменяет их на инлайн-SVG с currentColor,
            // поэтому иконка красится в цвет темы, как на карточках сборок.
            <EntityIcon
              src={entry.icon}
              className="h-full w-full p-1.5 text-primary"
              imgClassName="h-full w-full object-cover"
            />
          ) : (
            <LoaderIcon loaderId={entry.modLoader} className="h-5 w-5 text-primary/40" />
          )}
        </div>
        <button data-ui="settings-settings-storage-button-3"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div data-ui="settings-settings-storage-div-7" className="flex items-baseline justify-between gap-2">
            <span data-ui="settings-settings-storage-span-2" className="truncate text-sm font-medium text-foreground">{entry.name}</span>
            <span data-ui="settings-settings-storage-span-3" className="shrink-0 text-sm font-semibold text-foreground">{formatBytes(entry.total)}</span>
          </div>
          <div data-ui="settings-settings-storage-div-8" className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span data-ui="settings-settings-storage-span-4">{entry.version}</span>
            <span data-ui="settings-settings-storage-span-5" className="flex items-center gap-1 capitalize">
              <LoaderIcon loaderId={entry.modLoader} className="w-3.5 h-3.5 flex-shrink-0" />
              {entry.modLoader}
            </span>
            {cleanable > 0 && (
              <span data-ui="settings-settings-storage-span-6" className="text-success/80">· {t("storage.canFree", { size: formatBytes(cleanable) })}</span>
            )}
          </div>
          <div data-ui="settings-settings-storage-div-9" className="mt-1.5">
            <SizeBar parts={parts} total={entry.total} />
          </div>
        </button>
        <button data-ui="settings-settings-storage-button-4"
          type="button"
          onClick={() => void window.electronAPI?.openPath(entry.path)}
          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("storage.openFolder")}
        >
          <IconFolderOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {expanded && (
        <div data-ui="settings-settings-storage-div-10" className="border-t border-border/60 px-4 pb-3 pt-2">
          <div data-ui="settings-settings-storage-div-11" className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {breakdown.map((item) => (
              <div data-ui="settings-settings-storage-div-12" key={item.label} className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
                {item.icon}
                <span data-ui="settings-settings-storage-span-7" className="truncate">{item.label}</span>
                <span data-ui="settings-settings-storage-span-8" className="ml-auto shrink-0 font-medium text-foreground">{formatBytes(item.size)}</span>
              </div>
            ))}
          </div>
          <div data-ui="settings-settings-storage-div-13" className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <CleanButton label={t("storage.clean.logs")} size={entry.logs} disabled={cleaning} onClean={() => onClean("build-logs")} />
            <CleanButton label={t("storage.clean.crashReports")} size={entry.crashReports} disabled={cleaning} onClean={() => onClean("build-crash-reports")} />
            <CleanButton label={t("storage.clean.cache")} size={entry.cache} disabled={cleaning} onClean={() => onClean("build-cache")} />
            {cleanable <= 0 && (
              <span data-ui="settings-settings-storage-span-9" className="text-[11px] text-muted-foreground">{t("storage.nothingToClean")}</span>
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
    { size: entry.world, className: "storage-part-worlds" },
    { size: entry.mods, className: "storage-part-mods" },
    { size: entry.config, className: "storage-part-config" },
    { size: entry.logs, className: "storage-part-cache" },
    { size: entry.plugins, className: "storage-part-plugins" },
    { size: entry.cache, className: "storage-part-cache" },
    { size: entry.other, className: "storage-part-other" },
  ]

  const breakdown: Array<{ icon: React.ReactNode; label: string; size: number }> = [
    { icon: <IconMap className="h-3.5 w-3.5 text-[var(--storage-worlds)]" strokeWidth={1.75} />, label: t("storage.category.world"), size: entry.world },
    { icon: <IconPuzzle className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />, label: t("storage.category.mods"), size: entry.mods },
    { icon: <IconSettings className="h-3.5 w-3.5 text-[var(--storage-config)]" strokeWidth={1.75} />, label: t("storage.category.config"), size: entry.config },
    { icon: <IconBug className="h-3.5 w-3.5 text-[var(--storage-cache)]" strokeWidth={1.75} />, label: t("storage.category.logsAndCache"), size: entry.logs + entry.cache },
    { icon: <IconServer className="h-3.5 w-3.5 text-[var(--storage-plugins)]" strokeWidth={1.75} />, label: t("storage.category.plugins"), size: entry.plugins },
  ]

  return (
    <div data-ui="settings-settings-storage-div-14" data-component="server-storage-row" className="storage-row">
      <div data-ui="settings-settings-storage-div-15" className="flex w-full items-center gap-3 p-3">
        <button data-ui="settings-settings-storage-button-5"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? <IconChevronDown className="h-4 w-4" strokeWidth={1.75} />
            : <IconChevronRight className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        <div data-ui="settings-settings-storage-div-16" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
          {entry.icon ? (
            // См. BuildStorageRow: EntityIcon подменяет встроенный логотип на
            // инлайн-SVG с currentColor, чтобы иконка красилась в тему.
            <EntityIcon
              src={entry.icon}
              className="h-full w-full p-1.5 text-primary"
              imgClassName="h-full w-full object-cover"
            />
          ) : (
            <LoaderIcon loaderId={entry.modLoader} className="h-5 w-5 text-primary/40" />
          )}
        </div>
        <button data-ui="settings-settings-storage-button-6"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div data-ui="settings-settings-storage-div-17" className="flex items-baseline justify-between gap-2">
            <span data-ui="settings-settings-storage-span-10" className="truncate text-sm font-medium text-foreground">{entry.name}</span>
            <span data-ui="settings-settings-storage-span-11" className="shrink-0 text-sm font-semibold text-foreground">{formatBytes(entry.total)}</span>
          </div>
          <div data-ui="settings-settings-storage-div-18" className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {entry.gameVersion && <span data-ui="settings-settings-storage-span-12">{entry.gameVersion}</span>}
            <span data-ui="settings-settings-storage-span-13" className="flex items-center gap-1 capitalize">
              <LoaderIcon loaderId={entry.modLoader} className="w-3.5 h-3.5 flex-shrink-0" />
              {entry.modLoader}
            </span>
          </div>
          <div data-ui="settings-settings-storage-div-19" className="mt-1.5">
            <SizeBar parts={parts} total={entry.total} />
          </div>
        </button>
        <button data-ui="settings-settings-storage-button-7"
          type="button"
          onClick={() => void window.electronAPI?.openPath(entry.path)}
          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("storage.openFolder")}
        >
          <IconFolderOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {expanded && (
        <div data-ui="settings-settings-storage-div-20" className="border-t border-border/60 px-4 pb-3 pt-2">
          <div data-ui="settings-settings-storage-div-21" className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {breakdown.map((item) => (
              <div data-ui="settings-settings-storage-div-22" key={item.label} className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
                {item.icon}
                <span data-ui="settings-settings-storage-span-14" className="truncate">{item.label}</span>
                <span data-ui="settings-settings-storage-span-15" className="ml-auto shrink-0 font-medium text-foreground">{formatBytes(item.size)}</span>
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
  const [scan, setScan] = useState<StorageScanResult | null>(getCachedStorageScan)
  const contentEnter = useContentEnter(scan !== null)
  const [loading, setLoading] = useState(() => !getCachedStorageScan())
  const scanRequest = useRef(0)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFreed, setLastFreed] = useState<number | null>(null)

  const runScan = useCallback(async (refresh = true) => {
    const request = ++scanRequest.current
    setLoading(true)
    setError(null)
    try {
      const result = await loadStorageScan(refresh)
      if (request === scanRequest.current && result) setScan(result)
    } catch (e) {
      if (request === scanRequest.current) setError(fsErrorMessage(t, e instanceof Error ? e.message : String(e)))
    } finally {
      if (request === scanRequest.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const cached = getCachedStorageScan()
    if (cached) {
      setScan(cached)
      setLoading(false)
    } else {
      void runScan(false)
    }
    return () => { scanRequest.current++ }
  }, [runScan])

  const handleClean = useCallback(async (buildId: string, kind: CleanKind) => {
    setCleaning(true)
    try {
      const result = await window.electronAPI?.cleanStorage({ kind, buildId })
      if (result?.success) {
        setLastFreed(result.freedBytes)
        await runScan()
      } else if (result?.error) {
        setError(fsErrorMessage(t, result.error))
      }
    } finally {
      setCleaning(false)
    }
  }, [runScan, t])

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
        setError(fsErrorMessage(t, result.error))
      }
    } finally {
      setCleaning(false)
    }
  }, [runScan, t])

  const totals = useMemo(() => {
    if (!scan) return null
    const buildsTotal = scan.builds.reduce((sum, b) => sum + b.total, 0)
    const cleanable = scan.builds.reduce((sum, b) => sum + b.logs + b.crashReports + b.cache, 0)
    const serversTotal = scan.servers.reduce((sum, s) => sum + s.total, 0)
    return { buildsTotal, cleanable, serversTotal }
  }, [scan])

  return (
    <div data-ui="settings-settings-storage-div-23" data-component="settings-storage" className={cn("space-y-6", contentEnter)}>
      <section data-ui="settings-settings-storage-section-1" className="space-y-4">
        <div data-ui="settings-settings-storage-div-24" className="flex items-center justify-between">
          <h3 data-ui="settings-settings-storage-h3-1" className="text-lg font-medium text-foreground flex items-center gap-2">
            <IconDatabase className="w-5 h-5 text-primary" strokeWidth={1.75} />
            {t("storage.title")}
          </h3>
          <button data-ui="settings-settings-storage-button-8"
            type="button"
            disabled={loading}
            onClick={() => void runScan()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {loading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={1.75} /> : <IconRefresh className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {loading ? t("storage.scanning") : t("storage.rescan")}
          </button>
        </div>

        {error && (
          <div data-ui="settings-settings-storage-div-25" className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <IconAlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {error}
          </div>
        )}

        {lastFreed !== null && lastFreed > 0 && (
          <div data-ui="settings-settings-storage-div-26" className="rounded-xl border border-success/40 bg-success/10 px-4 py-2.5 text-sm text-success">
            {t("storage.freed", { size: formatBytes(lastFreed) })}
          </div>
        )}

        {loading && !scan ? (
          <div data-ui="settings-settings-storage-div-27" className="flex items-center justify-center py-16">
            <IconLoader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : scan && totals ? (
          <>
            <div data-ui="settings-settings-storage-div-28" className="storage-summary-grid">
              <StorageSummary tone="builds" label={t("storage.summary.builds")} value={totals.buildsTotal} icon={IconColorSwatch} />
              <StorageSummary tone="servers" label={t("storage.summary.servers")} value={totals.serversTotal} icon={IconServer} />
              <StorageSummary tone="java" label={t("storage.summary.java")} value={scan.javaRuntimes.size} icon={IconCoffee} />
              <StorageSummary tone="trash" label={t("storage.summary.trash")} value={scan.trash.size} icon={IconTrash} />
              <StorageSummary tone="cleanable" label={t("storage.summary.cleanable")} value={totals.cleanable + scan.trash.size} icon={IconSparkles} />
            </div>
            <div className="storage-legend">
              {[
                ["mods", "mods"], ["resources", "resourcepacks"], ["shaders", "shaderpacks"],
                ["worlds", "saves"], ["config", "config"], ["plugins", "plugins"],
                ["cache", "logsAndCache"], ["other", "other"],
              ].map(([color, key]) => (
                <span key={key}><i className={"storage-part-" + color} aria-hidden="true" />{t("storage.category." + key)}</span>
              ))}
            </div>

            {scan.trash.size > 0 && (
              <div data-ui="settings-settings-storage-div-44" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <div data-ui="settings-settings-storage-div-45" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                  {t("storage.trashBin")} · {formatBytes(scan.trash.size)}
                </div>
                <button data-ui="settings-settings-storage-button-9"
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

            <section data-ui="settings-settings-storage-section-2" className="space-y-2">
              <h4 data-ui="settings-settings-storage-h4-1" className="text-sm font-medium text-foreground">{t("storage.buildsSection")}</h4>
              {scan.builds.length === 0 ? (
                <p data-ui="settings-settings-storage-p-1" className="text-sm text-muted-foreground">{t("storage.noBuilds")}</p>
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

            <section data-ui="settings-settings-storage-section-3" className="space-y-2">
              <h4 data-ui="settings-settings-storage-h4-2" className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <IconServer className="h-4 w-4 text-primary" strokeWidth={1.75} />
                {t("storage.serversSection")}
              </h4>
              {scan.servers.length === 0 ? (
                <p data-ui="settings-settings-storage-p-2" className="text-sm text-muted-foreground">{t("storage.noServers")}</p>
              ) : (
                scan.servers.map((entry) => (
                  <ServerStorageRow key={entry.serverId} entry={entry} />
                ))
              )}
            </section>

            {scan.javaRuntimes.entries.length > 0 && (
              <section data-ui="settings-settings-storage-section-4" className="space-y-2">
                <h4 data-ui="settings-settings-storage-h4-3" className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <IconCoffee className="h-4 w-4 text-primary" strokeWidth={1.75} />
                  {t("storage.javaSection")}
                </h4>
                <p data-ui="settings-settings-storage-p-3" className="text-xs text-muted-foreground">{t("storage.javaHint")}</p>
                <div data-ui="settings-settings-storage-div-46" className="space-y-1.5">
                  {scan.javaRuntimes.entries.map((runtime) => (
                    <div data-ui="settings-settings-storage-div-47" key={runtime.path} className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-2.5">
                      <IconCoffee className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <div data-ui="settings-settings-storage-div-48" className="min-w-0 flex-1">
                        <div data-ui="settings-settings-storage-div-49" className="truncate text-sm font-medium text-foreground">{runtime.label}</div>
                        {runtime.versionLabel && (
                          <div data-ui="settings-settings-storage-div-50" className="truncate text-[11px] text-muted-foreground">{runtime.versionLabel} · {runtime.component}</div>
                        )}
                      </div>
                      <span data-ui="settings-settings-storage-span-16" className="shrink-0 text-sm font-medium text-foreground">{formatBytes(runtime.size)}</span>
                      <button data-ui="settings-settings-storage-button-10"
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

            <div data-ui="settings-settings-storage-div-51" className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconFolder className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span data-ui="settings-settings-storage-span-17" className="truncate">{scan.gameDir.path}</span>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
