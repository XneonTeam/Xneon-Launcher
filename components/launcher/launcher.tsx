import { Suspense, lazy, useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { HomePage } from "./home-page"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { Sidebar, type TabId } from "./sidebar"
import { Spinner } from "./instance/spinner"
import { useThemeRegistry } from "./settings/theme-store"
import { ThemeBackgroundLayer } from "./theme-background-layer"
import { ThemeInspector } from "./settings/theme-inspector"
import { ThemeRuntime } from "./settings/theme-runtime"
import { changeLanguage } from "@/src/i18n"
import type { McServerInfo } from "@xnlc/types"
import type { SettingsTab } from "./settings/types"

// На старте загружается только главная; остальные разделы — по открытию.
const InstancePage = lazy(() => import("./instance").then((m) => ({ default: m.InstancePage })))
const AgentPage = lazy(() => import("./agent/agent-page").then((m) => ({ default: m.AgentPage })))
/**
 * Страница скинов тянет three.js (~505 КБ) и включает обе вкладки — «Избранное»
 * и «Библиотеку» каталога Laby, поэтому грузится лениво одним чанком.
 */
const SkinsPage = lazy(() => import("./skins-page").then((m) => ({ default: m.SkinsPage })))

const LogsPage = lazy(() => import("./logs-page").then(m => ({ default: m.LogsPage })))
const SettingsPage = lazy(() => import("./settings").then(m => ({ default: m.SettingsPage })))
const AccountsPage = lazy(() => import("./accounts-page").then(m => ({ default: m.AccountsPage })))
const CloudPage = lazy(() => import("./cloud").then(m => ({ default: m.CloudPage })))
const ServersPage = lazy(() => import("./servers-page").then(m => ({ default: m.ServersPage })))
const ServerDetailPage = lazy(() => import("./server-detail-page").then(m => ({ default: m.ServerDetailPage })))
const StatsPage = lazy(() => import("./stats-page").then(m => ({ default: m.StatsPage })))
const OnboardingModal = lazy(() => import("./onboarding-modal").then(m => ({ default: m.OnboardingModal })))

/**
 * Заглушка на время загрузки lazy-страницы.
 *
 * Раньше здесь был пустой `<div>` — при первом заходе на тяжёлую вкладку
 * пользователь видел чёрный экран без признаков загрузки. Потом появился скелет
 * из прямоугольников, но он рисовал макет страницы, которой пользователь ещё не
 * видел: рамки прыгали и ничего не сообщали. Во всём остальном лаунчере загрузка
 * выглядит одинаково — центрированный `Spinner` (скины, библиотека, серверы,
 * аддоны, Modrinth/CurseForge/FTB), поэтому фолбэк приведён к тому же виду.
 */
function PageFallback() {
  return (
    <div data-ui="launcher-div-1" data-component="page-fallback" className="flex h-full w-full items-center justify-center" aria-busy="true" aria-live="polite">
      <Spinner />
    </div>
  )
}

interface LauncherProps {
  onReady?: () => void
}

export function Launcher({ onReady }: LauncherProps) {
  const { t } = useTranslation()
  /**
   * Единый реестр тем: применяет выбранную тему, хранит свои темы и сам
   * подхватывает изменения из main (`settings:updated`). Отдельные useState
   * и useEffect про тему лаунчеру больше не нужны.
   */
  const registry = useThemeRegistry()
  const [activeTab, setActiveTab] = useState<TabId>("home")
  useEffect(() => {
    document.body.dataset.launcherPage = activeTab
    return () => { delete document.body.dataset.launcherPage }
  }, [activeTab])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showDbFallbackBanner, setShowDbFallbackBanner] = useState(false)
  const [selectedMcServer, setSelectedMcServer] = useState<McServerInfo | null>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("game")
  // Подсказка для страницы логов: открыта из-за краша игры.
  const [logsFocus, setLogsFocus] = useState<{ crash: boolean; at: number } | null>(null)
  /**
   * Счётчик «вернись к корню раздела». Растёт при повторном клике по уже активному
   * пункту меню: страницы, у которых есть вложенный экран (карточка сборки,
   * файловый браузер облака), по нему возвращаются на свой список.
   */
  const [sectionResetToken, setSectionResetToken] = useState(0)
  const [pendingCloudThemeId, setPendingCloudThemeId] = useState<string | null>(null)


  // Настройки пишутся в БД из main (в т.ч. агентом Xneon AI) — применяем их
  // мгновенно, без перезапуска. Язык — здесь, через i18n (он же пишет
  // localStorage); тему (включая свои темы) применяет и подхватывает
  // `useThemeRegistry`.
  useEffect(() => {
    const off = window.electronAPI?.onSettingsUpdated?.(({ key, value }) => {
      if (key === "language") {
        void changeLanguage(value)
      }
    })
    return () => off?.()
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

    // Play на карточке сборки открывает главную: там уже выбран загрузчик
    // «Сборка» и сама сборка, остаётся нажать ИГРАТЬ.
    const handleOpenHome = () => {
      setSelectedMcServer(null)
      setActiveTab("home")
    }

    // Краш игры: показываем логи, а страница логов сама подсветит ошибки.
    const handleOpenLogs = (event: Event) => {
      const detail = (event as CustomEvent<{ crash?: boolean }>).detail
      setSelectedMcServer(null)
      setLogsFocus(detail?.crash ? { crash: true, at: Date.now() } : null)
      setActiveTab("logs")
    }

    // Переход в настройки из других экранов (например, из баннера ошибки
    // AI-агента: не хватает API-ключа). Раньше агент открывал внешний сайт.
    const handleOpenSettings = (event: Event) => {
      const requested = (event as CustomEvent<{ tab?: SettingsTab }>).detail?.tab
      setSettingsTab(requested === "ai" ? "ai" : "game")
      setSelectedMcServer(null)
      setActiveTab("settings")
    }

    const handleOpenAgent = () => {
      setSelectedMcServer(null)
      setActiveTab("agent")
    }

    const handleOpenCloudThemeUpload = (event: Event) => {
      const themeId = (event as CustomEvent<{ themeId?: string }>).detail?.themeId
      if (!themeId) return
      setPendingCloudThemeId(themeId)
      setSelectedMcServer(null)
      setActiveTab("cloud")
    }

    const handleOpenSection = (event: Event) => {
      const section = String((event as CustomEvent<{ section?: string }>).detail?.section || "")
      if (section === "agent:files") { setActiveTab("agent"); setTimeout(() => window.dispatchEvent(new Event("launcher:agent-pick-files")), 150); return }
      if (section.startsWith("settings:")) { const tab = section.split(":")[1]; if (["game","java","themes","language","ai","storage","about"].includes(tab)) { setSettingsTab(tab as SettingsTab); setSelectedMcServer(null); setActiveTab("settings") }; return }
      if (["home","builds","accounts","settings","cloud","skins","servers","stats","logs","agent"].includes(section)) { setSelectedMcServer(null); setActiveTab(section as TabId) }
    }
    window.addEventListener("launcher:open-section", handleOpenSection)
    window.addEventListener("launcher:onboarding-reset", handleResetOnboarding)
    window.addEventListener("launcher:open-home", handleOpenHome)
    window.addEventListener("launcher:open-logs", handleOpenLogs)
    window.addEventListener("launcher:open-settings", handleOpenSettings)
    window.addEventListener("launcher:open-agent", handleOpenAgent)
    window.addEventListener("launcher:open-cloud-theme-upload", handleOpenCloudThemeUpload)
    return () => {
      window.removeEventListener("launcher:open-section", handleOpenSection)
      window.removeEventListener("launcher:onboarding-reset", handleResetOnboarding)
      window.removeEventListener("launcher:open-home", handleOpenHome)
      window.removeEventListener("launcher:open-logs", handleOpenLogs)
      window.removeEventListener("launcher:open-settings", handleOpenSettings)
      window.removeEventListener("launcher:open-agent", handleOpenAgent)
      window.removeEventListener("launcher:open-cloud-theme-upload", handleOpenCloudThemeUpload)
    }
  }, [])

  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false)
    void window.electronAPI?.setSetting("onboardingCompleted", "true")
  }, [])

  // Ручной переход по вкладкам сбрасывает подсказку краша: иначе при возврате
  // в логи фильтр «Ошибки» включился бы снова сам по себе.
  const handleTabChange = useCallback((tab: TabId) => {
    setLogsFocus(null)

    // Повторный клик по активному разделу — возврат к его корню: из карточки
    // сборки в список сборок, из конкретного сервера в список серверов, из
    // файлового браузера облака к списку хранилищ.
    if (tab === activeTab) {
      // «Серверы» сбрасывают и выбранный сервер, и внутреннюю вкладку страницы
      // (корзина, Modrinth, CurseForge) — за это отвечает sectionResetToken.
      if (tab === "servers") {
        setSelectedMcServer(null)
        setSectionResetToken((token) => token + 1)
      } else if (tab === "builds" || tab === "cloud") setSectionResetToken((token) => token + 1)
      return
    }

    setActiveTab(tab)
  }, [activeTab])

  useEffect(() => {
    // React уже смонтировал главную. RAF в скрытом окне ограничивается Chromium
    // и превращает несколько кадров в секунды ожидания, поэтому здесь его нет.
    onReady?.()
  }, [onReady])

  const renderPage = () => {
    switch (activeTab) {
      case "home": return <HomePage />
      case "builds": return <InstancePage rootResetToken={sectionResetToken} />
      case "logs": return <LogsPage focus={logsFocus} />
      case "agent": return <AgentPage />
      case "stats": return <StatsPage />
      case "settings": return <SettingsPage initialTab={settingsTab} />
      case "accounts": return <AccountsPage />
      case "cloud": return <CloudPage rootResetToken={sectionResetToken} pendingThemeId={pendingCloudThemeId} onPendingThemeHandled={() => setPendingCloudThemeId(null)} />
      case "servers":
        if (selectedMcServer) {
          return <ServerDetailPage server={selectedMcServer} onBack={() => setSelectedMcServer(null)} onServerUpdated={setSelectedMcServer} />
        }
        return <ServersPage onSelectServer={setSelectedMcServer} rootResetToken={sectionResetToken} />
      case "skins": return <SkinsPage />
      default: return null
    }
  }

  return (
    <div data-ui="launcher-div-2" data-component="launcher" id="launcher-root" className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
      <ThemeInspector />
      <ThemeRuntime theme={registry.selectedTheme} />

      <main data-ui="launcher-main-1" id="launcher-main" className="flex-1 min-h-0 overflow-hidden">
        <div data-ui="launcher-div-3" id="launcher-content" data-page={activeTab} className="h-full p-4 overflow-hidden flex flex-col">
          <div data-ui="launcher-div-4" className="h-full w-full flex flex-col">
            {/*
              Граница ошибок вокруг страниц: без неё исключение в рендере
              размонтировало всё дерево, и вместо интерфейса оставался пустой
              (чёрный) экран. resetKey = активная вкладка: сбой одной страницы
              не «залипает» при переходе на другую.
            */}
            <ErrorBoundary resetKey={activeTab} label={`page:${activeTab}`}>
              <Suspense fallback={<PageFallback />}>
                {renderPage()}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </main>

      {/* Обои темы (если выбраны) — под контентом и под свечениями. */}
      <ThemeBackgroundLayer theme={registry.selectedTheme} />

      {/* Свечения фона берут цвет из темы (--ambient-*), а прозрачность — свою. */}
      <div data-ui="launcher-div-5" className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div data-ui="launcher-div-6"
          className="absolute top-0 left-1/4 w-96 h-96 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--ambient-primary) 8%, transparent) 0%, transparent 70%)",
          }}
        />
        <div data-ui="launcher-div-7"
          className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--ambient-accent) 8%, transparent) 0%, transparent 70%)",
          }}
        />
      </div>

      {showOnboarding && (
        <Suspense fallback={null}><OnboardingModal
          selectedTheme={registry.selectedThemeId}
          themes={registry.themes}
          onSelectTheme={registry.selectTheme}
          onFinish={finishOnboarding}
          onSkip={finishOnboarding}
        /></Suspense>
      )}

      {showDbFallbackBanner && (
        <div data-ui="launcher-div-8" className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/10 backdrop-blur-sm">
          <svg data-ui="launcher-svg-1" data-icon="launcher-svg-1" className="w-5 h-5 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path data-ui="launcher-path-1" strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3l9.5 16.5H2.5L12 3z" />
          </svg>
          <span data-ui="launcher-span-1" className="text-sm text-warning">
            {t("launcher.dbFallbackWarning")}
          </span>
          <button data-ui="launcher-button-1"
            onClick={() => setShowDbFallbackBanner(false)}
            className="ml-2 text-warning hover:text-warning flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
