import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react"
import { useTranslation } from "react-i18next"
import { useActivityCenter } from "./ActivityCenterContext"
import { getStageLabel, INITIAL_LAUNCH_UI_STATE, LAUNCH_RE, RUNNING_RE, type LaunchUiState } from "@/lib/home-page-shared"

export type LogLevel = "info" | "warn" | "error" | "debug" | "game" | "launcher"

export interface LogEntry {
  id: number
  level: LogLevel
  text: string
  ts: number
}

interface LaunchLogsStateValue {
  logs: LogEntry[]
}

interface LaunchControlsValue {
  addLog: (text: string, level?: LogLevel) => void
  clearLogs: () => void
  isRunning: boolean
  setIsRunning: (v: boolean) => void
  launchUi: LaunchUiState
  patchLaunchUi: (patch: Partial<LaunchUiState>) => void
  resetLaunchUi: () => void
}

const LaunchLogsStateContext = createContext<LaunchLogsStateValue | null>(null)
const LaunchControlsContext = createContext<LaunchControlsValue | null>(null)

let nextLogId = 0
const MAX_LOGS = 2000
const LOG_BATCH_SIZE = 50
const NOISY_DEBUG_PATTERNS = [
  "Worker environment:",
  "Worker gameDir:",
  "Worker options:",
  "XNLC instance created and java runner configured to pipe output",
  "Calling XNLC launch pipeline",
  "XNLC launch pipeline resolved",
  "Launch command prepared:",
  "[LibrariesManager]",
  "[NativesExtractor]",
  "[LaunchBuilder]",
  "Preparation plan for",
  "Resolved selection",
  "Launching CrashAssistantApp",
  "Base version metadata resolved",
  "Launch version resolved",
  "Final resolved JSON",
  "Libraries resolved count=",
  "Client jar ensured for",
  "Assets download stage completed",
  "Classpath entries:",
  "JVM args:",
  "Game args:",
]

function normalizeForDedup(text: string): string {
  return text.replace(/^(\[XNLC\]\s*)+/, "").trim()
}

function shouldIgnoreDebugLog(text: string): boolean {
  const normalized = normalizeForDedup(text)
  if (!normalized) return true
  return NOISY_DEBUG_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function shouldPromoteDebugStatus(text: string, phase: LaunchUiState["phase"]): boolean {
  if (!text || shouldIgnoreDebugLog(text)) return false
  if (phase === "installing") {
    return LAUNCH_RE.test(text)
  }
  return true
}

function classify(text: string): LogLevel {
  const normalized = text.toLowerCase()
  if (/^\[(xnlc|minecraft|launcher|java)\]/i.test(text)) return "launcher"
  if (/\[лаунчер\]|\[launcher\]/i.test(normalized)) return "launcher"
  if (/^\[.*\] \[.*\/ERROR\]: /.test(text)) return "error"
  if (/^\[.*\] \[.*\/WARN\]: /.test(text)) return "warn"
  if (/^\[.*\] \[.*\/DEBUG\]: /.test(text)) return "debug"
  if (/^\[.*\] \[.*\]: /.test(text)) return "game"
  if (/\[fatal\]|fatal:|\b(fatal error)\b|\[ошибка\]/i.test(normalized)) return "error"
  if (/\[error\]|error:|\/error\]|exception|failed|unable to|crashed|crash/i.test(normalized)) return "error"
  if (/\[warn\]|warning:|warn:|\/warn\]|\/warning\]/i.test(normalized)) return "warn"
  if (/\[debug\]|debug:|\[trace\]|trace:/i.test(normalized)) return "debug"
  if (/^\t(at |... )/.test(text)) return "error"
  if (/^(Caused by:|... \d+ more)/.test(text)) return "error"
  if (/\b(Exception|Error)\b/.test(text) && !/^\[.*\]/.test(text)) return "error"
  return "info"
}

