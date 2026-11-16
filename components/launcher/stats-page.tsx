import { useContentEnter, CONTENT_ENTER_DELAYED } from "./content-motion"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconRefresh, IconClock, IconDeviceGamepad2, IconHistory, IconChartBar, IconColorSwatch, IconServer, IconLoader2 } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { formatPlaytime, formatDateTime } from "@/lib/format"
import type { StatsOverview } from "@xnlc/types"
import { StatsRangePicker, type StatsRange } from "@/components/launcher/stats/stats-range-picker"
import { EntityIcon } from "@/components/launcher/instance/entity-icon"
import { isBuiltinLogo } from "@/components/launcher/instance/builtin-logos"
import { Pagination } from "./instance/pagination"

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

function DailyChart({ data }: { data: Array<{ date: string; seconds: number }> }) {
  const { t, i18n } = useTranslation()
  const gradientId = `stats-area-${useId().replace(/:/g, "")}`
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const peak = Math.max(0, ...data.map(day => day.seconds))
  const total = data.reduce((sum, day) => sum + day.seconds, 0)
  const activeDays = data.filter(day => day.seconds > 0).length
  const unit = peak >= 4 * 86400 ? 86400 : peak >= 4 * 3600 ? 3600 : peak >= 4 * 60 ? 60 : 1
  const step = Math.max(unit, Math.ceil(peak / 4 / unit) * unit)
  const ceiling = step * 4
  const points = data.map((day, index) => ({
    x: data.length === 1 ? 500 : index / (data.length - 1) * 1000,
    y: 232 - day.seconds / ceiling * 224,
  }))
  const line = points.map(point => `${point.x},${point.y}`).join(" ")
  const area = points.length === 1 ? `M480 232V${points[0].y}H520V232Z`
    : points.length ? `M0 232 ${points.map(point => `L${point.x} ${point.y}`).join(" ")} L1000 232Z` : ""
  const selectedDay = hoveredIndex === null ? undefined : data[hoveredIndex]
  const selectedPoint = hoveredIndex === null ? undefined : points[hoveredIndex]
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage, { day: "numeric", month: "short" }), [i18n.resolvedLanguage])
  const dateLabel = (date?: string) => date ? dateFormatter.format(new Date(date + "T12:00:00")) : "—"

  return (
    <div data-ui="stats-page-div-6" data-component="daily-chart" className="relative flex min-h-0 flex-1 flex-col">
      <div className="mb-5 flex min-h-12 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{selectedDay ? dateLabel(selectedDay.date) : t("stats.periodTotal")}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{formatPlaytime(selectedDay?.seconds ?? total)}</p>
        </div>
        <p className="pb-1 text-xs tabular-nums text-muted-foreground">{t("stats.activeDays", { count: activeDays, total: data.length })}</p>
      </div>
      <div data-ui="stats-page-div-8" className="relative min-h-48 flex-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-14">
          {[4, 3, 2, 1, 0].map(tick => <span key={tick} className="absolute left-0 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/70"
            style={{ top: `${(232 - tick / 4 * 224) / 240 * 100}%` }}>{peak > 0 || tick === 0 ? formatPlaytime(tick * step) : ""}</span>)}
        </div>
        <div className="absolute inset-y-0 left-16 right-0" onPointerLeave={() => setHoveredIndex(null)}>
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-label={t("stats.activityChart")} className="absolute inset-0 h-full w-full overflow-visible">
            <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" /></linearGradient></defs>
            {[4, 3, 2, 1, 0].map(tick => <line key={tick} x1="0" x2="1000" y1={232 - tick / 4 * 224} y2={232 - tick / 4 * 224}
              stroke="var(--border)" strokeOpacity={tick === 0 ? 0.8 : 0.45} strokeDasharray={tick === 0 ? undefined : "3 5"} vectorEffect="non-scaling-stroke" />)}
            {peak > 0 && <><path d={area} fill={`url(#${gradientId})`} /><polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></>}
            {selectedPoint && <line x1={selectedPoint.x} x2={selectedPoint.x} y1="8" y2="232" stroke="var(--primary)" strokeOpacity="0.4" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
          </svg>
          {selectedPoint && <span aria-hidden="true" className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-card"
            style={{ left: `${selectedPoint.x / 10}%`, top: `${selectedPoint.y / 240 * 100}%` }} />}
          {peak === 0 && <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">{t("stats.noActivity")}</p>}
          <div className="absolute inset-0 flex">{data.map((day, index) => <button data-ui="stats-page-button-1" key={day.date} type="button"
            aria-label={`${dateLabel(day.date)}: ${formatPlaytime(day.seconds)}`}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none focus-visible:bg-primary/5"
            onPointerEnter={() => setHoveredIndex(index)} onClick={() => setHoveredIndex(index)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} />)}</div>
        </div>
      </div>
      <div data-ui="stats-page-div-11" className="ml-16 mt-3 flex justify-between gap-2 text-[10px] tabular-nums text-muted-foreground">
        <span data-ui="stats-page-span-1">{dateLabel(data[0]?.date)}</span>
        {data.length > 3 && <span>{dateLabel(data[Math.floor((data.length - 1) / 2)]?.date)}</span>}
        <span data-ui="stats-page-span-3">{dateLabel(data[data.length - 1]?.date)}</span>
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

function RankingList({ entries, emptyKey, maxSeconds, pageSize, rowHeight, rowGap }: {
  entries: RankingEntry[]; emptyKey: string; maxSeconds: number; pageSize: number; rowHeight: number; rowGap: number
}) {
  const { t } = useTranslation()
  // При resize сохраняем страницу, содержащую прежнюю первую запись.
  const [firstItem, setFirstItem] = useState(0)
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize))
  const page = Math.min(Math.floor(firstItem / pageSize), pageCount - 1)
  const start = page * pageSize
  const slots = Math.min(entries.length, pageSize)
  if (entries.length === 0) {
    return <p data-ui="stats-page-p-1" data-component="ranking-list" className="py-8 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
  }
  return (
    <div data-ui="stats-page-div-12" data-component="ranking-list" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3" style={{ minHeight: slots * rowHeight + Math.max(0, slots - 1) * rowGap }}>
      {entries.slice(start, start + pageSize).map((entry, index) => (
        <div data-ui="stats-page-div-13" data-component="ranking-entry" key={entry.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
          <span data-ui="stats-page-span-4" className="w-5 shrink-0 text-center text-sm font-bold text-muted-foreground">{start + index + 1}</span>
          <EntryIcon icon={entry.icon} fallback={<IconColorSwatch className="h-4 w-4" strokeWidth={1.75} />} />
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
      {pageCount > 1 && <nav data-component="ranking-pagination" aria-label={t("stats.rankingPagination")} className="mt-4 shrink-0">
        <Pagination currentPage={page} totalPages={pageCount} onPageChange={next => setFirstItem(next * pageSize)} className="flex-wrap py-0" />
      </nav>}
    </div>
  )
}

/** Размер одной страницы задаёт высоту пары карточек, а не весь рейтинг. */
function StatsRankingPanels({ activityTitle, rankingTitle, activity, entries, emptyKey, maxSeconds, serverTotal }: {
  activityTitle: string; rankingTitle: string; activity: Array<{ date: string; seconds: number }>
  entries: RankingEntry[]; emptyKey: string; maxSeconds: number; serverTotal?: string
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const rankingRef = useRef<HTMLElement>(null)
  const [layout, setLayout] = useState({ pageSize: 5, rowHeight: 58, rowGap: 12 })
  const isServer = serverTotal !== undefined

  useEffect(() => {
    const grid = gridRef.current
    const ranking = rankingRef.current
    const viewport = grid?.closest<HTMLElement>("[data-stats-scroll]")
    const heading = ranking?.querySelector<HTMLElement>("[data-ranking-heading]")
    if (!grid || !ranking || !viewport || !heading) return
    let frame = 0
    const measure = () => {
      frame = 0
      // Скрытые страницы Activity могут временно иметь нулевые размеры.
      if (viewport.clientHeight === 0 || grid.clientWidth === 0) return
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const rowHeight = ranking.querySelector<HTMLElement>("[data-component='ranking-entry']")?.getBoundingClientRect().height || 3.625 * rem
      const rowGap = 0.75 * rem
      const style = getComputedStyle(ranking)
      const headingStyle = getComputedStyle(heading)
      const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        + heading.getBoundingClientRect().height + parseFloat(headingStyle.marginBottom) + 3 * rem
      // Родитель relative: offsetTop не зависит от прокрутки/анимации входа.
      const stacked = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length === 1
      const chartHeight = stacked ? grid.children[0].getBoundingClientRect().height + 1.25 * rem : 0
      const available = viewport.clientHeight - grid.offsetTop - chartHeight - 0.5 * rem
      const pageSize = Math.max(2, Math.floor((available - chrome + rowGap) / (rowHeight + rowGap)))
      setLayout(current => current.pageSize === pageSize && current.rowHeight === rowHeight && current.rowGap === rowGap
        ? current : { pageSize, rowHeight, rowGap })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    observer.observe(heading)
    window.addEventListener("resize", schedule)
    schedule()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", schedule) }
  }, [entries.length])

  return (
    <div ref={gridRef} data-ui={isServer ? "stats-page-div-32" : "stats-page-div-29"} data-component="stats-ranking-panels" className="grid items-stretch gap-5 lg:grid-cols-2">
      <section data-ui={isServer ? "stats-page-section-3" : "stats-page-section-1"} className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5">
        <h2 data-ui={isServer ? "stats-page-h2-3" : "stats-page-h2-1"} className="mb-4 flex min-h-6 shrink-0 items-center gap-2 text-base font-semibold text-foreground">
          <IconChartBar className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
          <span>{activityTitle}</span>
        </h2>
        <DailyChart data={activity} />
      </section>
      <section ref={rankingRef} data-ui={isServer ? "stats-page-section-4" : "stats-page-section-2"} className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5">
        <div data-ranking-heading data-ui={isServer ? "stats-page-div-33" : undefined} className="mb-4 flex min-h-6 shrink-0 items-center gap-2">
          {isServer
            ? <IconServer className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
            : <IconColorSwatch className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />}
          <h2 data-ui={isServer ? "stats-page-h2-4" : "stats-page-h2-2"} className="text-base font-semibold text-foreground">{rankingTitle}</h2>
          {serverTotal && <span data-ui="stats-page-span-7" className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{serverTotal}</span>}
        </div>
        <RankingList entries={entries} emptyKey={emptyKey} maxSeconds={maxSeconds} {...layout} />
      </section>
    </div>
  )
}

export function StatsPage() {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const contentEnter = useContentEnter(stats !== null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<"builds" | "servers">("builds")
  const [range, setRange] = useState<StatsRange>(() => defaultRange())
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage, { day: "numeric", month: "short", year: "numeric" }),
    [i18n.resolvedLanguage],
  )
  const serverActivityRange = `${dateFormatter.format(range.from)} — ${dateFormatter.format(range.to)}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electrobunAPI?.getStatsOverview(range)
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
    const offUpdated = window.electrobunAPI?.onStatsUpdated?.(() => void load())
    const offServer = window.electrobunAPI?.onMcServerStateChange?.(() => void load())
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

      <div key={activeTab} data-ui="stats-page-div-25" data-stats-scroll className={cn("relative min-h-0 flex-1 overflow-y-auto pr-2", contentEnter)}>
        {!stats ? (
          <div data-ui="stats-page-div-26" className="flex min-h-full items-center justify-center">
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

            <StatsRankingPanels key={`${range.from}:${range.to}`}
              activityTitle={t("stats.activityTitle", { count: stats.dailyPlaytime.length })}
              rankingTitle={t("stats.topBuilds")} activity={stats.dailyPlaytime}
              entries={stats.topBuilds.map(b => ({ id: b.buildId, name: b.name, icon: b.icon, seconds: b.seconds, sessions: b.sessions }))}
              emptyKey="stats.noSessionsYet" maxSeconds={maxTopSeconds} />
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

            <StatsRankingPanels key={`${range.from}:${range.to}`}
              activityTitle={t("stats.serverActivityTitle", { range: serverActivityRange })}
              rankingTitle={t("stats.topServers")} activity={stats.dailyServerUptime ?? []}
              entries={stats.topServers.map(s => ({ id: s.serverId, name: s.name, icon: s.icon, seconds: s.seconds, sessions: s.sessions }))}
              emptyKey="stats.noServersYet" maxSeconds={maxServerSeconds}
              serverTotal={stats.serverTotalUptime > 0 ? formatPlaytime(stats.serverTotalUptime) : ""} />
          </div>
        )}
      </div>
    </div>
  )
}
