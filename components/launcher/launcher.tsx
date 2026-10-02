import { Suspense, lazy, useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { HomePage } from "./home-page"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { LogsPage } from "./logs-page"
import { SettingsPage } from "./settings"
import { AccountsPage } from "./accounts-page"
import { CloudPage } from "./cloud"
import { ServersPage } from "./servers-page"
import { ServerDetailPage } from "./server-detail-page"
import { StatsPage } from "./stats-page"
import { OnboardingModal } from "./onboarding-modal"
import { Sidebar, type TabId } from "./sidebar"
import { Spinner } from "./instance/spinner"
import { applyTheme, presetThemes } from "./settings/data"
import type { McServerInfo } from "@xnlc/types"

/**
 * Code-splitting только там, где он реально что-то даёт.
 *
 * В стартовом графе лежат лёгкие страницы (логи, статистика, настройки,
 * аккаунты, облако, серверы): их модули грузятся один раз вместе со стартом,
 * поэтому переход на вкладку мгновенный. Lazy оставлен для двух страниц с
 * по-настоящему тяжёлыми зависимостями — скинов (three + skinview3d, ~505 КБ)
 * и сборок (react-markdown/rehype и вся система контента, ~280 КБ + 284 КБ).
 *
 * Почему не lazy на всё: каждый lazy-заход — это водопад запросов
 * (чанк страницы → её импорты). Замер первого входа в «Настройки» после
 * перезагрузки давал ~330 мс при 11 запросах модулей, тогда как сами модули
 * крошечные. Профит от такого дробления нулевой, а задержка заметная.
 */
const InstancePage = lazy(() => import("./instance").then((m) => ({ default: m.InstancePage })))
/**
 * Страница скинов тянет three.js (~505 КБ) и включает обе вкладки — «Избранное»
 * и «Библиотеку» каталога Laby, поэтому грузится лениво одним чанком.
 */
const SkinsPage = lazy(() => import("./skins-page").then((m) => ({ default: m.SkinsPage })))

/**
 * Прогрев тяжёлых lazy-страниц в простое: к моменту клика чанк уже в кеше,
 * поэтому переход быстрый, а старт не утяжеляется (модули не в стартовом графе).
 */
function prefetchHeavyPages(): void {
  const load = () => {
    void import("./instance").catch(() => {})
    void import("./skins-page").catch(() => {})
  }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (typeof idle === "function") {
    idle(load, { timeout: 3000 })
  } else {
    window.setTimeout(load, 1500)
  }
}

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
    <div className="flex h-full w-full items-center justify-center" aria-busy="true" aria-live="polite">
      <Spinner />
    </div>
  )
}

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
  // Подсказка для страницы логов: открыта из-за краша игры.
  const [logsFocus, setLogsFocus] = useState<{ crash: boolean; at: number } | null>(null)
  /**
   * Счётчик «вернись к корню раздела». Растёт при повторном клике по уже активному
   * пункту меню: страницы, у которых есть вложенный экран (карточка сборки,
   * файловый браузер облака), по нему возвращаются на свой список.
   */
  const [sectionResetToken, setSectionResetToken] = useState(0)

  useEffect(() => {
    // Every page is mounted in this render; notify the parent once the frame
    // has committed so the loading overlay can fade out.
    const id = window.setTimeout(() => onReady?.(), 0)
    return () => window.clearTimeout(id)
  }, [onReady])

  // Тяжёлые страницы прогреваем в простое — переход на них не ждёт сеть.
  useEffect(() => {
    prefetchHeavyPages()
  }, [])

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

    window.addEventListener("launcher:onboarding-reset", handleResetOnboarding)
    window.addEventListener("launcher:open-home", handleOpenHome)
    window.addEventListener("launcher:open-logs", handleOpenLogs)
    return () => {
      window.removeEventListener("launcher:onboarding-reset", handleResetOnboarding)
      window.removeEventListener("launcher:open-home", handleOpenHome)
      window.removeEventListener("launcher:open-logs", handleOpenLogs)
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
    onReady?.()
  }, [onReady])

  const renderPage = () => {
    switch (activeTab) {
      case "home": return <HomePage />
      case "builds": return <InstancePage rootResetToken={sectionResetToken} />
      case "logs": return <LogsPage focus={logsFocus} />
      case "stats": return <StatsPage />
      case "settings": return <SettingsPage />
      case "accounts": return <AccountsPage />
      case "cloud": return <CloudPage rootResetToken={sectionResetToken} />
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
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full p-4 overflow-hidden flex flex-col">
          <div className="h-full w-full flex flex-col">
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
