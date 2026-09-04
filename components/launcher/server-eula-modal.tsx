import { useTranslation } from "react-i18next"
import { IconContract, IconExternalLink } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

interface ServerEulaModalProps {
  open: boolean
  onAccept: () => void
  onDecline: () => void
}

export function ServerEulaModal({ open, onAccept, onDecline }: ServerEulaModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDecline() }}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <IconContract className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle className="text-center">{t("servers.eula.title")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("servers.eula.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 border border-border p-4 text-sm text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
          <p className="mb-2">{t("servers.eula.terms1")}</p>
          <p className="mb-2">{t("servers.eula.terms2")}</p>
          <p>{t("servers.eula.terms3")}</p>
        </div>

        <a
          href="https://aka.ms/MinecraftEULA"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mx-auto"
        >
          {t("servers.eula.viewFull")}
          <IconExternalLink className="w-3 h-3" />
        </a>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onDecline}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          >
            {t("servers.eula.decline")}
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all active:scale-[0.98]"
          >
            {t("servers.eula.accept")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
