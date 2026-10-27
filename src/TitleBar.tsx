import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { IconBell, IconCheck, IconLoader2, IconPlayerPlay, IconX } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useActivityCenter, type ActivityNotification } from "./ActivityCenterContext"

const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties

const noDragStyle = { WebkitAppRegion: "no-drag" } as CSSProperties

function formatRelativeTime(timestamp: number, locale: string, justNow: string): string {
  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMinutes < 1) return justNow
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (diffMinutes < 60) return relative.format(-diffMinutes, "minute")
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return relative.format(-diffHours, "hour")
  return relative.format(-Math.floor(diffHours / 24), "day")
}

function formatSourceLabel(source: ActivityNotification["source"], t: (key: string) => string): string {
  if (source === "launch") return t("activity.source.launch")
  if (source === "install") return t("activity.source.install")
  return t("activity.source.import")
}

function NotificationIcon({ notification }: { notification: ActivityNotification }) {
  if (notification.kind === "success") return <IconCheck className="h-4 w-4" />
  if (notification.kind === "error") return <IconX className="h-4 w-4" />
  if (notification.kind === "progress") {
    return notification.source === "launch"
      ? <IconPlayerPlay className="h-4 w-4" />
      : <IconLoader2 className="h-4 w-4 animate-spin" />
  }
  return <IconBell className="h-4 w-4" />
}

