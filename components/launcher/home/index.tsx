import { useEffect, useMemo, useRef, useState } from "react"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"
import { useHomeLaunch } from "@/src/hooks/use-home-launch"
import { useHomeVersions } from "@/src/hooks/use-home-versions"
import { useLoaderVersionOptions } from "@/src/hooks/use-loader-version-options"
import { HomeControls } from "./controls"
import { NewsSection } from "./news"

function getSavedLaunchPrefs(): { version?: string; modLoader?: string; loaderVersion?: string } {
  try {
    return {
      version: localStorage.getItem("xneon-launcher:lastVersion") ?? undefined,
      modLoader: localStorage.getItem("xneon-launcher:lastModLoader") ?? undefined,
      loaderVersion: localStorage.getItem("xneon-launcher:lastLoaderVersion") ?? undefined,
    }
  } catch {
    return {}
  }
}

function saveHomeSelectionPrefs(version: string, modLoader: string, loaderVersion?: string) {
  try {
    localStorage.setItem("xneon-launcher:lastVersion", version)
    localStorage.setItem("xneon-launcher:lastModLoader", modLoader)
    if (loaderVersion) localStorage.setItem("xneon-launcher:lastLoaderVersion", loaderVersion)
    else localStorage.removeItem("xneon-launcher:lastLoaderVersion")
  } catch {
    // ignore storage errors
  }
}

/**
 * Одноразовая заявка на авто-запуск сборки: её кладёт кнопка Play на карточке
 * сборки. Читаем и сразу снимаем — повторный запуск при следующем заходе на
 * главную не нужен.
 */
function consumeAutoLaunchBuild(): string | null {
  try {
    const value = localStorage.getItem("xneon-launcher:autoLaunchBuild")
    if (value) localStorage.removeItem("xneon-launcher:autoLaunchBuild")
    return value
  } catch {
    return null
  }
}

export function HomePage() {
  const saved = getSavedLaunchPrefs()
  const { accounts, activeAccount, setActiveAccount } = useAccounts()
  const [selectedModLoader, setSelectedModLoader] = useState(saved.modLoader ?? "vanilla")
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState(saved.loaderVersion ?? "")
  const [accountComboOpen, setAccountComboOpen] = useState(false)
  const { versions, versionsLoaded, selectedVersion, setSelectedVersion, buildIcons } = useHomeVersions(selectedModLoader, saved.version)
  const { loaderVersions, loaderVersionsLoaded, defaultLoaderVersion } = useLoaderVersionOptions(selectedModLoader, selectedVersion)
  const account = activeAccount ?? accounts[0]
  const activeAvatarUrl = useMemo(() => account ? getAvatarUrl(account, account.username) : "", [account])
  const accountAvatarUrls = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, getAvatarUrl(a, a.username)])), [accounts])
  const { isRunning, launchUi, launchDetails, handlePlay, handleQuickPlay } = useHomeLaunch({ account, selectedVersion, selectedModLoader, selectedLoaderVersion })

  // Play на карточке сборки привёл сюда с заявкой на запуск: ждём, пока выбор
  // сборки реально применится (список сборок грузится асинхронно), и стартуем
  // один раз. Если игра уже запущена — заявку просто гасим, без сюрпризов.
  const [autoLaunchBuild] = useState(() => consumeAutoLaunchBuild())
  const autoLaunchHandledRef = useRef(false)

  useEffect(() => {
    if (!autoLaunchBuild || autoLaunchHandledRef.current) return
    if (selectedModLoader !== "instance") return
    if (!versionsLoaded || selectedVersion !== autoLaunchBuild) return

    autoLaunchHandledRef.current = true
    if (isRunning || launchUi.isLaunching) return
    void handlePlay()
  }, [
    autoLaunchBuild,
    handlePlay,
    isRunning,
    launchUi.isLaunching,
    selectedModLoader,
    selectedVersion,
    versionsLoaded,
  ])

  useEffect(() => {
    if (selectedModLoader === "vanilla" || selectedModLoader === "instance") {
      if (selectedLoaderVersion !== "") setSelectedLoaderVersion("")
      return
    }

    if (!loaderVersionsLoaded) return
    if (selectedLoaderVersion && loaderVersions.some(option => option.value === selectedLoaderVersion)) return
    setSelectedLoaderVersion(defaultLoaderVersion ?? "")
  }, [loaderVersions, loaderVersionsLoaded, defaultLoaderVersion, selectedLoaderVersion, selectedModLoader])

  useEffect(() => {
    saveHomeSelectionPrefs(selectedVersion, selectedModLoader, selectedLoaderVersion)
  }, [selectedLoaderVersion, selectedModLoader, selectedVersion])

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 overflow-hidden items-start">
      <HomeControls
        accounts={accounts}
        account={account}
        accountComboOpen={accountComboOpen}
        setAccountComboOpen={setAccountComboOpen}
        setActiveAccount={setActiveAccount}
        versions={versions}
        versionsLoaded={versionsLoaded}
        selectedVersion={selectedVersion}
        setSelectedVersion={setSelectedVersion}
        buildIcons={buildIcons}
        selectedModLoader={selectedModLoader}
        setSelectedModLoader={setSelectedModLoader}
        loaderVersions={loaderVersions}
        loaderVersionsLoaded={loaderVersionsLoaded}
        selectedLoaderVersion={selectedLoaderVersion}
        setSelectedLoaderVersion={setSelectedLoaderVersion}
        activeAvatarUrl={activeAvatarUrl}
        accountAvatarUrls={accountAvatarUrls}
        launchUi={launchUi}
        launchDetails={launchDetails}
        isRunning={isRunning}
        onPlay={handlePlay}
        onQuickPlayLaunch={handleQuickPlay}
      />
      <div className="flex-1 overflow-hidden"><NewsSection /></div>
    </div>
  )
}
