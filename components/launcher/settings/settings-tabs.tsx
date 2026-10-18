import { cn } from "@/lib/utils"
import { IconDeviceGamepad2, IconCoffee, IconPalette, IconLanguage, IconInfoCircle, IconBrain, IconDatabase } from "@tabler/icons-react"
import type { SettingsTab } from "./types"

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  IconDeviceGamepad2,
  IconCoffee,
  IconPalette,
  IconLanguage,
  IconInfoCircle,
  IconBrain,
  IconDatabase,
}

interface SettingsTabsProps {
  tabs: { id: SettingsTab; labelKey: string; icon: string }[]
  activeTab: SettingsTab
  setActiveTab: (tab: SettingsTab) => void
  t: (key: string) => string
}

export function SettingsTabs({ tabs, activeTab, setActiveTab, t }: SettingsTabsProps) {
  return (
    <div className="flex gap-0.5 p-1 mb-6 rounded-xl bg-muted/30 border border-border/50 w-fit mx-auto">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.icon]
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
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

