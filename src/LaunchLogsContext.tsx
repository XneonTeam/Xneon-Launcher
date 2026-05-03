import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'game' | 'launcher'

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
}

const LaunchLogsStateContext = createContext<LaunchLogsStateValue | null>(null)
const LaunchControlsContext = createContext<LaunchControlsValue | null>(null)

let _id = 0

function classify(text: string): LogLevel {
  const t = text.toLowerCase()
  if (/^\[(xnlc|minecraft|launcher|java)\]/i.test(text)) return 'launcher'
  if (/\[ЛАУНЧЕР\]|\[launcher\]/i.test(t)) return 'launcher'
  if (/^\[.*\] \[.*\/ERROR\]: /.test(text)) return 'error'
  if (/^\[.*\] \[.*\/WARN\]: /.test(text)) return 'warn'
  if (/^\[.*\] \[.*\/DEBUG\]: /.test(text)) return 'debug'
  if (/^\[.*\] \[.*\]: /.test(text)) return 'game'
  if (/\[fATAL\]|fATAL:|\b(fatal error)\b|\[ОШИБКА\]/i.test(t)) return 'error'
  if (/\[error\]|error:|\/error\]|exception|failed|unable to|crashed|crash/i.test(t)) return 'error'
  if (/\[warn\]|warning:|warn:|\/warn\]|\/warning\]/i.test(t)) return 'warn'
  if (/\[debug\]|debug:|\[trace\]|trace:/i.test(t)) return 'debug'
  // Стектрейс: строки, начинающиеся с табуляции (at ...) или Caused by:
  if (/^\t(at |... )/.test(text)) return 'error'
  if (/^(Caused by:|... \d+ more)/.test(text)) return 'error'
  // Строки с исключениями (например, com.mojang.authlib.exceptions...)
  if (/\b(Exception|Error)\b/.test(t) && !/^\[.*\]/.test(text)) return 'error'
  return 'info'
}

export function LaunchLogsProvider({ children }: PropsWithChildren) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const addLog = useCallback((text: string, level?: LogLevel) => {
    const entry: LogEntry = {
      id: ++_id,
      level: level ?? classify(text),
      text,
      ts: Date.now(),
    }
    setLogs(prev => [...prev.slice(-1999), entry])
  }, [])

  const clearLogs = useCallback(() => setLogs([]), [])

  useEffect(() => {
    const offDebug = window.electronAPI?.onMinecraftDebug?.((msg) => {
      if (msg) addLog(msg)
    })
    const offData = window.electronAPI?.onMinecraftData?.((line) => {
      if (line?.trim()) addLog(line.trimEnd())
    })
    const offJava = window.electronAPI?.onMinecraftJavaProgress?.((p) => {
      addLog(`[Java] ${p.message} ${p.percent}%`, 'launcher')
    })
    const offClose = window.electronAPI?.onMinecraftClose?.((code) => {
      addLog(`[Процесс завершён с кодом ${code}]`, code === 0 ? 'info' : 'error')
      setIsRunning(false)
    })

    return () => {
      offDebug?.()
      offData?.()
      offJava?.()
      offClose?.()
    }
  }, [addLog])

  const logsValue = useMemo<LaunchLogsStateValue>(() => ({ logs }), [logs])
  const controlsValue = useMemo<LaunchControlsValue>(() => ({
    addLog,
    clearLogs,
    isRunning,
    setIsRunning,
  }), [addLog, clearLogs, isRunning])

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
  if (!state || !controls) throw new Error('useLaunchLogs must be used inside LaunchLogsProvider')
  return useMemo(() => ({ ...state, ...controls }), [state, controls])
}

export function useLaunchControls() {
  const ctx = useContext(LaunchControlsContext)
  if (!ctx) throw new Error('useLaunchLogs must be used inside LaunchLogsProvider')
  return ctx
}
