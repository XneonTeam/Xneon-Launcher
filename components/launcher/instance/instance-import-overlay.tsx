import { IconLoader2 } from "@tabler/icons-react"
import type { ImportProgressState } from "./use-import"
import { useTranslation } from "react-i18next"

interface InstanceImportOverlayProps {
  importProgress: ImportProgressState | null
  importError: string | null
  isCancelling: boolean
  onCancel: () => void
}

function formatProgressLabel(t: (key: string) => string, message: string, source: ImportProgressState["source"]): string {
  const trimmed = message.trim()
  const isCurseforge = source === "curseforge"
  const isFtb = source === "ftb"
  if (!trimmed) {
    return isCurseforge || isFtb ? t("import.loadingModpack") : t("import.loadingFiles")
  }

  if (/^\d+\s*\/\s*\d+/.test(trimmed)) {
    return isCurseforge || isFtb ? t("import.loadingModpack") : t("import.loadingFiles")
  }

  return trimmed
}

export function InstanceImportOverlay({
  importProgress,
  importError,
  isCancelling,
  onCancel,
}: InstanceImportOverlayProps) {
  const { t } = useTranslation()
  if (!importProgress) return null

  const total = Math.max(importProgress.total, 1)
  const progressPercent = Math.max(0, Math.min(100, Math.round((importProgress.current / total) * 100)))
  const progressLabel = formatProgressLabel(t, importProgress.message, importProgress.source)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/78 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{t("import.modpackImport")}</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">{t("import.loadingBuild")}</h3>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <IconLoader2 className="h-5 w-5 animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{progressLabel}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-foreground">{progressPercent}%</span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {importError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCancelling ? t("import.cancelling") : t("import.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
