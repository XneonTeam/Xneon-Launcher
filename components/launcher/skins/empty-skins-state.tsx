import { useTranslation } from "react-i18next"
import { IconShirt, IconAlertCircle } from "@tabler/icons-react"

export function EmptySkinsState() {
  const { t } = useTranslation()

  return (
    <div data-ui="skins-empty-skins-state-div-1" data-component="empty-skins-state" className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-4">
      <div data-ui="skins-empty-skins-state-div-2" className="relative">
        <div data-ui="skins-empty-skins-state-div-3" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
          <IconShirt className="w-10 h-10" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div data-ui="skins-empty-skins-state-div-4" className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl bg-card border border-primary/20 flex items-center justify-center shadow-sm">
          <IconAlertCircle className="w-4 h-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
        </div>
      </div>
      <div data-ui="skins-empty-skins-state-div-5" className="space-y-2">
        <h3 data-ui="skins-empty-skins-state-h3-1" className="text-base font-semibold text-foreground/80">
          {t("skins.noAccounts", "Нет активного аккаунта")}
        </h3>
        <p data-ui="skins-empty-skins-state-p-1" className="text-sm text-muted-foreground/60 max-w-sm leading-relaxed">
          {t("skins.noAccountsDesc", "Добавьте или выберите аккаунт, чтобы управлять скинами")}
        </p>
      </div>
    </div>
  )
}
