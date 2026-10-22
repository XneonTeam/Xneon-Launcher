import { useTranslation } from "react-i18next"
import { IconLoader2 } from "@tabler/icons-react"
import { ProviderIcon } from "./provider-icon"

type Props = {
  id: string
  name: string
  onConnect: (id: string) => void
  connecting: boolean
  isConnected?: boolean
}

export function CloudProviderCard({ id, name, onConnect, connecting, isConnected }: Props) {
  const { t } = useTranslation()

  return (
    <button data-ui="cloud-cloud-provider-card-button-1" data-component="cloud-provider-card"
      onClick={() => onConnect(id)}
      disabled={connecting}
      className="group relative flex flex-col items-center gap-4 p-6 rounded-2xl bg-card/60 hover:bg-muted/40 border border-border hover:border-primary/40 transition-colors duration-200 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
    >
      <div data-ui="cloud-cloud-provider-card-div-1"
        className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center transition-colors duration-200 group-hover:bg-primary/20"
      >
        {connecting ? (
          <IconLoader2 className="w-8 h-8 animate-spin" />
        ) : (
          <ProviderIcon id={id} className="w-8 h-8" />
        )}
      </div>
      <div data-ui="cloud-cloud-provider-card-div-2">
        <p data-ui="cloud-cloud-provider-card-p-1" className="font-semibold text-foreground">{name}</p>
        <p data-ui="cloud-cloud-provider-card-p-2" className="text-xs text-muted-foreground mt-1">
          {connecting ? t("cloud.connecting") : isConnected ? t("cloud.openFiles") : t("cloud.connectHint")}
        </p>
      </div>
    </button>
  )
}
