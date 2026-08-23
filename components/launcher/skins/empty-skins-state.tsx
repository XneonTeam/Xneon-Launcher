import { useTranslation } from "react-i18next"
import { IconShirt, IconAlertCircle } from "@tabler/icons-react"

export function EmptySkinsState() {
  const { t } = useTranslation()

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="relative">
        <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-muted/40 to-muted/10 border border-border/50 flex items-center justify-center">
          <IconShirt className="w-12 h-12 text-muted-foreground/25" strokeWidth={1} />
        </div>
        <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl bg-card border border-border flex items-center justify-center shadow-sm">
          <IconAlertCircle className="w-4 h-4 text-muted-foreground/50" />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-foreground/80">
          {t("skins.notSupported", "Скины недоступны")}
        </h3>
        <p className="text-sm text-muted-foreground/60 max-w-sm leading-relaxed">
          {t("skins.notSupportedDesc", "Управление скинами пока доступно только для аккаунтов Microsoft")}
        </p>
      </div>
    </div>
  )
}
