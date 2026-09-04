import { useTranslation } from "react-i18next"
import { IconHome, IconLayoutBoard, IconFileText, IconCloud, IconUserPlus, IconSettings, IconColorSwatch, IconShirt, IconServer } from "@tabler/icons-react"
import type { TabId } from "./sidebar"

interface ContentCardProps {
  activeTab: TabId
}

const tabKeys: Record<TabId, { titleKey: string; messageKey: string; icon: React.ReactNode }> = {
  home: {
    titleKey: "content.home.title",
    messageKey: "content.home.message",
    icon: <IconHome className="w-12 h-12" strokeWidth={1.5} />,
  },
  builds: {
    titleKey: "content.builds.title",
    messageKey: "content.builds.message",
    icon: <IconLayoutBoard className="w-12 h-12" strokeWidth={1.5} />,
  },
  logs: {
    titleKey: "content.logs.title",
    messageKey: "content.logs.message",
    icon: <IconFileText className="w-12 h-12" strokeWidth={1.5} />,
  },
  cloud: {
    titleKey: "content.cloud.title",
    messageKey: "content.cloud.message",
    icon: <IconCloud className="w-12 h-12" strokeWidth={1.5} />,
  },
  servers: {
    titleKey: "content.servers.title",
    messageKey: "content.servers.message",
    icon: <IconServer className="w-12 h-12" strokeWidth={1.5} />,
  },
  accounts: {
    titleKey: "content.accounts.title",
    messageKey: "content.accounts.message",
    icon: <IconUserPlus className="w-12 h-12" strokeWidth={1.5} />,
  },
  settings: {
    titleKey: "content.settings.title",
    messageKey: "content.settings.message",
    icon: <IconSettings className="w-12 h-12" strokeWidth={1.5} />,
  },
  themes: {
    titleKey: "content.themes.title",
    messageKey: "content.themes.message",
    icon: <IconColorSwatch className="w-12 h-12" strokeWidth={1.5} />,
  },
  skins: {
    titleKey: "content.skins.title",
    messageKey: "content.skins.message",
    icon: <IconShirt className="w-12 h-12" strokeWidth={1.5} />,
  },
}

export function ContentCard({ activeTab }: ContentCardProps) {
  const { t } = useTranslation()
  const content = tabKeys[activeTab]

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border transition-all duration-300 animate-in fade-in-0 slide-in-from-bottom-4">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

      <div className="relative z-10 p-8">
        <h2 className="text-xl font-semibold text-foreground mb-6">{t(content.titleKey)}</h2>

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-24 h-24 rounded-2xl bg-muted/50 flex items-center justify-center mb-6 text-muted-foreground">
            {content.icon}
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent">
            <IconHome className="w-5 h-5" strokeWidth={1.5} />
            <span className="font-medium">{t(content.messageKey)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
