import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { IconPackage, IconAlertTriangle, IconCopy, IconFolderOpen } from "@tabler/icons-react"

export interface ModpackConflictInfo {
  /** duplicate — этот же модпак уже установлен, name — имя занято другим модпаком */
  kind: "duplicate" | "name"
  existingName: string
  existingBuildId: string
  suggestedName: string
  packName: string
}

export interface ModpackConflictDialogProps {
  open: boolean
  conflict: ModpackConflictInfo | null
  onCancel: () => void
  onCreateCopy: (name: string) => void
  onOpenExisting: () => void
}

export function ModpackConflictDialog({
  open,
  conflict,
  onCancel,
  onCreateCopy,
  onOpenExisting,
}: ModpackConflictDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")

  useEffect(() => {
    if (open && conflict) setName(conflict.suggestedName)
  }, [open, conflict])

  if (!conflict) return null

  const isDuplicate = conflict.kind === "duplicate"
  const trimmed = name.trim()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-md p-6 bg-card border border-border shadow-2xl rounded-3xl" showCloseButton={false}>
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-2 border bg-amber-500/10 border-amber-500/20">
            {isDuplicate
              ? <IconPackage className="w-6 h-6 text-amber-500" />
              : <IconAlertTriangle className="w-6 h-6 text-amber-500" />}
          </div>
          <DialogTitle className="text-center text-lg font-bold text-foreground">
            {isDuplicate ? t("conflict.duplicateTitle") : t("conflict.nameTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isDuplicate
              ? t("conflict.duplicateDesc", { pack: conflict.packName, existing: conflict.existingName })
              : t("conflict.nameDesc", { existing: conflict.existingName })}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 border border-border p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-line text-left">
          {isDuplicate
            ? t("conflict.duplicateBody", { pack: conflict.packName, existing: conflict.existingName })
            : t("conflict.nameBody", { existing: conflict.existingName })}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground px-1">{t("conflict.newNameLabel")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            spellCheck={false}
            className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border text-sm text-foreground outline-none transition-colors focus:border-primary"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          {isDuplicate && (
            <button
              type="button"
              onClick={onOpenExisting}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
            >
              <IconFolderOpen className="w-4 h-4" strokeWidth={1.75} />
              <span>{t("conflict.open")}</span>
            </button>
          )}
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => trimmed && onCreateCopy(trimmed)}
            className="flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            <IconCopy className="w-4 h-4" strokeWidth={1.75} />
            <span>{t("conflict.createCopy")}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
