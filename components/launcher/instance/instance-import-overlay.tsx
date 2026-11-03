import { IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { ImportProgress } from "@xnlc/types"
import { ImportProgressPanel } from "./import-progress-panel"

interface InstanceImportOverlayProps {
  importProgress: ImportProgress | null
  importError: string | null
  isCancelling: boolean
  onCancel: () => void
  canCancel?: boolean
  onRetry?: () => void
}

export function InstanceImportOverlay({ importProgress, importError, isCancelling, onCancel, canCancel = true, onRetry }: InstanceImportOverlayProps) {
  const { t } = useTranslation()
  if (!importProgress) return null
  return <Dialog open>
    <DialogContent showCloseButton={false} aria-describedby={undefined} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()} data-component="instance-import-overlay" className="flex max-h-[calc(100dvh-5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl">
      <DialogTitle className="sr-only">{t("import.loadingBuild")}</DialogTitle>
      <div className="min-h-0 overflow-y-auto p-5"><ImportProgressPanel progress={importProgress} error={importError} cancelling={isCancelling} /></div>
      {(canCancel || importError || importProgress.phase === "complete") && <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        {importError && onRetry && <button type="button" onClick={onRetry} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("common.retry")}</button>}
        <button data-ui="instance-instance-import-overlay-button-1" type="button" onClick={onCancel} disabled={isCancelling} className={cn("rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60", importProgress.phase === "complete" && !importError ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-muted/40 text-foreground hover:bg-muted")}>
          {importError ? t("import.close") : isCancelling ? t("import.cancelling") : importProgress.phase === "complete" ? t("import.done") : <span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("import.cancel")}</span>}
        </button>
      </div>}
    </DialogContent>
  </Dialog>
}
