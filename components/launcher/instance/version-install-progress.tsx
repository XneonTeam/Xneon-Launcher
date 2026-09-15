import { cn } from "@/lib/utils"
import { IconAlertCircle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

export type InstallPhase = "running" | "done" | "error"

export interface InstallState {
  versionId: string
  phase: InstallPhase
  /** Байтовый прогресс текущего файла (null — размер неизвестен) */
  percent: number | null
  fileName?: string
  error?: string
}

/** Полоска прогресса установки прямо на карточке версии */
export function VersionInstallProgress({ state }: { state: InstallState }) {
  const { t } = useTranslation()
  if (state.phase === "error") {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-400">
        <IconAlertCircle className="w-4 h-4 shrink-0 mt-px" strokeWidth={1.75} />
        <span className="break-words">{state.error || t("versionInstall.failed")}</span>
      </div>
    )
  }

  if (state.phase === "done") {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-green-500">
        <IconCircleCheck className="w-4 h-4 shrink-0" strokeWidth={1.75} />
        <span>{t("versionInstall.installed")}</span>
      </div>
    )
  }

  const indeterminate = state.percent === null
  const width = indeterminate ? 100 : Math.max(2, Math.min(100, state.percent ?? 0))

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
          <IconLoader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" strokeWidth={2} />
          <span className="truncate">{t("common.installing")}</span>
        </span>
        <span className="shrink-0 text-[11px] font-mono text-muted-foreground tabular-nums">
          {indeterminate ? "" : `${state.percent}%`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
            indeterminate && "animate-pulse",
          )}
          style={{ width: indeterminate ? "100%" : `${width}%` }}
        />
      </div>
    </div>
  )
}
