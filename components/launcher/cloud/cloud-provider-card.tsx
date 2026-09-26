import { useTranslation } from "react-i18next"
import { IconLoader2 } from "@tabler/icons-react"
import { PROVIDER_ICONS, ProviderIcon, providerColor } from "./provider-icon"

type Props = {
  id: string
  name: string
  onConnect: (id: string) => void
  connecting: boolean
  isConnected?: boolean
}

export function CloudProviderCard({ id, name, onConnect, connecting, isConnected }: Props) {
  const { t } = useTranslation()
  const info = PROVIDER_ICONS[id]
  const color = providerColor(id)

  return (
    <button
      onClick={() => onConnect(id)}
      disabled={connecting}
      className="group relative flex flex-col items-center gap-4 p-6 rounded-2xl bg-muted/20 hover:bg-muted/40 border border-border hover:border-primary/30 transition-all duration-200 text-center disabled:opacity-60"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
        style={{ backgroundColor: `${color}15` }}
      >
        {connecting ? (
          <IconLoader2 className="w-8 h-8 animate-spin" style={{ color }} />
        ) : (
          <ProviderIcon id={id} className="w-8 h-8" style={{ color }} />
        )}
      </div>
      <div>
        <p className="font-semibold text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {connecting ? t("cloud.connecting") : isConnected ? t("cloud.openFiles") : t("cloud.connectHint")}
        </p>
      </div>
    </button>
  )
}
