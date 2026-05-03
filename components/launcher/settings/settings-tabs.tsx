import { cn } from "@/lib/utils"
import { IconDeviceGamepad2, IconBrandJavascript, IconPalette, IconLanguage, IconInfoCircle } from "@tabler/icons-react"
import type { SettingsTab } from "./types"

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  IconDeviceGamepad2,
  IconBrandJavascript,
  IconPalette,
  IconLanguage,
  IconInfoCircle,
}

interface SettingsTabsProps {
  tabs: { id: SettingsTab; labelKey: string; icon: string }[]
  activeTab: SettingsTab
  setActiveTab: (tab: SettingsTab) => void
  t: (key: string) => string
}

export function SettingsTabs({ tabs, activeTab, setActiveTab, t }: SettingsTabsProps) {
  return (
    <div className="flex gap-2 mb-6 p-1 bg-muted/30 rounded-xl w-fit">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.icon]
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-[0_0_15px_var(--glow-primary)]"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {Icon && <Icon className="w-4 h-4" strokeWidth={1.75} />}
            {t(tab.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
