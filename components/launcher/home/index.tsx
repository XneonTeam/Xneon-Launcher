import { useCallback, useEffect, useMemo, useState } from "react"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"
import { useHomeLaunch } from "@/src/hooks/use-home-launch"
import { useHomeVersions } from "@/src/hooks/use-home-versions"
import { useLoaderVersionOptions } from "@/src/hooks/use-loader-version-options"
import { loadLaunchSettings, resolveLaunchDimensions } from "@/src/hooks/use-build-launch"
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

export function HomePage() {
  const saved = getSavedLaunchPrefs()
  const { accounts, activeAccount, setActiveAccount } = useAccounts()
  const [selectedModLoader, setSelectedModLoader] = useState(saved.modLoader ?? "vanilla")
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState(saved.loaderVersion ?? "")
  const [accountComboOpen, setAccountComboOpen] = useState(false)
  const { versions, versionsLoaded, selectedVersion, setSelectedVersion } = useHomeVersions(selectedModLoader, saved.version)
  const { loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion } = useLoaderVersionOptions(selectedModLoader, selectedVersion)
  const account = activeAccount ?? accounts[0]
  const activeAvatarUrl = useMemo(() => account ? getAvatarUrl(account, account.username) : "", [account])
  const accountAvatarUrls = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, getAvatarUrl(a, a.username)])), [accounts])
  const { isRunning, launchUi, launchDetails, handlePlay } = useHomeLaunch({ account, selectedVersion, selectedModLoader, selectedLoaderVersion })

  const handleQuickPlayLaunch = useCallback(async (type: "singleplayer" | "multiplayer", address: string) => {
    if (!account || !window.electronAPI || isRunning) return

    const settings = await loadLaunchSettings()
    const { width, height } = resolveLaunchDimensions(settings)

    const quickPlayParams = type === "singleplayer"
      ? { quickPlaySingleplayer: address }
      : { quickPlayMultiplayer: address }

    const isInstance = selectedModLoader === "instance"
    const buildName = isInstance ? selectedVersion : undefined
    let mcVersion = selectedVersion
    let modLoader = selectedModLoader
    let loaderVersion: string | undefined
    let build: {
      name: string; version: string; modLoader: string; loaderVersion?: string
      preLaunchCommand?: string; postLaunchCommand?: string; wrapperCommand?: string; customEnv?: string
    } | undefined

    if (isInstance && buildName) {
      const builds = await window.electronAPI.loadBuilds() ?? []
      build = builds.find(b => b.name === buildName)
      if (!build) return
      mcVersion = build.version
      modLoader = build.modLoader
      loaderVersion = build.loaderVersion
    }

    const intentPath = buildName ? await window.electronAPI.getBuildIntentPath(buildName) : undefined

    const envRecord: Record<string, string> = {}
    for (const line of (build?.customEnv ?? "").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq > 0) envRecord[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }

    const result = await window.electronAPI.launchMinecraft({
      version: mcVersion,
      modLoader: modLoader as "vanilla" | "forge" | "fabric" | "quilt" | "liteloader" | "optifine" | "neoforge",
      ...(loaderVersion ? { loaderVersion } : {}),
      account: { type: account.type, username: account.username, uuid: account.uuid, accessToken: account.accessToken },
      memory: { min: settings.savedMemoryMin || "512M", max: settings.savedMemoryMax || "4G" },
      width,
      height,
      buildName,
      gameDir: intentPath,
      ...quickPlayParams,
      ...(build?.preLaunchCommand ? { preLaunchCommand: build.preLaunchCommand } : {}),
      ...(build?.postLaunchCommand ? { postLaunchCommand: build.postLaunchCommand } : {}),
      ...(build?.wrapperCommand ? { wrapperCommand: build.wrapperCommand } : {}),
      ...(Object.keys(envRecord).length > 0 ? { customEnv: envRecord } : {}),
    })

    if (result.success) {
      // Refresh is handled by the running state
    }
  }, [account, isRunning, selectedModLoader, selectedVersion])

  useEffect(() => {
    if (selectedModLoader === "vanilla" || selectedModLoader === "instance") {
      if (selectedLoaderVersion !== "") setSelectedLoaderVersion("")
      return
    }

    if (!loaderVersionsLoaded) return
    if (loaderVersions.some(option => option.value === selectedLoaderVersion)) return
    setSelectedLoaderVersion(recommendedLoaderVersion ?? "")
  }, [loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion, selectedLoaderVersion, selectedModLoader])

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
        onQuickPlayLaunch={handleQuickPlayLaunch}
      />
      <div className="flex-1 overflow-hidden"><NewsSection /></div>
    </div>
  )
}
