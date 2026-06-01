import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react"

export type ActivityNotificationKind = "info" | "success" | "error" | "progress"
export type ActivityNotificationSource = "launch" | "import"
export type ImportSessionSource = "modrinth" | "curseforge" | "local"

export interface ActivityNotification {
  id: string
  liveKey?: string
  kind: ActivityNotificationKind
  source: ActivityNotificationSource
  title: string
  message: string
  timestamp: number
  progress?: number | null
  itemName?: string | null
  busy?: boolean
  read: boolean
}

interface ActivityNotificationInput {
  kind: ActivityNotificationKind
  source: ActivityNotificationSource
  title: string
  message: string
  progress?: number | null
  itemName?: string | null
  busy?: boolean
}

interface ActivityCenterValue {
  notifications: ActivityNotification[]
  unreadCount: number
  isOpen: boolean
  setIsOpen: (value: boolean) => void
  toggleOpen: () => void
  markAllRead: () => void
  pushNotification: (input: ActivityNotificationInput) => void
  upsertLiveNotification: (liveKey: string, input: ActivityNotificationInput) => void
  removeLiveNotification: (liveKey: string) => void
  startImportSession: (source: ImportSessionSource) => void
  clearImportSession: () => void
}

const ActivityCenterContext = createContext<ActivityCenterValue | null>(null)

const MAX_NOTIFICATIONS = 24

function createNotification(input: ActivityNotificationInput, read: boolean, liveKey?: string): ActivityNotification {
  return {
    id: crypto.randomUUID(),
    liveKey,
    kind: input.kind,
    source: input.source,
    title: input.title,
    message: input.message,
    timestamp: Date.now(),
    progress: input.progress ?? null,
    itemName: input.itemName ?? null,
    busy: input.busy ?? false,
    read,
  }
}

function getImportTitle(source: ImportSessionSource | null): string {
  if (source === "modrinth") return "Импорт с Modrinth"
  if (source === "curseforge") return "Импорт с CurseForge"
  return "Импорт из файла"
}

export function ActivityCenterProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<ActivityNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [importSessionSource, setImportSessionSource] = useState<ImportSessionSource | null>(null)
  const importSessionSourceRef = useRef<ImportSessionSource | null>(null)

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })))
  }, [])

  const pushNotification = useCallback((input: ActivityNotificationInput) => {
    setNotifications((prev) => [createNotification(input, isOpen), ...prev].slice(0, MAX_NOTIFICATIONS))
  }, [isOpen])

  const upsertLiveNotification = useCallback((liveKey: string, input: ActivityNotificationInput) => {
    setNotifications((prev) => {
      const nextItem = createNotification(input, isOpen, liveKey)
      const existingIndex = prev.findIndex((item) => item.liveKey === liveKey)
      if (existingIndex === -1) {
        return [nextItem, ...prev].slice(0, MAX_NOTIFICATIONS)
      }

      const next = prev.filter((item) => item.liveKey !== liveKey)
      const existing = prev[existingIndex]
      nextItem.id = existing.id
      nextItem.read = isOpen ? true : existing.read
      return [nextItem, ...next].slice(0, MAX_NOTIFICATIONS)
    })
  }, [isOpen])

  const removeLiveNotification = useCallback((liveKey: string) => {
    setNotifications((prev) => prev.filter((item) => item.liveKey !== liveKey))
  }, [])

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const startImportSession = useCallback((source: ImportSessionSource) => {
    importSessionSourceRef.current = source
    setImportSessionSource(source)
  }, [])

  const clearImportSession = useCallback(() => {
    importSessionSourceRef.current = null
    setImportSessionSource(null)
    removeLiveNotification("modpack-import")
  }, [removeLiveNotification])

  useEffect(() => {
    const off = window.electronAPI?.onImportProgress((progress) => {
      const source = importSessionSourceRef.current
      if (!source) return
      const total = Math.max(progress.total, 1)
      const current = Math.max(0, Math.min(progress.current, total))
      const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)))
      upsertLiveNotification("modpack-import", {
        kind: "progress",
        source: "import",
        title: getImportTitle(source),
        message: progress.message,
        progress: percent,
        itemName: progress.itemName ?? null,
        busy: true,
      })
    })

    return () => off?.()
  }, [upsertLiveNotification])

  useEffect(() => {
    importSessionSourceRef.current = importSessionSource
  }, [importSessionSource])

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.read ? 0 : 1), 0),
    [notifications],
  )

  const value = useMemo<ActivityCenterValue>(() => ({
    notifications,
    unreadCount,
    isOpen,
    setIsOpen,
    toggleOpen,
    markAllRead,
    pushNotification,
    upsertLiveNotification,
    removeLiveNotification,
    startImportSession,
    clearImportSession,
  }), [
    clearImportSession,
    isOpen,
    markAllRead,
    notifications,
    pushNotification,
    removeLiveNotification,
    startImportSession,
    toggleOpen,
    unreadCount,
    upsertLiveNotification,
  ])

  return (
    <ActivityCenterContext.Provider value={value}>
      {children}
    </ActivityCenterContext.Provider>
  )
}

export function useActivityCenter() {
  const context = useContext(ActivityCenterContext)
  if (!context) throw new Error("useActivityCenter must be used inside ActivityCenterProvider")
  return context
}
