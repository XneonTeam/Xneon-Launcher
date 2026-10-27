import { useContentEnter, CONTENT_ENTER_DELAYED } from "./content-motion"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconRefresh, IconClock, IconDeviceGamepad2, IconHistory, IconChartBar, IconPackage, IconColorSwatch, IconServer, IconLoader2 } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { formatPlaytime, formatDateTime } from "@/lib/format"
import type { StatsOverview } from "@xnlc/types"
import { StatsRangePicker, type StatsRange } from "@/components/launcher/stats/stats-range-picker"
import { EntityIcon } from "@/components/launcher/instance/entity-icon"
import { isBuiltinLogo } from "@/components/launcher/instance/builtin-logos"

const DAY_MS = 86_400_000

function defaultRange(): StatsRange {
  const now = Date.now()
  const from = new Date(now - 29 * DAY_MS)
  from.setHours(0, 0, 0, 0)
  const to = new Date(now)
  to.setHours(23, 59, 59, 999)
  return { from: from.getTime(), to: to.getTime() }
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div data-ui="stats-page-div-1" data-component="stat-card" className="rounded-2xl border border-border bg-card p-4">
      <div data-ui="stats-page-div-2" className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div data-ui="stats-page-div-3" className="mt-1.5 text-2xl font-bold text-foreground">{value}</div>
      {sub && <div data-ui="stats-page-div-4" className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function EntryIcon({ icon, fallback }: { icon?: string; fallback: React.ReactNode }) {
  if (icon) {
    if (isBuiltinLogo(icon)) {
      return <EntityIcon src={icon} className="h-9 w-9 shrink-0 rounded-lg p-1 text-primary" />
    }
    const hasImg = icon.trimStart().startsWith("http") || icon.startsWith("data:")
    if (hasImg) {
      return <img data-ui="stats-page-img-1" data-component="entry-icon" src={icon} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
    }
  }
  return (
    <div data-ui="stats-page-div-5" data-component="entry-icon" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 text-primary/40">
      {fallback}
    </div>
  )
}

function DailyChart({ data }: { data: Array<{ date: string; seconds: number }> }) {  const { t } = useTranslation()
  const max = Math.max(1, ...data.map((d) => d.seconds))
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div data-ui="stats-page-div-6" data-component="daily-chart" className="relative">
      {hoveredIndex !== null && data[hoveredIndex] && (
        <div data-ui="stats-page-div-7" className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-lg whitespace-nowrap">
          {new Date(data[hoveredIndex].date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          {" — "}
          {data[hoveredIndex].seconds > 0 ? formatPlaytime(data[hoveredIndex].seconds) : t("stats.noPlaytime")}
        </div>
      )}
      <div data-ui="stats-page-div-8" className="flex h-36 items-end gap-[3px]">
        {data.map((day, index) => {
          const height = day.seconds > 0 ? Math.max(4, (day.seconds / max) * 100) : 2
          const isHovered = hoveredIndex === index
          return (
            <button data-ui="stats-page-button-1"
              key={day.date}
              type="button"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              className="group relative flex-1 min-w-0"
              style={{ height: "100%" }}
              aria-label={`${day.date}: ${formatPlaytime(day.seconds)}`}
            >
              <div data-ui="stats-page-div-9" className="absolute bottom-0 left-0 right-0 flex items-end" style={{ height: "100%" }}>
                <div data-ui="stats-page-div-10"
                  className={cn(
                    "w-full rounded-t transition-all duration-150",
                    day.seconds > 0
                      ? isHovered ? "bg-primary" : "bg-primary/60"
                      : "bg-muted-foreground/15",
                  )}
                  style={{ height: `${height}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>
      <div data-ui="stats-page-div-11" className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span data-ui="stats-page-span-1">{new Date(data[0]?.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        <span data-ui="stats-page-span-2">
          {data.length > 0
            ? `${data.length} ${data.length === 1 ? "day" : "days"}`
            : t("stats.last30days")}
        </span>
        <span data-ui="stats-page-span-3">{new Date(data[data.length - 1]?.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
      </div>
    </div>
  )
}

type RankingEntry = {
  id: string
  name: string
  icon?: string
  seconds: number
  sessions: number
}

function RankingList({ entries, emptyKey, maxSeconds }: { entries: RankingEntry[]; emptyKey: string; maxSeconds: number }) {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return <p data-ui="stats-page-p-1" data-component="ranking-list" className="py-8 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
  }
  return (
    <div data-ui="stats-page-div-12" data-component="ranking-list" className="space-y-3">
      {entries.map((entry, index) => (
        <div data-ui="stats-page-div-13" key={entry.id} className="flex items-center gap-3">
          <span data-ui="stats-page-span-4" className="w-5 shrink-0 text-center text-sm font-bold text-muted-foreground">{index + 1}</span>
          <EntryIcon icon={entry.icon} fallback={<IconPackage className="h-4 w-4" strokeWidth={1.75} />} />
          <div data-ui="stats-page-div-14" className="min-w-0 flex-1">
            <div data-ui="stats-page-div-15" className="flex items-baseline justify-between gap-2">
              <span data-ui="stats-page-span-5" className="truncate text-sm font-medium text-foreground">{entry.name}</span>
              <span data-ui="stats-page-span-6" className="shrink-0 text-xs font-medium text-muted-foreground">
                {formatPlaytime(entry.seconds)} · {t("stats.sessionsCount", { count: entry.sessions })}
              </span>
            </div>
            <div data-ui="stats-page-div-16" className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div data-ui="stats-page-div-17"
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(2, (entry.seconds / maxSeconds) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatsPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const contentEnter = useContentEnter(stats !== null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<"builds" | "servers">("builds")
  const [range, setRange] = useState<StatsRange>(() => defaultRange())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.getStatsOverview(range)
      if (result) setStats(result)
    } catch (error) {
      console.error("[Stats] Failed to load overview:", error)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  // Live-обновления: push-события (запись сессии, смена состояния сервера)
  // обновляют страницу мгновенно. Постоянный 5-секундный поллинг убран:
  // интервал работает только пока запущена игра или сервер — лишь тогда
  // счётчики времени реально меняются между push-событиями.
  useEffect(() => {
    const offUpdated = window.electronAPI?.onStatsUpdated?.(() => void load())
    const offServer = window.electronAPI?.onMcServerStateChange?.(() => void load())
    return () => {
      offUpdated?.()
      offServer?.()
    }
  }, [load])

  const hasLiveSessions = (stats?.gameActiveStartedAt != null) || ((stats?.activeServerSessions ?? 0) > 0)
  useEffect(() => {
    if (!hasLiveSessions) return
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [hasLiveSessions, load])

  const maxTopSeconds = useMemo(
    () => Math.max(1, ...(stats?.topBuilds ?? []).map((b) => b.seconds)),
    [stats],
  )
  const maxServerSeconds = useMemo(
    () => Math.max(1, ...(stats?.topServers ?? []).map((s) => s.seconds)),
    [stats],
  )

  return (
    <div data-ui="stats-page-div-18" data-component="stats-page" id="stats-page" data-tab={activeTab} className="flex h-full min-h-0 flex-col">
      <div data-ui="stats-page-div-19" className={`launcher-page-header mb-5 flex items-center justify-between ${CONTENT_ENTER_DELAYED}`}>
        <div data-ui="stats-page-div-20" className="flex items-center gap-3">
          <div data-ui="stats-page-div-21" className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconChartBar className="w-5 h-5 text-primary" />
          </div>
          <div data-ui="stats-page-div-22">
            <h1 data-ui="stats-page-h1-1" className="text-xl font-bold text-foreground">{t("stats.title")}</h1>
            <p data-ui="stats-page-p-2" className="mt-0.5 text-sm text-muted-foreground">{t("stats.subtitle")}</p>
          </div>
        </div>
        <div data-ui="stats-page-div-23" className="flex items-center gap-3">
          <div data-ui="stats-page-div-24" className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border">
            <button data-ui="stats-page-button-2"
              type="button"
              onClick={() => setActiveTab("builds")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                activeTab === "builds"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
              )}
            >
              <IconColorSwatch className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("stats.tabBuilds")}
            </button>
            <button data-ui="stats-page-button-3"
              type="button"
              onClick={() => setActiveTab("servers")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                activeTab === "servers"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
              )}
            >
              <IconServer className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("stats.tabServers")}
            </button>
          </div>
          <StatsRangePicker value={range} onChange={setRange} />
          <button data-ui="stats-page-button-4"
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {loading ? <IconLoader2 className="h-4 w-4 text-primary animate-spin" strokeWidth={1.75} /> : <IconRefresh className="h-4 w-4" strokeWidth={1.75} />}
            {t("stats.refresh")}
          </button>
        </div>
      </div>

      <div key={activeTab} data-ui="stats-page-div-25" className={cn("min-h-0 flex-1 overflow-y-auto pr-2", contentEnter)}>
        {!stats ? (
          <div data-ui="stats-page-div-26" className="flex items-center justify-center py-24">
            <IconLoader2 className="h-6 w-6 text-primary animate-spin" strokeWidth={1.75} />
          </div>
        ) : activeTab === "builds" ? (
          <div data-ui="stats-page-div-27" className="space-y-5">
            <div data-ui="stats-page-div-28" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                icon={<IconClock className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.totalPlaytime")}
                value={formatPlaytime(stats.totalPlaytime)}
              />
              <StatCard
                icon={<IconDeviceGamepad2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.totalSessions")}
                value={String(stats.totalSessions)}
              />
              <StatCard
                icon={<IconChartBar className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.averageSession")}
                value={formatPlaytime(stats.averageSession)}
              />
              <StatCard
                icon={<IconHistory className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.lastSession")}
                value={stats.lastSession ? formatPlaytime(stats.lastSession.duration) : "—"}
                sub={stats.lastSession
                  ? `${stats.lastSession.buildName} · ${formatDateTime(stats.lastSession.endedAt)}`
                  : t("stats.noSessionsYet")}
              />
            </div>

            <div data-ui="stats-page-div-29" className="grid gap-5 lg:grid-cols-2">
              <section data-ui="stats-page-section-1" className="rounded-2xl border border-border bg-card p-5">
                <h2 data-ui="stats-page-h2-1" className="mb-4 text-base font-semibold text-foreground">{t("stats.activityTitle")}</h2>
                <DailyChart data={stats.dailyPlaytime} />
              </section>

              <section data-ui="stats-page-section-2" className="rounded-2xl border border-border bg-card p-5">
                <h2 data-ui="stats-page-h2-2" className="mb-4 text-base font-semibold text-foreground">{t("stats.topBuilds")}</h2>
                <RankingList
                  entries={stats.topBuilds.map((b) => ({ id: b.buildId, name: b.name, icon: b.icon, seconds: b.seconds, sessions: b.sessions }))}
                  emptyKey="stats.noSessionsYet"
                  maxSeconds={maxTopSeconds}
                />
              </section>
            </div>
          </div>
        ) : (
          <div data-ui="stats-page-div-30" className="space-y-5">
            <div data-ui="stats-page-div-31" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                icon={<IconClock className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.totalServerUptime")}
                value={formatPlaytime(stats.serverTotalUptime)}
              />
              <StatCard
                icon={<IconServer className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.totalSessions")}
                value={String(stats.serverTotalSessions ?? 0)}
              />
              <StatCard
                icon={<IconChartBar className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.averageSession")}
                value={formatPlaytime(stats.serverAverageSession ?? 0)}
              />
              <StatCard
                icon={<IconHistory className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={t("stats.lastSession")}
                value={stats.serverLastSession ? formatPlaytime(stats.serverLastSession.duration) : "—"}
                sub={stats.serverLastSession
                  ? `${stats.serverLastSession.serverName} · ${formatDateTime(stats.serverLastSession.endedAt)}`
                  : t("stats.noServersYet")}
              />
            </div>

            <div data-ui="stats-page-div-32" className="grid gap-5 lg:grid-cols-2">
              <section data-ui="stats-page-section-3" className="rounded-2xl border border-border bg-card p-5">
                <h2 data-ui="stats-page-h2-3" className="mb-4 text-base font-semibold text-foreground">{t("stats.serverActivityTitle")}</h2>
                <DailyChart data={stats.dailyServerUptime ?? []} />
              </section>

              <section data-ui="stats-page-section-4" className="rounded-2xl border border-border bg-card p-5">
                <div data-ui="stats-page-div-33" className="mb-4 flex items-center gap-2">
                  <IconServer className="h-5 w-5 text-primary" strokeWidth={1.75} />
                  <h2 data-ui="stats-page-h2-4" className="text-base font-semibold text-foreground">{t("stats.topServers")}</h2>
                  {stats.serverTotalUptime > 0 && (
                    <span data-ui="stats-page-span-7" className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {formatPlaytime(stats.serverTotalUptime)}
                    </span>
                  )}
                </div>
                <RankingList
                  entries={stats.topServers.map((s) => ({ id: s.serverId, name: s.name, icon: s.icon, seconds: s.seconds, sessions: s.sessions }))}
                  emptyKey="stats.noServersYet"
                  maxSeconds={maxServerSeconds}
                />
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
