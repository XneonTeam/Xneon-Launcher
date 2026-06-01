import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import { useLaunchControls } from "@/src/LaunchLogsContext"

type UseHomeLaunchParams = {
  account?: Account
  selectedVersion: string
  selectedModLoader: string
  selectedLoaderVersion?: string
}

function saveLastLaunchedPrefs(version: string, modLoader: string, loaderVersion?: string) {
  try {
    localStorage.setItem("xneon-launcher:lastVersion", version)
    localStorage.setItem("xneon-launcher:lastModLoader", modLoader)
    if (loaderVersion) localStorage.setItem("xneon-launcher:lastLoaderVersion", loaderVersion)
    else localStorage.removeItem("xneon-launcher:lastLoaderVersion")
  } catch {
    // ignore storage errors
  }
}

function normalizeJavaPath(javaPath?: string) {
  if (!javaPath) return javaPath
  return javaPath.replace(/(^|[\\/])javaw\.exe$/i, "$1java.exe")
}

function formatLoaderLabel(modLoader: string, loaderVersion?: string) {
  return loaderVersion ? `${modLoader} ${loaderVersion}` : modLoader
}

type LaunchSettings = {
  authlibEnabled: string | undefined
  savedJavaArgs: string | undefined
  savedMemoryMin: string | undefined
  savedMemoryMax: string | undefined
  savedUseCustomRes: string | undefined
  savedCustomW: string | undefined
  savedCustomH: string | undefined
  savedResLabel: string | undefined
}

async function loadLaunchSettings(): Promise<LaunchSettings> {
  const api = window.electronAPI
  if (!api) {
    return { authlibEnabled: undefined, savedJavaArgs: undefined, savedMemoryMin: undefined, savedMemoryMax: undefined, savedUseCustomRes: undefined, savedCustomW: undefined, savedCustomH: undefined, savedResLabel: undefined }
  }
  const [
    authlibEnabled,
    savedJavaArgs,
    savedMemoryMin,
    savedMemoryMax,
    savedUseCustomRes,
    savedCustomW,
    savedCustomH,
    savedResLabel,
  ] = await Promise.all([
    api.getSetting("authlibInjectorEnabled"),
    api.getSetting("javaArgs"),
    api.getSetting("memoryMin"),
    api.getSetting("memoryMax"),
    api.getSetting("useCustomResolution"),
    api.getSetting("customWidth"),
    api.getSetting("customHeight"),
    api.getSetting("selectedResolution"),
  ])
  return { authlibEnabled, savedJavaArgs, savedMemoryMin, savedMemoryMax, savedUseCustomRes, savedCustomW, savedCustomH, savedResLabel }
}

function resolveLaunchDimensions(settings: LaunchSettings): { width: number; height: number } {
  let launchWidth = 1280
  let launchHeight = 720
  if (settings.savedUseCustomRes === "true" && settings.savedCustomW && settings.savedCustomH) {
    launchWidth = parseInt(settings.savedCustomW, 10) || 1280
    launchHeight = parseInt(settings.savedCustomH, 10) || 720
  } else if (settings.savedResLabel) {
    const match = settings.savedResLabel.match(/(\d+)\s*x\s*(\d+)/i)
    if (match) {
      launchWidth = parseInt(match[1], 10) || 1280
      launchHeight = parseInt(match[2], 10) || 720
    }
  }
  return { width: launchWidth, height: launchHeight }
}

