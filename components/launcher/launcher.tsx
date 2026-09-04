import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AccountsPage } from "./accounts-page"
import { HomePage } from "./home-page"
import { InstancePage } from "./instance"
import { LogsPage } from "./logs-page"
import { SettingsPage } from "./settings"
import { CloudPage } from "./cloud"
import { SkinsPage } from "./skins-page"
import { ServersPage } from "./servers-page"
import { ServerDetailPage } from "./server-detail-page"
import { OnboardingModal } from "./onboarding-modal"
import { Sidebar, type TabId } from "./sidebar"
import { applyTheme, presetThemes } from "./settings/data"
import type { McServerInfo } from "@xnlc/types"

interface LauncherProps {
  onReady?: () => void
}

export function Launcher({ onReady }: LauncherProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabId>("home")
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [selectedTheme, setSelectedTheme] = useState(() => localStorage.getItem("theme") || "orange")
  const [showDbFallbackBanner, setShowDbFallbackBanner] = useState(false)
  const [selectedMcServer, setSelectedMcServer] = useState<McServerInfo | null>(null)

  useEffect(() => {
    // Every page is mounted in this render; notify the parent once the frame
    // has committed so the loading overlay can fade out.
    const id = window.setTimeout(() => onReady?.(), 0)
    return () => window.clearTimeout(id)
  }, [onReady])

  useEffect(() => {
    const theme = presetThemes.find((item) => item.id === selectedTheme)
    if (theme) applyTheme(theme)
  }, [selectedTheme])

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.getSetting("theme").then((dbTheme) => {
      if (cancelled || !dbTheme) return
      const theme = presetThemes.find((t) => t.id === dbTheme)
      if (theme) {
        setSelectedTheme(dbTheme)
        applyTheme(theme)
      }
    })
    return () => { cancelled = true }
  }, [])

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
      setSelectedMcServer(null)
    }

    window.addEventListener("launcher:onboarding-reset", handleResetOnboarding)
    return () => window.removeEventListener("launcher:onboarding-reset", handleResetOnboarding)
  }, [])

  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false)
    void window.electronAPI?.setSetting("onboardingCompleted", "true")
  }, [])

  useEffect(() => {
    onReady?.()
  }, [onReady])

  const renderPage = () => {
    switch (activeTab) {
      case "home": return <HomePage />
      case "builds": return <InstancePage />
      case "logs": return <LogsPage />
      case "settings": return <SettingsPage />
      case "accounts": return <AccountsPage />
      case "cloud": return <CloudPage />
      case "servers":
        if (selectedMcServer) {
          return <ServerDetailPage server={selectedMcServer} onBack={() => setSelectedMcServer(null)} />
        }
        return <ServersPage onSelectServer={setSelectedMcServer} />
      case "skins": return <SkinsPage />
      default: return null
    }
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full p-4 overflow-hidden flex flex-col">
          <div className="h-full w-full flex flex-col">
            {renderPage()}
          </div>
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
            {t("launcher.dbFallbackWarning")}
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
