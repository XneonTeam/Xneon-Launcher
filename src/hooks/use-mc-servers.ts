import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { McServerInfo, McServerState } from "@xnlc/types"
import { useCategoryIcons } from "@/src/hooks/use-category-icons"
import { useCategoryList } from "@/src/hooks/use-category-list"

export function useMcServers() {
  const [servers, setServers] = useState<McServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  // Свёрнутые категории (как группы у сборок) — состояние только в UI.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // Иконки категорий — их можно задать в контекстном меню категории.
  const { categoryIcons, setCategoryIcon, renameCategoryIcon, dropCategoryIcon } = useCategoryIcons("servers")
  // Созданные вручную категории: без этого пустая категория исчезала бы сразу.
  const {
    declaredCategories, addCategory, renameCategory: renameDeclaredCategory, dropCategory: dropDeclaredCategory,
  } = useCategoryList("servers")

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

  /** Назначает серверу категорию (пустая строка — убрать из группы). */
  const setServerGroup = useCallback(async (id: string, group: string) => {
    const value = group.trim()
    setServers(prev => prev.map(s => s.id === id ? { ...s, group: value || undefined } : s))
    await window.electronAPI?.mcServerUpdate(id, { group: value || null })
  }, [])

  /** Переименовывает категорию у всех серверов, что в неё входят. */
  const renameGroup = useCallback(async (oldName: string, newName: string) => {
    const target = newName.trim()
    if (!target || target === oldName) return
    const affected = servers.filter(s => (s.group ?? "") === oldName).map(s => s.id)
    setServers(prev => prev.map(s => (s.group ?? "") === oldName ? { ...s, group: target } : s))
    setCollapsedGroups(prev => {
      if (!prev.has(oldName)) return prev
      const next = new Set(prev)
      next.delete(oldName)
      next.add(target)
      return next
    })
    await Promise.all(affected.map(id => window.electronAPI?.mcServerUpdate(id, { group: target })))
    renameCategoryIcon(oldName, target)
    renameDeclaredCategory(oldName, target)
  }, [servers, renameCategoryIcon, renameDeclaredCategory])

  /** Удаляет категорию: серверы остаются, но становятся без группы. */
  const deleteGroup = useCallback(async (group: string) => {
    const affected = servers.filter(s => (s.group ?? "") === group).map(s => s.id)
    setServers(prev => prev.map(s => (s.group ?? "") === group ? { ...s, group: undefined } : s))
    setCollapsedGroups(prev => {
      if (!prev.has(group)) return prev
      const next = new Set(prev)
      next.delete(group)
      return next
    })
    await Promise.all(affected.map(id => window.electronAPI?.mcServerUpdate(id, { group: null })))
    dropCategoryIcon(group)
    dropDeclaredCategory(group)
  }, [servers, dropCategoryIcon, dropDeclaredCategory])

  const toggleGroupCollapse = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const groups = useMemo(() => {
    // Созданные категории + категории, в которых уже есть серверы.
    const set = new Set<string>(declaredCategories)
    for (const s of servers) { if (s.group) set.add(s.group) }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [servers, declaredCategories])

  return { servers, loading, reload, createServer, deleteServer, updateServer, restoreServer, listTrash, purgeTrash, permanentDelete, duplicateServer, setServerGroup, renameGroup, deleteGroup, addCategory, groups, collapsedGroups, toggleGroupCollapse, categoryIcons, setCategoryIcon }
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

/**
 * Буфер логов в main-процессе создаётся заново на каждый запуск сервера, поэтому
 * и консоль обязана начинаться с чистого листа: без сброса по статусу "starting"
 * перезапуск выглядел бы как непрерывный лог всех предыдущих сессий.
 */
export function useMcServerLogs(id: string | null) {
  const [logs, setLogs] = useState<string[]>([])
  // Поколение консоли: нужно, чтобы ещё не вернувшийся начальный запрос буфера
  // не вернул в консоль строки предыдущего запуска после сброса.
  const generationRef = useRef(0)
  // Перезапуск: пока гасится старая сессия, консоль уже очищена, и её хвост
  // (Saving chunks, "Server exited with code 0") не должен снова в неё попасть.
  const mutedRef = useRef(false)

  useEffect(() => {
    if (!id) return
    const generation = ++generationRef.current
    mutedRef.current = false
    setLogs([])

    window.electronAPI?.mcServerLogs(id).then(initial => {
      if (generation === generationRef.current && initial) setLogs(initial)
    })

    const unsubLog = window.electronAPI?.onMcServerLog((data) => {
      if (data.id !== id || mutedRef.current) return
      setLogs(prev => [...prev, data.line])
    })

    const unsubState = window.electronAPI?.onMcServerStateChange((data) => {
      if (data.id !== id) return
      if (data.state.status === "starting") {
        // Новая сессия началась — консоль обязана быть пустой, а приём строк снова открыт.
        mutedRef.current = false
        generationRef.current++
        setLogs([])
      } else if (data.state.status === "stopped") {
        // Старт после перезапуска мог не состояться: иначе консоль молчала бы навсегда.
        mutedRef.current = false
      }
    })

    return () => {
      unsubLog?.()
      unsubState?.()
      mutedRef.current = false
    }
  }, [id])

  const clearLogs = useCallback(() => {
    generationRef.current++
    setLogs([])
  }, [])

  /** Перезапуск: чистим консоль сразу по нажатию и глушим хвост прошлой сессии. */
  const resetForRestart = useCallback(() => {
    mutedRef.current = true
    generationRef.current++
    setLogs([])
  }, [])

  return { logs, clearLogs, resetForRestart }
}

export function useMcServerMetrics(id: string | null, isRunning: boolean) {
  const [metrics, setMetrics] = useState<{ cpuPercent: number; memoryMb: number; uptimeSeconds: number }>({
    cpuPercent: 0,
    memoryMb: 0,
    uptimeSeconds: 0,
  })

  useEffect(() => {
    if (!id || !isRunning) {
      setMetrics({ cpuPercent: 0, memoryMb: 0, uptimeSeconds: 0 })
      return
    }

    // Метрики приходят push'ем из main-процесса: он сам собирает их раз в 2 секунды
    // и рассылает подписчикам. Renderer ничего не опрашивает — сбор метрик на Windows
    // спавнит PowerShell, и постоянный поллинг из компонентов был бы накладным.
    const unsub = window.electronAPI?.onMcServerMetrics((data) => {
      if (data.id === id) setMetrics(data.metrics)
    })
    void window.electronAPI?.mcServerMetricsSubscribe(id)

    return () => {
      void window.electronAPI?.mcServerMetricsUnsubscribe(id)
      unsub?.()
    }
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