export function useHomeLaunch({ account, selectedVersion, selectedModLoader, selectedLoaderVersion }: UseHomeLaunchParams) {
  const { t } = useTranslation()
  const { isRunning, setIsRunning, clearLogs, addLog, launchUi, patchLaunchUi } = useLaunchControls()

  const launchInstance = useCallback(async (build: { name: string; version: string; modLoader: string; loaderVersion?: string; intentPath?: string }) => {
    if (!account || !window.electronAPI) return

    const usesSkinInjector = account.type === "xnskins" || account.type === "elyby"
    const normalizedJavaPath = normalizeJavaPath(await window.electronAPI.getSetting("javaPath"))
    const settings = await loadLaunchSettings()
    const { width, height } = resolveLaunchDimensions(settings)
    const intentPath = await window.electronAPI.getBuildIntentPath(build.name) ?? ""

    patchLaunchUi({
      isLaunching: true,
      progress: 0,
      status: t("launcherStatus.preparing"),
      phase: "launching",
      downloadedBytes: 0,
      totalBytes: null,
      currentFile: null,
      totalFiles: null,
      currentFileName: null,
    })
    clearLogs()
    addLog(`[Запуск] Сборка ${build.name} · ${formatLoaderLabel(build.modLoader, build.loaderVersion)} · ${account.username}`)

    const result = await window.electronAPI.launchMinecraft({
      version: build.version,
      modLoader: build.modLoader as "vanilla" | "forge" | "fabric" | "quilt" | "liteloader" | "optifine" | "neoforge",
      ...(build.loaderVersion ? { loaderVersion: build.loaderVersion } : {}),
      account: { type: account.type, username: account.username, uuid: account.uuid, accessToken: account.accessToken },
      memory: { min: settings.savedMemoryMin || "2G", max: settings.savedMemoryMax || "4G" },
      width,
      height,
      authlibInjectorEnabled: usesSkinInjector && settings.authlibEnabled !== "false",
      retroauthInjectorEnabled: usesSkinInjector,
      buildName: build.name,
      gameDir: intentPath,
      ...(normalizedJavaPath ? { javaPath: normalizedJavaPath } : {}),
      ...(settings.savedJavaArgs ? { javaArgs: settings.savedJavaArgs } : {}),
    })

    patchLaunchUi(result.success
      ? { isLaunching: false, phase: "idle", progress: 100, status: t("launcherStatus.running") }
      : { isLaunching: false, status: result.error ?? "Ошибка запуска" })
    if (!result.success) addLog(`[Лаунчер] ${result.error ?? "Ошибка запуска"}`, "error")
    if (result.success) {
      setIsRunning(true)
      saveLastLaunchedPrefs(build.name, "instance")
    }
  }, [account, addLog, clearLogs, patchLaunchUi, setIsRunning, t])

  const launchVanilla = useCallback(async () => {
    if (!account || !window.electronAPI) return

    const usesSkinInjector = account.type === "xnskins" || account.type === "elyby"
    const normalizedJavaPath = normalizeJavaPath(await window.electronAPI.getSetting("javaPath"))
    const settings = await loadLaunchSettings()
    const { width, height } = resolveLaunchDimensions(settings)

    patchLaunchUi({
      isLaunching: true,
      progress: 0,
      status: t("launcherStatus.preparing"),
      phase: "launching",
      downloadedBytes: 0,
      totalBytes: null,
      currentFile: null,
      totalFiles: null,
      currentFileName: null,
    })
    clearLogs()
    addLog(`[Запуск] Minecraft ${selectedVersion} · ${formatLoaderLabel(selectedModLoader, selectedLoaderVersion)} · ${account.username}`)

    const result = await window.electronAPI.launchMinecraft({
      version: selectedVersion,
      modLoader: selectedModLoader as "vanilla" | "forge" | "fabric" | "quilt" | "liteloader" | "optifine" | "neoforge",
      ...(selectedLoaderVersion ? { loaderVersion: selectedLoaderVersion } : {}),
      account: { type: account.type, username: account.username, uuid: account.uuid, accessToken: account.accessToken },
      memory: { min: settings.savedMemoryMin || "2G", max: settings.savedMemoryMax || "4G" },
      width,
      height,
      authlibInjectorEnabled: usesSkinInjector && settings.authlibEnabled !== "false",
      retroauthInjectorEnabled: usesSkinInjector,
      ...(normalizedJavaPath ? { javaPath: normalizedJavaPath } : {}),
      ...(settings.savedJavaArgs ? { javaArgs: settings.savedJavaArgs } : {}),
    })

    patchLaunchUi(result.success
      ? { isLaunching: false, phase: "idle", progress: 100, status: t("launcherStatus.running") }
      : { isLaunching: false, status: result.error ?? "Ошибка запуска" })
    if (!result.success) addLog(`[Лаунчер] ${result.error ?? "Ошибка запуска"}`, "error")
    if (result.success) {
      setIsRunning(true)
      saveLastLaunchedPrefs(selectedVersion, selectedModLoader, selectedLoaderVersion)
    }
  }, [account, addLog, clearLogs, patchLaunchUi, selectedLoaderVersion, selectedModLoader, selectedVersion, setIsRunning, t])

  const handlePlay = useCallback(async () => {
    if (isRunning) {
      return await window.electronAPI?.stopMinecraft()
    }
    if (!account || !window.electronAPI) return

    if (selectedModLoader === "instance") {
      if (!selectedVersion) {
        patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Не выбрана сборка" })
        addLog("[Лаунчер] Не выбрана сборка", "error")
        return
      }

      const builds = await window.electronAPI.loadBuilds() ?? []
      const build = builds.find((item) => item.name === selectedVersion)
      if (!build) {
        patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Сборка не найдена" })
        addLog(`[Лаунчер] Сборка "${selectedVersion}" не найдена`, "error")
        return
      }

      await launchInstance(build)
      return
    }

    if (!selectedVersion) {
      patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Не выбрана версия" })
      addLog("[Лаунчер] Не выбрана версия Minecraft", "error")
      return
    }

    await launchVanilla()
  }, [isRunning, account, selectedModLoader, selectedVersion, patchLaunchUi, addLog, launchInstance, launchVanilla])

  const launchDetails = useMemo(() => {
    const parts: string[] = []
    if (launchUi.currentFile !== null && launchUi.totalFiles !== null && launchUi.totalFiles > 0) {
      parts.push(`${Math.min(launchUi.currentFile, launchUi.totalFiles)} / ${launchUi.totalFiles} файлов`)
    }
    if (launchUi.currentFileName) {
      parts.push(launchUi.currentFileName)
    }
    return parts.join(" · ")
  }, [launchUi.currentFile, launchUi.currentFileName, launchUi.totalFiles])

  return { isRunning, launchUi, launchDetails, handlePlay }
}
