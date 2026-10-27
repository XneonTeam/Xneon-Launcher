import { IconDeviceGamepad2, IconCoffee, IconPalette, IconLanguage, IconInfoCircle, IconRobot, IconDatabase } from "@tabler/icons-react"
import type { SettingsTab } from "./types"

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  IconDeviceGamepad2,
  IconCoffee,
  IconPalette,
  IconLanguage,
  IconInfoCircle,
  IconRobot,
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
    <nav data-ui="settings-settings-tabs-div-1" data-component="settings-tabs" className="settings-nav" aria-label={t("settings.title")}>
      {tabs.map((tab) => {
        const Icon = ICONS[tab.icon]
        return (
          <button data-ui="settings-settings-tabs-button-1"
            key={tab.id}
            type="button"
            aria-current={activeTab === tab.id ? "page" : undefined}
            aria-controls="settings-panel"
            data-tab={tab.id}
            data-active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="settings-nav-item"
          >
            {Icon && <Icon className="w-4 h-4 text-current" strokeWidth={1.75} aria-hidden="true" />}
            {t(tab.labelKey)}
          </button>
        )
      })}
    </nav>
  )
}

