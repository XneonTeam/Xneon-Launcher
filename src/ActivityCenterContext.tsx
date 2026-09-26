import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react"

export type ActivityNotificationKind = "info" | "success" | "error" | "progress"
export type ActivityNotificationSource = "launch" | "import" | "install"
export type ImportSessionSource = "modrinth" | "curseforge" | "ftb" | "local"

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

interface ContentInstallStart {
  title: string
  message: string
  itemName?: string | null
}

interface ContentInstallPatch {
  message?: string
  progress?: number | null
}

/** Состояние текущей установки: заголовок задаёт вызывающий, он же и снимает запись. */
interface ContentInstallState {
  title: string
  message: string
  itemName: string | null
  progress: number | null
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
  /**
   * Установка контента сама ведёт своё живое уведомление: показать его сразу по
   * клику, переписать текст на смене этапа и снять, когда операция закончилась.
   */
  beginContentInstall: (start: ContentInstallStart) => void
  updateContentInstall: (patch: ContentInstallPatch) => void
  endContentInstall: () => void
  startImportSession: (source: ImportSessionSource) => void
  clearImportSession: () => void
}

const ActivityCenterContext = createContext<ActivityCenterValue | null>(null)

const MAX_NOTIFICATIONS = 24

/**
 * Живое уведомление об установке контента принадлежит операции установки, а не
 * отдельному файлу: пока идёт поиск версии, подтверждение зависимостей и скачивание,
 * в панели висит одна запись, которая меняет текст по этапам и исчезает сразу, как
 * только установка закончилась. События прогресса из main лишь дописывают проценты.
 */
const CONTENT_INSTALL_LIVE_KEY = "content-download"

/** Страховка на случай, когда поток прогресса пришёл без владельца и оборвался. */
const CONTENT_DOWNLOAD_IDLE_MS = 30_000

/**
 * То же для импорта, запущенного не из интерфейса (восстановление сборки из
 * облака и т.п.): закрыть запись интерфейсу некому, поэтому снимаем её сами —
 * по паузе в событиях или сразу после «Готово!».
 */
const IMPORT_IDLE_MS = 60_000

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
  if (source === "ftb") return "Импорт с FTB"
  return "Импорт из файла"
}

