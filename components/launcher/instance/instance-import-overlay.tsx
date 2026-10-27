import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { ImportProgressState } from "./use-import"
import { ImportProgressPanel } from "./import-progress-panel"

interface InstanceImportOverlayProps {
  importProgress: ImportProgressState | null
  importError: string | null
  isCancelling: boolean
  onCancel: () => void
}

export function InstanceImportOverlay({ importProgress, importError, isCancelling, onCancel }: InstanceImportOverlayProps) {
  const { t } = useTranslation()
  if (!importProgress) return null
  return <Dialog open>
    <DialogContent showCloseButton={false} aria-describedby={undefined} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()} data-component="instance-import-overlay" className="flex max-h-[calc(100dvh-5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl">
      <DialogTitle className="sr-only">{t("import.loadingBuild")}</DialogTitle>
      <div className="min-h-0 overflow-y-auto p-5"><ImportProgressPanel progress={importProgress} error={importError} cancelling={isCancelling} /></div>
      <div className="flex shrink-0 justify-end border-t border-border px-5 py-3.5">
        <button data-ui="instance-instance-import-overlay-button-1" type="button" onClick={onCancel} disabled={isCancelling} className={cn("rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60", importProgress.phase === "complete" && !importError ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-muted/40 text-foreground hover:bg-muted")}>
          {importError ? t("import.close") : isCancelling ? t("import.cancelling") : importProgress.phase === "complete" ? t("import.done") : t("import.cancel")}
        </button>
      </div>
    </DialogContent>
  </Dialog>
}
