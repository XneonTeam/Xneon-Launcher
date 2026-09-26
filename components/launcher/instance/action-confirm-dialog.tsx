import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { ReactNode } from "react"
import {
  IconLock,
  IconAlertTriangle,
  IconInfoCircle,
  IconTools,
  IconUnlink,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

export interface ActionConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm?: () => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  type?: "confirm" | "alert"
  variant?: "warning" | "danger" | "info"
  icon?: "lock" | "warning" | "info" | "repair" | "unlink"
  /** Дополнительный блок между описанием и кнопками (например, переключатель). */
  extra?: ReactNode
}

export function ActionConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  type = "confirm",
  variant = "warning",
  icon = "lock",
  extra,
}: ActionConfirmDialogProps) {
  const { t } = useTranslation()
  const resolvedConfirmText = confirmText ?? t("common.continue")
  const resolvedCancelText = cancelText ?? t("common.cancel")
  const renderIcon = () => {
    switch (icon) {
      case "lock":
        return <IconLock className="w-6 h-6 text-amber-500" />
      case "unlink":
        return <IconUnlink className="w-6 h-6 text-amber-500" />
      case "repair":
        return <IconTools className="w-6 h-6 text-primary" />
      case "warning":
        return <IconAlertTriangle className="w-6 h-6 text-destructive" />
      case "info":
      default:
        return <IconInfoCircle className="w-6 h-6 text-primary" />
    }
  }

  const getIconBg = () => {
    switch (variant) {
      case "danger":
        return "bg-destructive/10 border-destructive/20"
      case "warning":
        return "bg-amber-500/10 border-amber-500/20"
      case "info":
      default:
        return "bg-primary/10 border-primary/20"
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md p-6 bg-card border border-border shadow-2xl rounded-3xl" showCloseButton={false}>
        <DialogHeader>
          <div className={cn("mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-2 border", getIconBg())}>
            {renderIcon()}
          </div>
          <DialogTitle className="text-center text-lg font-bold text-foreground">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {title}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 border border-border p-4 text-sm text-muted-foreground leading-relaxed max-h-56 overflow-y-auto whitespace-pre-line text-left">
          {description}
        </div>

        {extra}

        <div className="flex gap-2 pt-2">
          {type === "confirm" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              >
                {resolvedCancelText}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm?.()
                  onClose()
                }}
                className={cn(
                  "flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] shadow-sm",
                  variant === "danger"
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-primary hover:bg-primary/90 shadow-[0_0_15px_var(--glow-primary)]"
                )}
              >
                {resolvedConfirmText}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all active:scale-[0.98]"
            >
              {resolvedConfirmText}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
