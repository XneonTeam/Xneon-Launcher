import { useCallback, useEffect, useState } from "react"
import type { McServerInfo, McServerState } from "@xnlc/types"

export function useMcServers() {
  const [servers, setServers] = useState<McServerInfo[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI?.mcServerList()
      setServers(list ?? [])
    } catch {
      setServers([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const createServer = useCallback(async (data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string }) => {
    const server = await window.electronAPI?.mcServerCreate(data)
    if (server) setServers(prev => [server, ...prev])
    return server
  }, [])

  const deleteServer = useCallback(async (id: string) => {
    await window.electronAPI?.mcServerDelete(id)
    setServers(prev => prev.filter(s => s.id !== id))
  }, [])

  const updateServer = useCallback(async (id: string, update: Record<string, unknown>) => {
    await window.electronAPI?.mcServerUpdate(id, update)
    setServers(prev => prev.map(s => s.id === id ? { ...s, ...update } as McServerInfo : s))
  }, [])

  const restoreServer = useCallback(async (id: string) => {
    await window.electronAPI?.mcServerRestore(id)
  }, [])

  const listTrash = useCallback(async () => {
    return await window.electronAPI?.mcServerListTrash() ?? []
  }, [])

  const purgeTrash = useCallback(async () => {
    await window.electronAPI?.mcServerPurgeTrash()
  }, [])

  const permanentDelete = useCallback(async (id: string) => {
    await window.electronAPI?.mcServerPermanentDelete(id)
  }, [])

  const duplicateServer = useCallback(async (id: string) => {
    const copy = await window.electronAPI?.mcServerDuplicate(id)
    if (copy) setServers(prev => [copy, ...prev])
    return copy
  }, [])

  return { servers, loading, reload, createServer, deleteServer, updateServer, restoreServer, listTrash, purgeTrash, permanentDelete, duplicateServer }
}

export function useMcServerState(id: string | null) {
  const [state, setState] = useState<McServerState>({ status: "stopped" })

  useEffect(() => {
    if (!id) return
    window.electronAPI?.mcServerStatus(id).then(s => {
      if (s) setState(s)
    })

    const unsub = window.electronAPI?.onMcServerStateChange((data) => {
      if (data.id === id) setState(data.state)
    })
    return () => unsub?.()
  }, [id])

  const start = useCallback(() => id && window.electronAPI?.mcServerStart(id), [id])
  const stop = useCallback(() => id && window.electronAPI?.mcServerStop(id), [id])
  const kill = useCallback(() => id && window.electronAPI?.mcServerKill(id), [id])

  return { state, start, stop, kill }
}

export function useMcServerLogs(id: string | null) {
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    if (!id) return
    window.electronAPI?.mcServerLogs(id).then(initial => {
      if (initial) setLogs(initial)
    })

    const unsub = window.electronAPI?.onMcServerLog((data) => {
      if (data.id === id) setLogs(prev => [...prev, data.line])
    })
    return () => unsub?.()
  }, [id])

  const clearLogs = useCallback(() => setLogs([]), [])

  return { logs, clearLogs }
}

export function useMcServerMetrics(id: string | null, isRunning: boolean) {
  const [metrics, setMetrics] = useState<{ cpuPercent: number; memoryMb: number; uptimeSeconds: number }>({
    cpuPercent: 0,
    memoryMb: 0,
    uptimeSeconds: 0,
  })

  useEffect(() => {
    if (!id || !isRunning) return
    let interval: ReturnType<typeof setInterval>

    const poll = async () => {
      const m = await window.electronAPI?.mcServerMetrics(id)
      if (m) setMetrics(m)
    }
    poll()
    interval = setInterval(poll, 2000)

    return () => clearInterval(interval)
  }, [id, isRunning])

  return metrics
}

export interface DownloadProgressInfo {
  phase: string
  percent?: number
  bytesTotal?: number
  bytesDownloaded?: number
  message: string
}

export function useMcServerDownloadProgress(id: string | null) {
  const [progress, setProgress] = useState<DownloadProgressInfo | null>(null)

  useEffect(() => {
    if (!id) return
    setProgress(null)

    const unsub = window.electronAPI?.onMcServerDownloadProgress((data) => {
      if (data.id === id) {
        setProgress(data.progress)
        if (data.progress.phase === "done" || data.progress.phase === "error") {
          setTimeout(() => setProgress(null), 3000)
        }
      }
    })
    return () => unsub?.()
  }, [id])

  return progress
}
