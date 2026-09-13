import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCalendar, IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

export type StatsRange = { from: number; to: number }

const DAY_MS = 86_400_000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

/** Days grid (Mon-first) for the given month; null = leading/trailing blank. */
function monthMatrix(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1)
  // JS: 0=Sun..6=Sat → convert to Mon-first (0=Mon..6=Sun)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<number | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

type Preset = { key: string; days: number } | { key: string; thisMonth: true }

export function StatsRangePicker({
  value,
  onChange,
}: {
  value: StatsRange
  onChange: (range: StatsRange) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState<number>(value.from)
  const [draftTo, setDraftTo] = useState<number>(value.to)
  const [picking, setPicking] = useState<"from" | "to">("from")
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(value.from)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const rootRef = useRef<HTMLDivElement>(null)

  // Sync draft when the popover opens with an external value.
  useEffect(() => {
    if (open) {
      setDraftFrom(value.from)
      setDraftTo(value.to)
      setPicking("from")
      const d = new Date(value.from)
      setViewMonth({ year: d.getFullYear(), month: d.getMonth() })
    }
  }, [open, value.from, value.to])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const cells = useMemo(() => monthMatrix(viewMonth.year, viewMonth.month), [viewMonth])

  const monthLabel = useMemo(
    () => new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [viewMonth],
  )

  const label = useMemo(() => {
    const f = new Date(value.from)
    const tt = new Date(value.to)
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
    return `${f.toLocaleDateString(undefined, opts)} — ${tt.toLocaleDateString(undefined, opts)}`
  }, [value.from, value.to])

  const presets: Preset[] = [
    { key: "stats.preset7d", days: 7 },
    { key: "stats.preset30d", days: 30 },
    { key: "stats.preset90d", days: 90 },
    { key: "stats.presetThisMonth", thisMonth: true },
  ]

  const applyPreset = (preset: Preset) => {
    const now = Date.now()
    if ("thisMonth" in preset) {
      const d = new Date()
      const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      onChange({ from: startOfDay(from), to: endOfDay(now) })
    } else {
      onChange({ from: startOfDay(now - (preset.days - 1) * DAY_MS), to: endOfDay(now) })
    }
    setOpen(false)
  }

  const pickDay = (day: number) => {
    const ts = new Date(viewMonth.year, viewMonth.month, day).getTime()
    if (picking === "from") {
      setDraftFrom(startOfDay(ts))
      setDraftTo(endOfDay(ts))
      setPicking("to")
    } else {
      if (ts < draftFrom) {
        setDraftFrom(startOfDay(ts))
        setDraftTo(endOfDay(draftFrom))
      } else {
        setDraftTo(endOfDay(ts))
      }
      setPicking("from")
    }
  }

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
          open
            ? "border-primary/60 bg-primary/10 text-foreground"
            : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <IconCalendar className="h-4 w-4" strokeWidth={1.75} />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[300px] rounded-2xl border border-border bg-popover p-4 shadow-2xl">
          {/* month header */}
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("stats.prevMonth")}
            >
              <IconChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className="text-sm font-semibold capitalize text-foreground">{monthLabel}</span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("stats.nextMonth")}
            >
              <IconChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          {/* weekday header */}
          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[10px] font-medium text-muted-foreground">
                {w}
              </div>
            ))}
          </div>

          {/* day grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (day === null) return <div key={`blank-${idx}`} />
              const ts = new Date(viewMonth.year, viewMonth.month, day).getTime()
              const inRange = ts >= startOfDay(draftFrom) && ts <= startOfDay(draftTo)
              const isEdge = sameDay(ts, draftFrom) || sameDay(ts, draftTo)
              const isToday = sameDay(ts, Date.now())
              return (
                <button
                  key={ts}
                  type="button"
                  onClick={() => pickDay(day)}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-lg text-xs font-medium transition-colors",
                    isEdge
                      ? "bg-primary text-primary-foreground"
                      : inRange
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    isToday && !isEdge && "ring-1 ring-primary/40",
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>

          {/* presets */}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t(p.key)}
              </button>
            ))}
          </div>

          {/* actions */}
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t("stats.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange({ from: startOfDay(draftFrom), to: endOfDay(draftTo) })
                setOpen(false)
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("stats.show")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
