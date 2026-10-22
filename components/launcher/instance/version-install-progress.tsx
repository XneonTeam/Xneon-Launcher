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
      <div data-ui="instance-version-install-progress-div-1" data-component="version-install-progress" className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <IconAlertCircle className="w-4 h-4 shrink-0 mt-px" strokeWidth={1.75} />
        <span data-ui="instance-version-install-progress-span-1" className="break-words">{state.error || t("versionInstall.failed")}</span>
      </div>
    )
  }

  if (state.phase === "done") {
    return (
      <div data-ui="instance-version-install-progress-div-2" data-component="version-install-progress" className="mt-3 flex items-center gap-2 text-xs text-success">
        <IconCircleCheck className="w-4 h-4 shrink-0" strokeWidth={1.75} />
        <span data-ui="instance-version-install-progress-span-2">{t("versionInstall.installed")}</span>
      </div>
    )
  }

  const indeterminate = state.percent === null
  const width = indeterminate ? 100 : Math.max(2, Math.min(100, state.percent ?? 0))

  return (
    <div data-ui="instance-version-install-progress-div-3" data-component="version-install-progress" className="mt-3">
      <div data-ui="instance-version-install-progress-div-4" className="flex items-center justify-between gap-3 mb-1.5">
        <span data-ui="instance-version-install-progress-span-3" className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
          <IconLoader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" strokeWidth={2} />
          <span data-ui="instance-version-install-progress-span-4" className="truncate">{t("common.installing")}</span>
        </span>
        <span data-ui="instance-version-install-progress-span-5" className="shrink-0 text-[11px] font-mono text-muted-foreground tabular-nums">
          {indeterminate ? "" : `${state.percent}%`}
        </span>
      </div>
      <div data-ui="instance-version-install-progress-div-5" className={cn("h-1.5 w-full rounded-full bg-muted", indeterminate && "progress-indeterminate")}>
        {/* Размер файла неизвестен — полоса бежит; иначе заполняется процентами. */}
        {!indeterminate && (
          <div data-ui="instance-version-install-progress-div-6"
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${width}%` }}
          />
        )}
      </div>
    </div>
  )
}
