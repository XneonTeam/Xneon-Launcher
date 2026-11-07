import { IconLoader2 } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

export function Spinner() {
  const { t } = useTranslation()

  return (
    <div data-ui="instance-spinner-div-1" data-component="spinner" className="flex min-h-full items-center justify-center py-12">
      <div className="flex flex-col items-center gap-2">
        <IconLoader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">{t("builds.downloading")}</span>
      </div>
    </div>
  )
}