export function LaunchLogsProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const { pushNotification, upsertLiveNotification, removeLiveNotification } = useActivityCenter()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [launchUi, setLaunchUi] = useState<LaunchUiState>(INITIAL_LAUNCH_UI_STATE)
  const pendingLogsRef = useRef<LogEntry[]>([])
  const flushTimeoutRef = useRef<number | null>(null)
  const lastNormalizedLogRef = useRef("")
  const launchUiRef = useRef(launchUi)
  const pendingLaunchPatchRef = useRef<Partial<LaunchUiState> | null>(null)
  const launchFrameRef = useRef<number | null>(null)
  const isRunningRef = useRef(isRunning)
  const runningNotificationSentRef = useRef(false)

  const flushPendingLogs = useCallback(() => {
    flushTimeoutRef.current = null
    const pending = pendingLogsRef.current
    if (pending.length === 0) return
    pendingLogsRef.current = []
    setLogs(prev => (
      pending.length >= MAX_LOGS
        ? pending.slice(-MAX_LOGS)
        : [...prev, ...pending].slice(-MAX_LOGS)
    ))
  }, [])

  const addLog = useCallback((text: string, level?: LogLevel) => {
    const normalized = normalizeForDedup(text)
    if (!normalized) return
    if (lastNormalizedLogRef.current === normalized) return
    lastNormalizedLogRef.current = normalized

    pendingLogsRef.current.push({
      id: ++nextLogId,
      level: level ?? classify(text),
      text,
      ts: Date.now(),
    })

    if (pendingLogsRef.current.length >= LOG_BATCH_SIZE) {
      if (flushTimeoutRef.current !== null) {
        window.clearTimeout(flushTimeoutRef.current)
      }
      flushPendingLogs()
      return
    }

    if (flushTimeoutRef.current === null) {
      flushTimeoutRef.current = window.setTimeout(flushPendingLogs, 32)
    }
  }, [flushPendingLogs])

  const clearLogs = useCallback(() => {
    pendingLogsRef.current = []
    lastNormalizedLogRef.current = ""
    if (flushTimeoutRef.current !== null) {
      window.clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
    setLogs([])
  }, [])

  const patchLaunchUi = useCallback((patch: Partial<LaunchUiState>) => {
    const optimistic = { ...launchUiRef.current, ...patch }
    const hasChanges = Object.keys(patch).some((key) => {
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

      setLaunchUi((prev) => {
        const next = { ...prev, ...pending }
        const changed = Object.keys(pending).some((key) => {
          const typedKey = key as keyof LaunchUiState
          return !Object.is(prev[typedKey], next[typedKey])
        })
        if (!changed) return prev
        launchUiRef.current = next
        return next
      })
    })
  }, [])

  const resetLaunchUi = useCallback(() => {
    if (launchFrameRef.current !== null) {
      cancelAnimationFrame(launchFrameRef.current)
      launchFrameRef.current = null
    }
    pendingLaunchPatchRef.current = null
    launchUiRef.current = INITIAL_LAUNCH_UI_STATE
    setLaunchUi(INITIAL_LAUNCH_UI_STATE)
  }, [])

  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    const isActiveLaunch = launchUi.isLaunching || launchUi.phase === "installing" || launchUi.phase === "launching"
    if (!isActiveLaunch) {
      removeLiveNotification("minecraft-launch")
      return
    }

    upsertLiveNotification("minecraft-launch", {
      kind: "progress",
      source: "launch",
      title: launchUi.phase === "installing" ? "Minecraft setup in progress" : "Minecraft launch in progress",
      message: launchUi.status || "Preparing launcher activity...",
      progress: typeof launchUi.progress === "number" ? Math.max(0, Math.min(100, Math.round(launchUi.progress))) : null,
      itemName: launchUi.currentFileName ?? null,
      busy: true,
    })
  }, [
    launchUi.currentFileName,
    launchUi.isLaunching,
    launchUi.phase,
    launchUi.progress,
    launchUi.status,
    removeLiveNotification,
    upsertLiveNotification,
  ])

  useEffect(() => {
    void window.electronAPI?.isMinecraftRunning().then((running) => {
      setIsRunning(!!running)
      if (running) {
        patchLaunchUi({
          isLaunching: false,
          phase: "idle",
          progress: 100,
          status: t("launcherStatus.running"),
        })
      }
    })
  }, [patchLaunchUi, t])

  useEffect(() => {
    const offProgress = window.electronAPI?.onMinecraftProgress?.((progress) => {
      const patch: Partial<LaunchUiState> = {}
      if (typeof progress.task === "number" && typeof progress.total === "number" && progress.total > 0) {
        patch.progress = Math.round((progress.task / progress.total) * 100)
        patch.phase = "installing"
      }
      if (progress.type || progress.installationPhase) {
        patch.status = getStageLabel(progress.type, progress.installationPhase)
      }
      if (progress.fileName) patch.currentFileName = progress.fileName
      patchLaunchUi(patch)
    })
    const offDownload = window.electronAPI?.onMinecraftDownloadStatus?.((progress) => {
      const patch: Partial<LaunchUiState> = {
        status: getStageLabel(progress.type, progress.installationPhase),
      }
      if (typeof progress.percent === "number") {
        patch.progress = progress.percent
        patch.phase = "installing"
      }
      if (typeof progress.downloadedBytes === "number") patch.downloadedBytes = progress.downloadedBytes
      else if (typeof progress.downloaded === "number") patch.downloadedBytes = progress.downloaded
      if (typeof progress.total === "number" && progress.total > 0) patch.totalBytes = progress.total
      if (typeof progress.currentFile === "number") patch.currentFile = progress.currentFile
      if (typeof progress.totalFiles === "number") patch.totalFiles = progress.totalFiles
      if (progress.fileName || progress.name) patch.currentFileName = progress.fileName ?? progress.name ?? null
      patchLaunchUi(patch)
    })
    const offJava = window.electronAPI?.onMinecraftJavaProgress?.((progress) => {
      patchLaunchUi({
        progress: progress.percent,
        status: progress.message,
        phase: "installing",
      })
      addLog(`[Java] ${progress.message} ${progress.percent}%`, "launcher")
    })
    const offDebug = window.electronAPI?.onMinecraftDebug?.((message) => {
      if (message && !shouldIgnoreDebugLog(message)) addLog(message)
      if (message && shouldPromoteDebugStatus(message, launchUiRef.current.phase)) {
        patchLaunchUi({
          status: message,
          ...(LAUNCH_RE.test(message) ? { phase: "launching" as const } : {}),
        })
      }
    })
    const offData = window.electronAPI?.onMinecraftData?.((line) => {
      if (line?.trim()) addLog(line.trimEnd())
      if (line && RUNNING_RE.test(line)) {
        if (!isRunningRef.current) {
          setIsRunning(true)
          isRunningRef.current = true
        }
        if (!runningNotificationSentRef.current) {
          runningNotificationSentRef.current = true
          removeLiveNotification("minecraft-launch")
          pushNotification({
            kind: "success",
            source: "launch",
            title: "Minecraft started",
            message: t("launcherStatus.running"),
          })
        }
        patchLaunchUi({
          isLaunching: false,
          progress: 100,
          status: t("launcherStatus.running"),
          phase: "idle",
        })
      }
    })
    const offClose = window.electronAPI?.onMinecraftClose?.((code) => {
      addLog(`[Процесс завершен с кодом ${code}]`, code === 0 ? "info" : "error")
      setIsRunning(false)
      runningNotificationSentRef.current = false
      removeLiveNotification("minecraft-launch")
      pushNotification({
        kind: code === 0 ? "info" : "error",
        source: "launch",
        title: code === 0 ? "Minecraft closed" : "Minecraft stopped with an error",
        message: code === 0 ? "Game process finished normally." : `Exit code: ${code}`,
      })
      resetLaunchUi()
    })

    return () => {
      offProgress?.()
      offDownload?.()
      offJava?.()
      offDebug?.()
      offData?.()
      offClose?.()
    }
  }, [addLog, patchLaunchUi, pushNotification, removeLiveNotification, resetLaunchUi, t])

  useEffect(() => () => {
    if (flushTimeoutRef.current !== null) {
      window.clearTimeout(flushTimeoutRef.current)
    }
    if (launchFrameRef.current !== null) {
      cancelAnimationFrame(launchFrameRef.current)
    }
  }, [])

  const logsValue = useMemo<LaunchLogsStateValue>(() => ({ logs }), [logs])
  const controlsValue = useMemo<LaunchControlsValue>(() => ({
    addLog,
    clearLogs,
    isRunning,
    setIsRunning,
    launchUi,
    patchLaunchUi,
    resetLaunchUi,
  }), [addLog, clearLogs, isRunning, launchUi, patchLaunchUi, resetLaunchUi])

  return (
    <LaunchControlsContext.Provider value={controlsValue}>
      <LaunchLogsStateContext.Provider value={logsValue}>
        {children}
      </LaunchLogsStateContext.Provider>
    </LaunchControlsContext.Provider>
  )
}

export function useLaunchLogs() {
  const state = useContext(LaunchLogsStateContext)
  const controls = useContext(LaunchControlsContext)
  if (!state || !controls) throw new Error("useLaunchLogs must be used inside LaunchLogsProvider")
  return useMemo(() => ({ ...state, ...controls }), [state, controls])
}

export function useLaunchControls() {
  const ctx = useContext(LaunchControlsContext)
  if (!ctx) throw new Error("useLaunchLogs must be used inside LaunchLogsProvider")
  return ctx
}
