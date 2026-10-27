import { useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconArchive, IconArrowsExchange, IconCheck, IconChevronDown, IconChevronUp, IconFolder, IconLoader2, IconPackage, IconPuzzle, IconAlertTriangle, IconPhoto, IconSparkles } from "@tabler/icons-react"
import type { ImportProgress, ImportProgressFile } from "@xnlc/types"
import { cn } from "@/lib/utils"
import { getImportOperation } from "./import-progress-model"

function FileIcon({ file }: { file: ImportProgressFile }) {
  const [failed, setFailed] = useState(false)
  const Icon = file.kind === "mod" ? IconPuzzle : file.kind === "resourcepack" ? IconPhoto : file.kind === "shader" ? IconSparkles : IconPackage
  return <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/50 text-primary">
    {file.iconUrl && !failed ? <img src={file.iconUrl} alt="" className="size-full object-cover" loading="lazy" onError={() => setFailed(true)} /> : <Icon className="size-4" strokeWidth={1.75} />}
  </div>
}

export function ImportProgressPanel({ progress, compact = false, error, cancelling = false }: { progress: ImportProgress; compact?: boolean; error?: string | null; cancelling?: boolean }) {
  const { t } = useTranslation()
  const [coverFailed, setCoverFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const filesId = useId()
  useEffect(() => setCoverFailed(false), [progress.iconUrl])
  const operation = getImportOperation(progress)
  const phase = cancelling ? "cancelling" : progress.phase ?? "preparing"
  const finished = phase === "complete" && !error && !cancelling
  const percent = Number.isFinite(progress.total) && progress.total > 0 ? Math.max(0, Math.min(100, Math.round((Number.isFinite(progress.current) ? progress.current : 0) / progress.total * 100))) : 0
  const files = progress.files ?? []
  const completed = progress.completedFiles ?? files.filter(file => file.status === "complete").length
  const rank = { error: 0, downloading: 1, queued: 2, cancelled: 3, complete: 4 }
  const ordered = [...files].sort((a, b) => rank[a.status] - rank[b.status])
  const visibleFiles = expanded ? ordered : ordered.slice(0, 4)
  const OperationIcon = finished ? IconCheck : operation === "archive" ? IconArchive : operation === "launcher" ? IconFolder : operation === "update" ? IconArrowsExchange : IconPackage
  const indeterminate = !error && !finished && (phase === "preparing" || phase === "package" && percent === 0 || progress.total <= 0)
  const label = error || (cancelling ? t("import.cancelling") : finished ? t(`import.result.${operation}`) : progress.message || t(`import.phase.${phase}`))

  return <div data-component="import-progress-panel" data-operation={operation} className="min-w-0 text-foreground">
    <div className={cn("flex items-center gap-3", compact ? "mb-3" : "mb-4")}>
      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary/10 text-primary">
        {progress.iconUrl && !coverFailed ? <img src={progress.iconUrl} alt="" className="size-full object-cover" onError={() => setCoverFailed(true)} /> : <OperationIcon className="size-5" strokeWidth={1.75} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-foreground">{progress.title || t("import.loadingBuild")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(`import.operation.${operation}`)}{progress.source && progress.source !== "local" ? ` · ${t(`import.platform.${progress.source}`)}` : ""}</p>
      </div>
    </div>

    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs" aria-live="polite">
        {error ? <IconAlertTriangle className="size-4 shrink-0 text-destructive" /> : finished ? <IconCheck className="size-4 shrink-0 text-primary" /> : <IconLoader2 className="size-4 shrink-0 text-primary motion-safe:animate-spin" />}
        <span className={cn("min-w-0 flex-1 truncate", error ? "text-destructive" : "text-muted-foreground")} title={label}>{label}</span>
        {!indeterminate && <span className="shrink-0 font-medium tabular-nums text-foreground">{finished ? 100 : percent}%</span>}
      </div>
      <div role="progressbar" aria-label={t(`import.operation.${operation}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : finished ? 100 : percent} className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none", error ? "bg-destructive" : "bg-primary", indeterminate && "w-1/3 motion-safe:animate-[indeterminate-bar_1.1s_ease-in-out_infinite]")} style={indeterminate ? undefined : { width: `${finished ? 100 : percent}%` }} />
      </div>
      {progress.itemName && progress.itemName !== progress.title && <p className="truncate text-[11px] text-muted-foreground" title={progress.itemName}>{progress.itemName}</p>}
    </div>

    {files.length > 0 && <section className="mt-4 border-t border-border pt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <h4>{t("import.contents")}</h4>
        <span className="tabular-nums">{t("import.filesCount", { current: completed, total: progress.fileCount ?? files.length })}</span>
      </div>
      <div id={filesId} className={cn(expanded && "overflow-y-auto overscroll-contain pr-3 [scrollbar-gutter:stable]", expanded && (compact ? "max-h-44" : "max-h-60"))}>
        {visibleFiles.map(file => <div key={file.id} data-file-status={file.status} className="flex items-center gap-2.5 py-2">
          <div className="relative shrink-0">
            <FileIcon file={file} />
            <span aria-label={t(`import.fileStatus.${file.status}`)} title={t(`import.fileStatus.${file.status}`)} className={cn(file.status === "queued" || file.status === "cancelled" ? "sr-only" : "absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-background ring-2 ring-background", file.status === "downloading" ? "text-primary" : file.status === "error" ? "text-destructive" : "text-muted-foreground")}>
              {file.status === "complete" ? <IconCheck className="size-2.5" strokeWidth={2.5} /> : file.status === "downloading" ? <IconLoader2 className="size-2.5 motion-safe:animate-spin" /> : file.status === "error" ? <IconAlertTriangle className="size-2.5" /> : <span>{t(`import.fileStatus.${file.status}`)}</span>}
            </span>
          </div>
          <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{file.name}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={file.fileName}>{file.fileName}</p></div>
        </div>)}
      </div>
      {files.length > 4 && <button type="button" data-action="toggle-import-files" aria-expanded={expanded} aria-controls={filesId} onClick={() => setExpanded(value => !value)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {expanded ? t("import.hideFiles") : t("import.showFiles", { count: files.length })}
        {expanded ? <IconChevronUp className="size-3.5" /> : <IconChevronDown className="size-3.5" />}
      </button>}
    </section>}
  </div>
}