export function ActivityCenterProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<ActivityNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [importSessionSource, setImportSessionSource] = useState<ImportSessionSource | null>(null)
  const importSessionSourceRef = useRef<ImportSessionSource | null>(null)
  /** Таймер-страховка для установок без владельца (см. CONTENT_DOWNLOAD_IDLE_MS). */
  const contentDownloadTimerRef = useRef<number | null>(null)
  /** Установка, которая прямо сейчас владеет живым уведомлением прогресса. */
  const contentInstallRef = useRef<ContentInstallState | null>(null)
  /** Таймер-страховка для импорта, запущенного не из интерфейса (восстановление из облака и т.п.). */
  const importTimerRef = useRef<number | null>(null)
  /** Внешний импорт идёт: события по отдельным файлам в это время не показываем. */
  const externalImportRef = useRef(false)
  /** Байты по каждому файлу текущей пачки: процент считаем по сумме, а не по одному файлу. */
  const downloadFilesRef = useRef(new Map<string, { current: number; total: number }>())
  /** Показываемый процент пачки — только растёт (файлы качаются параллельно). */
  const downloadPercentRef = useRef(0)
  // Читаем актуальное состояние панели из ref, чтобы публикация уведомлений не
  // меняла идентичность коллбэков: иначе открытие панели пересоздавало IPC-подписки
  // (см. LaunchLogsContext) и состояние активной установки/запуска.
  const isOpenRef = useRef(isOpen)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })))
  }, [])

  const pushNotification = useCallback((input: ActivityNotificationInput) => {
    setNotifications((prev) => [createNotification(input, isOpenRef.current), ...prev].slice(0, MAX_NOTIFICATIONS))
  }, [])

  const upsertLiveNotification = useCallback((liveKey: string, input: ActivityNotificationInput) => {
    setNotifications((prev) => {
      const nextItem = createNotification(input, isOpenRef.current, liveKey)
      const existingIndex = prev.findIndex((item) => item.liveKey === liveKey)
      if (existingIndex === -1) {
        return [nextItem, ...prev].slice(0, MAX_NOTIFICATIONS)
      }

      const next = prev.filter((item) => item.liveKey !== liveKey)
      const existing = prev[existingIndex]
      nextItem.id = existing.id
      nextItem.read = isOpenRef.current ? true : existing.read
      return [nextItem, ...next].slice(0, MAX_NOTIFICATIONS)
    })
  }, [])

  const removeLiveNotification = useCallback((liveKey: string) => {
    setNotifications((prev) => prev.filter((item) => item.liveKey !== liveKey))
  }, [])

  const beginContentInstall = useCallback((start: ContentInstallStart) => {
    contentInstallRef.current = {
      title: start.title,
      message: start.message,
      itemName: start.itemName ?? null,
      progress: null,
    }
    upsertLiveNotification(CONTENT_INSTALL_LIVE_KEY, {
      kind: "progress",
      source: "install",
      title: start.title,
      message: start.message,
      progress: null,
      itemName: start.itemName ?? null,
      busy: true,
    })
  }, [upsertLiveNotification])

  const updateContentInstall = useCallback((patch: ContentInstallPatch) => {
    const state = contentInstallRef.current
    if (!state) return
    if (patch.message !== undefined) state.message = patch.message
    if (patch.progress !== undefined) state.progress = patch.progress
    upsertLiveNotification(CONTENT_INSTALL_LIVE_KEY, {
      kind: "progress",
      source: "install",
      title: state.title,
      message: state.message,
      progress: state.progress,
      itemName: state.itemName,
      busy: true,
    })
  }, [upsertLiveNotification])

  const endContentInstall = useCallback(() => {
    contentInstallRef.current = null
    removeLiveNotification(CONTENT_INSTALL_LIVE_KEY)
  }, [removeLiveNotification])

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
    const clearImportTimer = () => {
      if (importTimerRef.current !== null) {
        window.clearTimeout(importTimerRef.current)
        importTimerRef.current = null
      }
    }
    const scheduleImportRemoval = (delay: number) => {
      clearImportTimer()
      importTimerRef.current = window.setTimeout(() => {
        importTimerRef.current = null
        externalImportRef.current = false
        removeLiveNotification("modpack-import")
      }, delay)
    }

    const off = window.electronAPI?.onImportProgress((progress) => {
      const source = importSessionSourceRef.current
      const total = Math.max(progress.total, 1)
      const current = Math.max(0, Math.min(progress.current, total))
      const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)))
      const finished = progress.current >= progress.total || percent >= 100

      // Импорт может запускать и main (восстановление сборки из облака, импорт из
      // другого лаунчера): сессии в renderer тогда нет, но прогресс приходит, и
      // раньше он молча отбрасывался — в панели оставались только проценты
      // отдельных файлов, которые качаются параллельно и потому «прыгали».
      externalImportRef.current = !source

      upsertLiveNotification("modpack-import", {
        kind: "progress",
        source: "import",
        title: source ? getImportTitle(source) : "Импорт сборки",
        message: progress.message,
        progress: percent,
        busy: !finished,
      })

      if (!source) {
        // Сессию закрывает интерфейс; для внешнего импорта запись снимаем сами.
        scheduleImportRemoval(finished ? 1_500 : IMPORT_IDLE_MS)
      }
    })

    return () => {
      clearImportTimer()
      off?.()
    }
  }, [upsertLiveNotification, removeLiveNotification])

  useEffect(() => {
    const clearTimer = () => {
      if (contentDownloadTimerRef.current !== null) {
        window.clearTimeout(contentDownloadTimerRef.current)
        contentDownloadTimerRef.current = null
      }
    }

    const scheduleRemoval = (delay: number) => {
      clearTimer()
      contentDownloadTimerRef.current = window.setTimeout(() => {
        contentDownloadTimerRef.current = null
        // Пачка закончилась: следующая начнёт шкалу заново.
        downloadFilesRef.current.clear()
        downloadPercentRef.current = 0
        removeLiveNotification("content-download")
      }, delay)
    }

    const off = window.electronAPI?.onContentDownloadProgress?.((progress) => {
      if (!progress) return
      // Пока идёт импорт (свой или запущенный main), проценты отдельных файлов
      // не показываем: у импорта своя шкала этапов.
      if (importSessionSourceRef.current || externalImportRef.current) return

      const total = Math.max(progress.total, 1)
      const current = Math.max(0, Math.min(progress.current, total))

      // Установка из интерфейса владеет записью сама: здесь только проценты.
      // В одной установке файлов может быть несколько (мод и его зависимости),
      // поэтому завершение отдельного файла запись не закрывает — иначе она
      // мигала бы между файлами и снималась бы раньше времени.
      if (contentInstallRef.current) {
        if (!progress.done) updateContentInstall({ progress: Math.round((current / total) * 100) })
        return
      }

      // Установка без владельца (восстановление сборки, распаковка архива,
      // установка из другого раздела): ведём ОДНУ запись на всю пачку файлов.
      // Файлы качаются параллельно (5 потоков), поэтому процент одного файла
      // скакал вверх-вниз, пока остальные ещё грузились. Считаем по сумме байт
      // всех файлов пачки и не даём шкале уменьшаться.
      if (progress.fileName) {
        downloadFilesRef.current.set(progress.fileName, {
          current: progress.done ? total : current,
          total,
        })
      }
      let sumCurrent = 0
      let sumTotal = 0
      for (const file of downloadFilesRef.current.values()) {
        sumCurrent += Math.min(file.current, file.total)
        sumTotal += file.total
      }
      const overall = sumTotal > 0 ? Math.round((sumCurrent / sumTotal) * 100) : 0
      const shown = Math.max(downloadPercentRef.current, overall)
      downloadPercentRef.current = shown

      upsertLiveNotification(CONTENT_INSTALL_LIVE_KEY, {
        kind: "progress",
        source: "install",
        title: "Установка контента",
        message: progress.fileName ? `Загрузка: ${progress.fileName}` : "Установка...",
        progress: shown,
        itemName: progress.fileName || null,
        busy: !progress.done,
      })
      // Файл закрыт — держим запись ещё немного: следующий файл пачки просто
      // продолжит её, а по-настоящему одинокая загрузка исчезнет сама.
      scheduleRemoval(progress.done ? 1_200 : CONTENT_DOWNLOAD_IDLE_MS)
    })

    return () => {
      clearTimer()
      off?.()
    }
  }, [removeLiveNotification, updateContentInstall, upsertLiveNotification])

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
    beginContentInstall,
    updateContentInstall,
    endContentInstall,
    startImportSession,
    clearImportSession,
  }), [
    beginContentInstall,
    clearImportSession,
    endContentInstall,
    isOpen,
    markAllRead,
    notifications,
    pushNotification,
    removeLiveNotification,
    startImportSession,
    toggleOpen,
    unreadCount,
    updateContentInstall,
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
