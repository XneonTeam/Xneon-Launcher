import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconRefresh, IconClock, IconDeviceGamepad2, IconHistory, IconChartBar,
  IconPackage, IconServer,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { formatPlaytime, formatDateTime } from "@/lib/format"
import type { StatsOverview } from "@xnlc/types"
import { StatsRangePicker, type StatsRange } from "@/components/launcher/stats/stats-range-picker"

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
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function EntryIcon({ icon, fallback }: { icon?: string; fallback: React.ReactNode }) {
  if (icon) {
    const hasImg = icon.trimStart().startsWith("http") || icon.startsWith("data:")
    if (hasImg) {
      return <img src={icon} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
    }
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 text-primary/40">
      {fallback}
    </div>
  )
}

function DailyChart({ data }: { data: Array<{ date: string; seconds: number }> }) {  const { t } = useTranslation()
  const max = Math.max(1, ...data.map((d) => d.seconds))
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div className="relative">
      {hoveredIndex !== null && data[hoveredIndex] && (
        <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-lg whitespace-nowrap">
          {new Date(data[hoveredIndex].date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          {" — "}
          {data[hoveredIndex].seconds > 0 ? formatPlaytime(data[hoveredIndex].seconds) : t("stats.noPlaytime")}
        </div>
      )}
      <div className="flex h-36 items-end gap-[3px]">
        {data.map((day, index) => {
          const height = day.seconds > 0 ? Math.max(4, (day.seconds / max) * 100) : 2
          const isHovered = hoveredIndex === index
          return (
            <button
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
              <div className="absolute bottom-0 left-0 right-0 flex items-end" style={{ height: "100%" }}>
                <div
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
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{new Date(data[0]?.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        <span>
          {data.length > 0
            ? `${data.length} ${data.length === 1 ? "day" : "days"}`
            : t("stats.last30days")}
        </span>
        <span>{new Date(data[data.length - 1]?.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
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
    return <p className="py-8 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
  }
  return (
    <div className="space-y-3">
      {entries.map((entry, index) => (
        <div key={entry.id} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-center text-sm font-bold text-muted-foreground">{index + 1}</span>
          <EntryIcon icon={entry.icon} fallback={<IconPackage className="h-4 w-4" strokeWidth={1.75} />} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                {formatPlaytime(entry.seconds)} · {t("stats.sessionsCount", { count: entry.sessions })}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
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

  // Real-time updates: refresh on stats:updated pushes, on MC server
  // state changes, and on a lightweight interval so live playtime /
  // server uptime ticks up while sessions are in progress.
  useEffect(() => {
    const offUpdated = window.electronAPI?.onStatsUpdated?.(() => void load())
    const offServer = window.electronAPI?.onMcServerStateChange?.(() => void load())
    const timer = setInterval(() => void load(), 5000)
    return () => {
      offUpdated?.()
      offServer?.()
      clearInterval(timer)
    }
  }, [load])

  const maxTopSeconds = useMemo(
    () => Math.max(1, ...(stats?.topBuilds ?? []).map((b) => b.seconds)),
    [stats],
  )
  const maxServerSeconds = useMemo(
    () => Math.max(1, ...(stats?.topServers ?? []).map((s) => s.seconds)),
    [stats],
  )

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in-0 duration-300">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconChartBar className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t("stats.title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("stats.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border">
            <button
              type="button"
              onClick={() => setActiveTab("builds")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                activeTab === "builds"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
              )}
            >
              <IconPackage className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("stats.tabBuilds")}
            </button>
            <button
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
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <IconRefresh className={cn("h-4 w-4", loading && "animate-spin")} strokeWidth={1.75} />
            {t("stats.refresh")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {!stats ? (
          <div className="flex items-center justify-center py-24">
            <IconRefresh className="h-6 w-6 animate-spin text-muted-foreground" strokeWidth={1.75} />
          </div>
        ) : activeTab === "builds" ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-4 text-base font-semibold text-foreground">{t("stats.activityTitle")}</h2>
                <DailyChart data={stats.dailyPlaytime} />
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-4 text-base font-semibold text-foreground">{t("stats.topBuilds")}</h2>
                <RankingList
                  entries={stats.topBuilds.map((b) => ({ id: b.buildId, name: b.name, icon: b.icon, seconds: b.seconds, sessions: b.sessions }))}
                  emptyKey="stats.noSessionsYet"
                  maxSeconds={maxTopSeconds}
                />
              </section>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-4 text-base font-semibold text-foreground">{t("stats.serverActivityTitle")}</h2>
                <DailyChart data={stats.dailyServerUptime ?? []} />
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center gap-2">
                  <IconServer className="h-5 w-5 text-primary" strokeWidth={1.75} />
                  <h2 className="text-base font-semibold text-foreground">{t("stats.topServers")}</h2>
                  {stats.serverTotalUptime > 0 && (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
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