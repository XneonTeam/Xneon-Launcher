import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import { useLaunchControls } from "@/src/LaunchLogsContext"
import { getStageLabel, INITIAL_LAUNCH_UI_STATE, LAUNCH_RE, RUNNING_RE, type LaunchUiState } from "@/lib/home-page-shared"

type UseHomeLaunchParams = { account?: Account; selectedVersion: string; selectedModLoader: string }

function normalizeJavaPath(javaPath?: string) {
  if (!javaPath) return javaPath
  return javaPath.replace(/(^|[\\/])javaw\.exe$/i, "$1java.exe")
}

export function useHomeLaunch({ account, selectedVersion, selectedModLoader }: UseHomeLaunchParams) {
  const { t } = useTranslation()
  const [launchUi, setLaunchUi] = useState<LaunchUiState>(INITIAL_LAUNCH_UI_STATE)
  const launchUiRef = useRef(launchUi)
  const pendingLaunchPatchRef = useRef<Partial<LaunchUiState> | null>(null)
  const launchFrameRef = useRef<number | null>(null)
  const { isRunning, setIsRunning, clearLogs, addLog } = useLaunchControls()
  const isRunningRef = useRef(isRunning)

  const patchLaunchUi = useCallback((patch: Partial<LaunchUiState>) => {
    const optimistic = { ...launchUiRef.current, ...patch }
    const hasChanges = Object.keys(patch).some(key => {
      const typedKey = key as keyof LaunchUiState
      return !Object.is(launchUiRef.current[typedKey], optimistic[typedKey])
    })
    if (!hasChanges) return
    launchUiRef.current = optimistic
    pendingLaunchPatchRef.current = { ...pendingLaunchPatchRef.current, ...patch }
    if (launchFrameRef.current !== null) return
    launchFrameRef.current = requestAnimationFrame(() => {
      launchFrameRef.current = null
      const pending = pendingLaunchPatchRef.current
      pendingLaunchPatchRef.current = null
      if (!pending) return
      setLaunchUi(prev => {
        const next = { ...prev, ...pending }
        const changed = Object.keys(pending).some(key => {
          const typedKey = key as keyof LaunchUiState
          return !Object.is(prev[typedKey], next[typedKey])
        })
        if (!changed) return prev
        launchUiRef.current = next
        return next
      })
    })
  }, [])

  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])
  useEffect(() => () => { if (launchFrameRef.current !== null) cancelAnimationFrame(launchFrameRef.current) }, [])

  useEffect(() => {
    void window.electronAPI?.isMinecraftRunning().then(running => {
      setIsRunning(!!running)
      if (running) patchLaunchUi({ isLaunching: false, phase: "idle", progress: 100, status: t("launcherStatus.running") })
    })
  }, [patchLaunchUi, setIsRunning, t])

  useEffect(() => {
    const offProgress = window.electronAPI?.onMinecraftProgress((progress) => {
      const patch: Partial<LaunchUiState> = {}
      if (typeof progress.task === "number" && typeof progress.total === "number" && progress.total > 0) {
        patch.progress = Math.round((progress.task / progress.total) * 100)
        patch.phase = "installing"
      }
      if (progress.type) patch.status = `Загрузка: ${progress.type}`
      patchLaunchUi(patch)
    })
    const offDownload = window.electronAPI?.onMinecraftDownloadStatus((progress) => {
      const patch: Partial<LaunchUiState> = { status: getStageLabel(progress.type, progress.installationPhase) }
      if (typeof progress.percent === "number") { patch.progress = progress.percent; patch.phase = "installing" }
      if (typeof progress.downloadedBytes === "number") patch.downloadedBytes = progress.downloadedBytes
      else if (typeof progress.downloaded === "number") patch.downloadedBytes = progress.downloaded
      if (typeof progress.total === "number" && progress.total > 0) patch.totalBytes = progress.total
      if (typeof progress.currentFile === "number") patch.currentFile = progress.currentFile
      if (typeof progress.totalFiles === "number") patch.totalFiles = progress.totalFiles
      patchLaunchUi(patch)
    })
    const offJava = window.electronAPI?.onMinecraftJavaProgress((progress) => {
      patchLaunchUi({ progress: progress.percent, status: progress.message, phase: "installing" })
    })
    const offDebug = window.electronAPI?.onMinecraftDebug((message) => {
      if (message && (launchUiRef.current.isLaunching || LAUNCH_RE.test(message))) {
        patchLaunchUi({ status: message, ...(LAUNCH_RE.test(message) ? { phase: "launching" as const } : {}) })
      }
    })
    const offData = window.electronAPI?.onMinecraftData((message) => {
      if (message && RUNNING_RE.test(message)) {
        if (!isRunningRef.current) { setIsRunning(true); isRunningRef.current = true }
        patchLaunchUi({ isLaunching: false, progress: 100, status: "Игра запущена", phase: "idle" })
      }
    })
    const offClose = window.electronAPI?.onMinecraftClose(() => { patchLaunchUi(INITIAL_LAUNCH_UI_STATE); setIsRunning(false) })
    return () => { offProgress?.(); offDownload?.(); offJava?.(); offDebug?.(); offData?.(); offClose?.() }
  }, [patchLaunchUi, setIsRunning])

  const handlePlay = useCallback(async () => {
    if (isRunning) return await window.electronAPI?.stopMinecraft()
    if (!account || !window.electronAPI) return
    if (!selectedVersion) {
      patchLaunchUi({ isLaunching: false, phase: "idle", progress: null, status: "Не выбрана версия Minecraft" })
      addLog("[Лаунчер] Не выбрана версия Minecraft", "error")
      return
    }

    const normalizedJavaPath = normalizeJavaPath(await window.electronAPI.getSetting("javaPath"))
    patchLaunchUi({
      isLaunching: true, progress: 0, status: t("launcherStatus.preparing"), phase: "launching",
      downloadedBytes: 0, totalBytes: null, currentFile: null, totalFiles: null,
    })
    clearLogs()
    addLog(`[Запуск] Minecraft ${selectedVersion} · ${selectedModLoader} · ${account.username}`)
    const [authlibEnabled, savedJavaArgs, savedUseCustomRes, savedCustomW, savedCustomH, savedResLabel] = await Promise.all([
      window.electronAPI.getSetting("authlibInjectorEnabled"),
      window.electronAPI.getSetting("javaArgs"),
      window.electronAPI.getSetting("useCustomResolution"),
      window.electronAPI.getSetting("customWidth"),
      window.electronAPI.getSetting("customHeight"),
      window.electronAPI.getSetting("selectedResolution"),
    ])

    let launchWidth = 1280
    let launchHeight = 720
    if (savedUseCustomRes === "true" && savedCustomW && savedCustomH) {
      launchWidth = parseInt(savedCustomW, 10) || 1280
      launchHeight = parseInt(savedCustomH, 10) || 720
    } else if (savedResLabel) {
      const match = savedResLabel.match(/(\d+)\s*x\s*(\d+)/i)
      if (match) { launchWidth = parseInt(match[1], 10) || 1280; launchHeight = parseInt(match[2], 10) || 720 }
    }

    const result = await window.electronAPI.launchMinecraft({
      version: selectedVersion,
      modLoader: selectedModLoader as "vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "optifine",
      account: { type: account.type, username: account.username, uuid: account.uuid, accessToken: account.accessToken },
      memory: { min: "2G", max: "4G" },
      width: launchWidth,
      height: launchHeight,
      authlibInjectorEnabled: authlibEnabled !== "false",
      ...(normalizedJavaPath ? { javaPath: normalizedJavaPath } : {}),
      ...(savedJavaArgs ? { javaArgs: savedJavaArgs } : {}),
    })

    patchLaunchUi(result.success
      ? { isLaunching: false, phase: "idle", progress: 100, status: t("launcherStatus.running") }
      : { isLaunching: false, status: result.error ?? "Ошибка запуска" })
    if (!result.success) addLog(`[Лаунчер] ${result.error ?? "Ошибка запуска"}`, "error")
    if (result.success) setIsRunning(true)
  }, [account, addLog, clearLogs, isRunning, patchLaunchUi, selectedModLoader, selectedVersion, setIsRunning, t])

  const launchDetails = useMemo(() => {
    const parts: string[] = []
    if (launchUi.currentFile !== null && launchUi.totalFiles !== null && launchUi.totalFiles > 0) {
      parts.push(`${Math.min(launchUi.currentFile, launchUi.totalFiles)} / ${launchUi.totalFiles} файлов`)
    }
    return parts.join(" · ")
  }, [launchUi.currentFile, launchUi.totalFiles])

  return { isRunning, launchUi, launchDetails, handlePlay }
}