export function TitleBar() {
  const { t, i18n } = useTranslation()
  const { notifications, unreadCount, isOpen, setIsOpen, toggleOpen, markAllRead } = useActivityCenter()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleBarRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const titleBar = titleBarRef.current
    if (!titleBar) return
    const updateHeight = () => document.documentElement.style.setProperty("--launcher-titlebar-height", `${titleBar.getBoundingClientRect().height}px`)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(titleBar)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty("--launcher-titlebar-height")
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    markAllRead()
    const handlePointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    window.addEventListener("mousedown", handlePointerDown)
    return () => window.removeEventListener("mousedown", handlePointerDown)
  }, [isOpen, markAllRead, setIsOpen])

  return (
    <header data-ui="title-bar-header-1" data-component="title-bar" id="launcher-titlebar"
      ref={titleBarRef}
      className="relative z-[1000] flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-3"
      style={{ ...dragRegionStyle, pointerEvents: "auto" }}
    >
      <div data-ui="title-bar-div-1" className="flex items-center gap-2">
        <svg data-ui="title-bar-svg-1" data-icon="title-bar-svg-1" className="h-6 w-6 text-primary" viewBox="0 0 192 192" fill="currentColor">
          <path data-ui="title-bar-path-1" d="M 121.270 53.270 L 93 81.539 93 86.387 C 93 90.685, 93.440 91.676, 96.882 95.118 C 100.594 98.829, 102.357 99.451, 108 99.039 C 109.813 98.907, 117.168 92.210, 134.750 74.686 L 159 50.515 159 88.493 L 159 126.471 146.236 113.736 L 133.472 101 126.244 101 L 119.016 101 111.008 108.754 L 103 116.508 103 126.876 C 103 138.904, 103.732 138.905, 92.871 126.857 L 85.778 118.988 89.363 115.019 C 93.760 110.153, 94.655 106.955, 92.869 102.487 C 92.037 100.404, 80.782 88.072, 64.162 71.030 L 36.823 43 19.709 43 L 2.595 43 16.024 56.750 C 35.123 76.307, 55.993 97.939, 59.465 101.779 L 62.430 105.058 33.215 134.285 C 17.147 150.360, 4 163.847, 4 164.256 C 4 164.665, 11.982 165, 21.739 165 L 39.477 165 55.296 149.250 L 71.114 133.500 86.307 149.285 L 101.500 165.071 109.827 165.035 C 117.581 165.002, 118.346 164.808, 120.939 162.215 C 123.315 159.838, 123.831 158.300, 124.445 151.746 C 124.841 147.520, 124.845 139.549, 124.454 134.031 C 124.062 128.514, 123.997 124, 124.308 124 C 124.619 124, 133.974 133.225, 145.097 144.500 L 165.320 165 171.144 165 C 176.166 165, 177.418 164.598, 180.234 162.083 L 183.500 159.165 183.774 103.301 L 184.048 47.437 172.678 36.218 L 161.307 25 155.423 25 L 149.539 25 121.270 53.270" />
        </svg>
        <span data-ui="title-bar-span-1" className="text-sm font-medium text-sidebar-foreground">Xneon Launcher</span>
      </div>

      <div data-ui="title-bar-div-2" className="flex items-center gap-1" style={noDragStyle}>
        <div data-ui="title-bar-div-3" className="relative" ref={panelRef}>
          <button data-ui="title-bar-button-1"
            type="button"
            onClick={toggleOpen}
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              isOpen && "bg-muted/70 text-foreground",
            )}
            aria-label={t("notifications.open")}
            aria-expanded={isOpen}
          >
            <IconBell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span data-ui="title-bar-span-2" className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {isOpen && (
            <div data-ui="title-bar-div-4" className="absolute right-0 top-[calc(100%+0.75rem)] w-[360px] overflow-hidden rounded-3xl border border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl">
              <div data-ui="title-bar-div-5" className="border-b border-border/70 bg-gradient-to-r from-primary/12 via-transparent to-transparent px-4 py-4">
                <div data-ui="title-bar-div-6" className="flex items-center justify-between gap-3">
                  <div data-ui="title-bar-div-7">
                    <p data-ui="title-bar-p-1" className="text-sm font-semibold text-foreground">{t("notifications.title")}</p>
                    <p data-ui="title-bar-p-2" className="mt-1 text-xs text-muted-foreground">{t("notifications.description")}</p>
                  </div>
                  {unreadCount > 0 && (
                    <span data-ui="title-bar-span-3" className="rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
                      {unreadCount} {t("notifications.unreadSuffix")}
                    </span>
                  )}
                </div>
              </div>

              <div data-ui="title-bar-div-8" className="max-h-[420px] overflow-y-auto p-3">
                {notifications.length === 0 ? (
                  <div data-ui="title-bar-div-9" className="rounded-2xl border border-dashed border-border/80 bg-muted/30 px-4 py-8 text-center">
                    <p data-ui="title-bar-p-3" className="text-sm font-medium text-foreground">{t("notifications.emptyTitle")}</p>
                    <p data-ui="title-bar-p-4" className="mt-1 text-xs text-muted-foreground">{t("notifications.emptyDescription")}</p>
                  </div>
                ) : (
                  <div data-ui="title-bar-div-10" className="space-y-2">
                    {notifications.map((notification) => (
                      <div data-ui="title-bar-div-11"
                        key={notification.id}
                        className={cn(
                          "rounded-2xl border px-3 py-3 transition-colors",
                          notification.read ? "border-border/70 bg-background/70" : "border-primary/25 bg-primary/6",
                        )}
                      >
                        <div data-ui="title-bar-div-12" className="flex items-start gap-3">
                          <div data-ui="title-bar-div-13"
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl",
                              notification.kind === "error" && "bg-destructive/12 text-destructive",
                              notification.kind === "success" && "bg-success/12 text-success",
                              notification.kind === "progress" && "bg-primary/12 text-primary",
                              notification.kind === "info" && "bg-muted text-muted-foreground",
                            )}
                          >
                            <NotificationIcon notification={notification} />
                          </div>

                          <div data-ui="title-bar-div-14" className="min-w-0 flex-1">
                            <div data-ui="title-bar-div-15" className="flex items-start justify-between gap-3">
                              <p data-ui="title-bar-p-5" className="text-sm font-medium text-foreground">{notification.title}</p>
                              <span data-ui="title-bar-span-4" className="shrink-0 text-[11px] text-muted-foreground">
                                {formatRelativeTime(notification.timestamp, i18n.resolvedLanguage || i18n.language, t("notifications.justNow"))}
                              </span>
                            </div>

                            <p data-ui="title-bar-p-6" className="mt-1 text-xs leading-5 text-muted-foreground">{notification.message}</p>

                            {notification.itemName && (
                              <p data-ui="title-bar-p-7" className="mt-2 truncate text-[11px] text-muted-foreground/90">{notification.itemName}</p>
                            )}

                            {typeof notification.progress === "number" ? (
                              <div data-ui="title-bar-div-16" className="mt-3">
                                <div data-ui="title-bar-div-17" className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div data-ui="title-bar-div-18"
                                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                                    style={{ width: `${notification.progress}%` }}
                                  />
                                </div>
                                <div data-ui="title-bar-div-19" className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span data-ui="title-bar-span-5">{formatSourceLabel(notification.source, t)}</span>
                                  <span data-ui="title-bar-span-6">{notification.progress}%</span>
                                </div>
                              </div>
                            ) : notification.busy ? (
                              // Этапы без байтов (поиск версии, окно зависимостей): процентов
                              // ещё нет, но полоса должна показывать, что процесс идёт.
                              <div data-ui="title-bar-div-20" className="mt-3">
                                <div data-ui="title-bar-div-21" className="progress-indeterminate h-1.5 rounded-full bg-muted" />
                                <div data-ui="title-bar-div-22" className="mt-1 text-[11px] text-muted-foreground">
                                  {formatSourceLabel(notification.source, t)}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button data-ui="title-bar-button-2"
          type="button"
          onClick={() => window.electronAPI?.minimize()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <svg data-ui="title-bar-svg-2" data-icon="title-bar-svg-2" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path data-ui="title-bar-path-2" strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
        </button>
        <button data-ui="title-bar-button-3"
          type="button"
          onClick={() => window.electronAPI?.maximize()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <svg data-ui="title-bar-svg-3" data-icon="title-bar-svg-3" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect data-ui="title-bar-rect-1" x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button data-ui="title-bar-button-4"
          type="button"
          onClick={() => window.electronAPI?.close()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <svg data-ui="title-bar-svg-4" data-icon="title-bar-svg-4" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path data-ui="title-bar-path-3" strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  )
}
