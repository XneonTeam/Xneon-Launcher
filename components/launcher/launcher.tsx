import { useCallback, useEffect, useState } from "react"
import { AccountsPage } from "./accounts-page"
import { InstancePage } from "./instance"
import { CloudPage } from "./cloud"
import { NetworkPage } from "./network-page"
import { HomePage } from "./home-page"
import { LogsPage } from "./logs-page"
import { ModsPage } from "./mods"
import { OnboardingModal } from "./onboarding-modal"
import { ServersPage } from "./servers-page"
import { SettingsPage } from "./settings"
import { Sidebar, type TabId } from "./sidebar"
import { applyTheme, presetThemes } from "./settings/data"

export function Launcher() {
  const [activeTab, setActiveTab] = useState<TabId>("home")
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [selectedTheme, setSelectedTheme] = useState(() => localStorage.getItem("theme") || "orange")
  const [showDbFallbackBanner, setShowDbFallbackBanner] = useState(false)

  useEffect(() => {
    const theme = presetThemes.find((item) => item.id === selectedTheme)
    if (theme) applyTheme(theme)
  }, [selectedTheme])

  useEffect(() => {
    let cancelled = false

    const loadOnboardingState = async () => {
      const completed = await window.electronAPI?.getSetting("onboardingCompleted")
      if (!cancelled) {
        setShowOnboarding(completed !== "true")
      }
    }

    void loadOnboardingState()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const checkDbFallback = async () => {
      try {
        const result = await window.electronAPI?.dbIsFallbackStorage()
        if (result?.isFallback) {
          setShowDbFallbackBanner(true)
        }
      } catch {
        // ignore
      }
    }
    void checkDbFallback()
  }, [])

  useEffect(() => {
    const handleResetOnboarding = () => {
      setShowOnboarding(true)
      setActiveTab("home")
    }

    window.addEventListener("launcher:onboarding-reset", handleResetOnboarding)
    return () => window.removeEventListener("launcher:onboarding-reset", handleResetOnboarding)
  }, [])

  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false)
    void window.electronAPI?.setSetting("onboardingCompleted", "true")
  }, [])

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full p-4 overflow-hidden flex flex-col">
          <div className={activeTab === "home" ? "h-full flex flex-col" : "hidden"}><HomePage /></div>
          <div className={activeTab === "builds" ? "h-full flex flex-col" : "hidden"}><InstancePage /></div>
          <div className={activeTab === "logs" ? "h-full flex flex-col" : "hidden"}><LogsPage /></div>
          <div className={activeTab === "settings" ? "h-full flex flex-col" : "hidden"}><SettingsPage /></div>
          <div className={activeTab === "accounts" ? "h-full flex flex-col" : "hidden"}><AccountsPage /></div>
          <div className={activeTab === "mods" ? "h-full flex flex-col" : "hidden"}><ModsPage /></div>
          <div className={activeTab === "servers" ? "h-full flex flex-col" : "hidden"}><ServersPage /></div>
          <div className={activeTab === "cloud" ? "h-full flex flex-col" : "hidden"}><CloudPage /></div>
          <div className={activeTab === "network" ? "h-full flex flex-col" : "hidden"}><NetworkPage /></div>
        </div>
      </main>

      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-[radial-gradient(circle,oklch(0.65_0.22_40/0.08)_0%,transparent_70%)]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-[radial-gradient(circle,oklch(0.6_0.25_80/0.08)_0%,transparent_70%)]" />
      </div>

      {showOnboarding && (
        <OnboardingModal
          selectedTheme={selectedTheme}
          onSelectTheme={setSelectedTheme}
          onFinish={finishOnboarding}
          onSkip={finishOnboarding}
        />
      )}

      {showDbFallbackBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 backdrop-blur-sm">
          <svg className="w-5 h-5 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3l9.5 16.5H2.5L12 3z" />
          </svg>
          <span className="text-sm text-yellow-200">
            Данные хранятся в оперативной памяти и будут потеряны при закрытии. Проверьте подключение к базе данных.
          </span>
          <button
            onClick={() => setShowDbFallbackBanner(false)}
            className="ml-2 text-yellow-400 hover:text-yellow-200 flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
