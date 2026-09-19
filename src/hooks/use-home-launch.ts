import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import { useLaunchControls } from "@/src/LaunchLogsContext"
import { useBuildLaunch, saveLastLaunchedPrefs, formatLoaderLabel, normalizeJavaPath, loadLaunchSettings, resolveLaunchDimensions, toQuickPlayParams, type BuildLaunchParams, type QuickPlayLaunchRequest } from "@/src/hooks/use-build-launch"

type UseHomeLaunchParams = {
  account?: Account
  selectedVersion: string
  selectedModLoader: string
  selectedLoaderVersion?: string
}

export function useHomeLaunch({ account, selectedVersion, selectedModLoader, selectedLoaderVersion }: UseHomeLaunchParams) {
  const { t } = useTranslation()
  const { isRunning, setIsRunning, clearLogs, addLog, launchUi, patchLaunchUi, gameReady } = useLaunchControls()
  const { launchInstance } = useBuildLaunch({ account })

  const launchVanilla = useCallback(async (quickPlay?: QuickPlayLaunchRequest) => {
    if (!account || !window.electronAPI) return

    const usesSkinInjector = account.type === "xnskins" || account.type === "elyby"
    const normalizedJavaPath = normalizeJavaPath(await window.electronAPI.getSetting("javaPath"))
    const settings = await loadLaunchSettings()
    const { width, height } = resolveLaunchDimensions(settings)
    const server = settings.savedAutoJoinServer === "true" ? (settings.savedServer ?? "") : ""
    const serverPort = settings.savedServerPort ?? ""
    // Быстрая игра из карточки важнее авто-подключения из настроек.
    const quickPlayParams = quickPlay
      ? toQuickPlayParams(quickPlay)
      : (server.trim() ? { quickPlayMultiplayer: `${server.trim()}:${serverPort.trim() || "25565"}` } : {})

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
      memory: { min: settings.savedMemoryMin || "512M", max: settings.savedMemoryMax || "4G" },
      width,
      height,
      authlibInjectorEnabled: usesSkinInjector && settings.authlibEnabled !== "false",
      retroauthInjectorEnabled: usesSkinInjector,
      ...(normalizedJavaPath ? { javaPath: normalizedJavaPath } : {}),
      ...(settings.savedJavaArgs ? { javaArgs: settings.savedJavaArgs } : {}),
      ...quickPlayParams,
    })

    patchLaunchUi(result.success
      ? { isLaunching: false, phase: "idle", progress: 100, status: t("launcherStatus.starting") }
      : { isLaunching: false, status: result.error ?? "Ошибка запуска" })
    if (!result.success) addLog(`[Лаунчер] ${result.error ?? "Ошибка запуска"}`, "error")
    if (result.success) {
      setIsRunning(true)
      saveLastLaunchedPrefs(selectedVersion, selectedModLoader, selectedLoaderVersion)
      const afterLaunch = await window.electronAPI?.getSetting("afterLaunch")
      if (afterLaunch === "minimize") window.electronAPI?.minimize()
      else if (afterLaunch === "close") window.electronAPI?.close()
    }
  }, [account, addLog, clearLogs, patchLaunchUi, selectedLoaderVersion, selectedModLoader, selectedVersion, setIsRunning, t])

  /**
   * Проверяет, что именно запускаем: сборку или ванильную версию.
   * Возвращает null, если выбор некорректен (ошибка уже показана в UI).
   */
  const resolveLaunchTarget = useCallback(async (): Promise<{ build?: BuildLaunchParams } | null> => {
    if (!window.electronAPI) return null

    if (selectedModLoader === "instance") {
      if (!selectedVersion) {
        patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Не выбрана сборка" })
        addLog("[Лаунчер] Не выбрана сборка", "error")
        return null
      }

      const builds = await window.electronAPI.loadBuilds() ?? []
      const build = builds.find((item) => item.name === selectedVersion)
      if (!build) {
        patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Сборка не найдена" })
        addLog(`[Лаунчер] Сборка "${selectedVersion}" не найдена`, "error")
        return null
      }

      return { build }
    }

    if (!selectedVersion) {
      patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Не выбрана версия" })
      addLog("[Лаунчер] Не выбрана версия Minecraft", "error")
      return null
    }

    return {}
  }, [addLog, patchLaunchUi, selectedModLoader, selectedVersion])

  const handlePlay = useCallback(async () => {
    if (isRunning) {
      // Процесс стартует раньше, чем открывается окно игры: пока игра не
      // подтвердила готовность, кнопка — «Запускается...», и клик ничего не гасит.
      if (!gameReady) return
      return await window.electronAPI?.stopMinecraft()
    }
    // Пока идёт запуск/установка, повторный клик ничего не делает: раньше он
    // уходил во второй launch и два JVM дрались за одну папку инстанса.
    if (launchUi.isLaunching) return
    if (!account || !window.electronAPI) return

    const target = await resolveLaunchTarget()
    if (!target) return

    if (target.build) {
      await launchInstance(target.build)
      return
    }

    await launchVanilla()
  }, [isRunning, gameReady, launchUi.isLaunching, account, resolveLaunchTarget, launchInstance, launchVanilla])

  /**
   * Запуск из карточки быстрой игры. Идёт тем же путём, что и обычная кнопка
   * «Играть»: с прогрессом, логами, статусом запущенной игры и настройками
   * Java/инъекторов — отличается только адресом подключения.
   */
  const handleQuickPlay = useCallback(async (type: "singleplayer" | "multiplayer", address: string) => {
    if (isRunning || launchUi.isLaunching || !account || !window.electronAPI) return

    const target = await resolveLaunchTarget()
    if (!target) return

    const quickPlay: QuickPlayLaunchRequest = { type, address }

    if (target.build) {
      await launchInstance(target.build, { quickPlay })
      return
    }

    await launchVanilla(quickPlay)
  }, [isRunning, launchUi.isLaunching, account, resolveLaunchTarget, launchInstance, launchVanilla])

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

  return { isRunning, launchUi, launchDetails, handlePlay, handleQuickPlay }
}
