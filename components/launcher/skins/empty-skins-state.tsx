import { useTranslation } from "react-i18next"
import { IconShirt } from "@tabler/icons-react"

export function EmptySkinsState() {
  const { t } = useTranslation()

  return (
    <div data-ui="skins-empty-skins-state-div-1" data-component="empty-skins-state" className="flex flex-1 flex-col items-center justify-center gap-6 rounded-xl border border-border bg-card px-4 py-6 text-center">
      <div data-ui="skins-empty-skins-state-div-2" className="relative">
        <div data-ui="skins-empty-skins-state-div-3" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
          <IconShirt className="w-10 h-10" strokeWidth={1.75} aria-hidden="true" />
        </div>
      </div>
      <div data-ui="skins-empty-skins-state-div-5" className="max-w-md space-y-3">
        <h3 data-ui="skins-empty-skins-state-h3-1" className="text-base font-semibold text-foreground/80">
          {t("skins.noAccounts")}
        </h3>
        <p data-ui="skins-empty-skins-state-p-1" className="text-sm text-muted-foreground leading-relaxed">
          {t("skins.noAccountsDesc")}
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("skins.noAccountsHint")}
        </p>
      </div>
    </div>
  )
}
