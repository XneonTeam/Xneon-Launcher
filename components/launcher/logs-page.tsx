import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useLaunchLogs, type LogEntry, type LogLevel } from "@/src/LaunchLogsContext"
import { useAccounts } from "@/src/AccountsContext"
import { useTranslation } from "react-i18next"
import {
  IconFileText, IconCopy, IconCheck, IconRefresh, IconTrash,
  IconSearch, IconArrowDown, IconShare, IconDeviceGamepad2,
  IconBug, IconAlertTriangle, IconCircleX, IconTerminal2,
} from "@tabler/icons-react"

// ── Константы ──

const LS: Record<LogLevel, string> = {
  error: "text-[#f62451] font-semibold", warn: "text-[#FF6625] font-semibold",
  debug: "text-[#A4A4A4]", game: "text-[#e8e8e8]",
  launcher: "text-[#5cb85c]", info: "text-[#e8e8e8]",
}

const ROW_BG: Partial<Record<LogLevel, string>> = {
  launcher: "bg-[#5cb85c]/10 border-l-2 border-[#5cb85c]/50 hover:bg-[#5cb85c]/15",
  debug: "bg-[#A4A4A4]/5 border-l-2 border-[#A4A4A4]/30 hover:bg-[#A4A4A4]/10",
  error: "bg-[#f62451]/15 border-l-2 border-[#f62451]/60 hover:bg-[#f62451]/25",
  warn: "bg-[#FF6625]/15 border-l-2 border-[#FF6625]/60 hover:bg-[#FF6625]/25",
}

const PFX_CLR: Record<string, string> = {
  INFO: "text-[#5cb85c]", ERROR: "text-[#f62451]",
  WARN: "text-[#FF6625]", WARNING: "text-[#FF6625]",
  DEBUG: "text-[#A4A4A4]", TRACE: "text-[#A4A4A4]",
}

const MC_RE = /(\[.*?\] \[.*?\/(INFO|ERROR|WARN|WARNING|DEBUG|TRACE)\]:)/g
const OWN_FMT = /^\[.*\] \[.*\]: /
const LBL_KEY: Record<LogLevel, string> = {
  error: "logs.levelError", warn: "logs.levelWarn", debug: "logs.levelDebug",
  game: "logs.levelGame", launcher: "logs.levelLauncher", info: "logs.levelInfo",
}

const FILTER_DEFS: { id: LogLevel | "all"; icon: typeof IconFileText }[] = [
  { id: "all", icon: IconFileText },
  { id: "launcher", icon: IconTerminal2 },
  { id: "game", icon: IconDeviceGamepad2 },
  { id: "debug", icon: IconBug },
  { id: "warn", icon: IconAlertTriangle },
  { id: "error", icon: IconCircleX },
]

const EMPTY_COUNTS: Record<LogLevel, number> = { info: 0, warn: 0, error: 0, debug: 0, game: 0, launcher: 0 }

// ── Утилиты рендера ──

const fmtTime = (ts: number) => {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, "0")).join(":")
}

const txtColor = (l: LogLevel) =>
  l === "error" ? "text-[#f62451]" : l === "warn" ? "text-[#FF6625]" : l === "debug" ? "text-[#A4A4A4]" : "text-[#e8e8e8]"

const pfxColor = (l: LogLevel) =>
  l === "error" ? "text-[#f62451]" : l === "warn" ? "text-[#FF6625]" : "text-[#5cb85c]"

function renderMcLog(text: string, level: LogLevel) {
  const tc = txtColor(level), lc = pfxColor(level)
  const parts: React.ReactNode[] = []
  let last = 0, m: RegExpExecArray | null
  MC_RE.lastIndex = 0
  while ((m = MC_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${last}`} className={tc}>{text.slice(last, m.index)}</span>)
    parts.push(<span key={`l${m.index}`} className={cn("font-semibold", PFX_CLR[m[2]] ?? lc)}>{m[1]}</span>)
    last = m.index + m[1].length
  }
  if (last < text.length) parts.push(<span key={`t${last}`} className={tc}>{text.slice(last)}</span>)
  return parts.length ? <>{parts}</> : <span className={tc}>{text}</span>
}

function renderLog(text: string, level: LogLevel) {
  return (level === "game" || level === "info" || OWN_FMT.test(text))
    ? renderMcLog(text, level) : <span className={LS[level]}>{text}</span>
}

// ── LogRow ──

const LogRow = memo(function LogRow({ entry, label }: { entry: LogEntry; label: string }) {
  const own = OWN_FMT.test(entry.text) || entry.level === "launcher"
  const isErr = entry.level === "error", isWarn = entry.level === "warn"
  return (
    <div className={cn("flex gap-2 px-2 py-0.5 rounded hover:bg-white/5 group transition-colors", ROW_BG[entry.level])}>
      {own ? (
        <span className="flex-1 break-all whitespace-pre-wrap">
          {isErr ? <span className="font-semibold text-[#f62451]">{renderLog(entry.text, entry.level)}</span>
            : isWarn ? <span className="font-semibold text-[#FF6625]">{renderLog(entry.text, entry.level)}</span>
            : renderLog(entry.text, entry.level)}
        </span>
      ) : isErr ? (
        <span className="flex-1 break-all whitespace-pre-wrap font-semibold text-[#f62451]">{entry.text}</span>
      ) : (
        <>
          <span className="text-muted-foreground/40 flex-shrink-0 select-none w-[54px]">{fmtTime(entry.ts)}</span>
          <span className={cn("flex-shrink-0 w-[52px] font-semibold text-[10px] uppercase tracking-wide mt-px", LS[entry.level])}>{label}</span>
          <span className="flex-1 break-all whitespace-pre-wrap">{renderLog(entry.text, entry.level)}</span>
        </>
      )}
    </div>
  )
})

// ── LogsPage ──

export function LogsPage() {
  const { t } = useTranslation()
  const { logs, clearLogs, isRunning } = useLaunchLogs()
  const { activeAccount } = useAccounts()
  const [filter, setFilter] = useState<LogLevel | "all">("all")
  const [search, setSearch] = useState("")
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const levelLabels = useMemo(() =>
    Object.fromEntries((Object.keys(LBL_KEY) as LogLevel[]).map(l => [l, t(LBL_KEY[l])])) as Record<LogLevel, string>,
  [t])

  const levelCounts = useMemo(() =>
    logs.reduce<Record<LogLevel, number>>((a, l) => { a[l.level]++; return a }, { ...EMPTY_COUNTS }),
  [logs])

  const filtered = useMemo(() => {
    let r = filter === "all" ? logs : logs.filter(l => l.level === filter)
    if (search.trim()) { const q = search.toLowerCase(); r = r.filter(l => l.text.toLowerCase().includes(q)) }
    return r
  }, [logs, filter, search])

  useEffect(() => {
    const el = containerRef.current
    if (!autoScroll || !el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [filtered, autoScroll])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }, [])

  const logsText = useCallback(() => {
    const header = `Xneon Launcher log by ${activeAccount?.username ?? "Player"}\n${"=".repeat(40)}\n`
    return header + logs.map(l => l.text).join("\n")
  }, [logs, activeAccount])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(logsText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [logsText])

  const handleShare = useCallback(async () => {
    const text = logsText()
    if (!text.trim()) return
    setShareState("loading"); setShareUrl(null)
    const result = await window.electronAPI?.shareToMclogs(text)
    if (result?.success && result.url) {
      setShareUrl(result.url); setShareState("done")
      await navigator.clipboard.writeText(result.url)
      setTimeout(() => setShareState("idle"), 4000)
    } else {
      setShareState("error")
      setTimeout(() => setShareState("idle"), 3000)
    }
  }, [logsText])

  const shareCls = cn(
    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
    shareState === "done" ? "bg-green-500/20 text-green-400"
      : shareState === "error" ? "bg-destructive/20 text-destructive"
      : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground",
    (shareState === "loading" || logs.length === 0) && "opacity-50 cursor-not-allowed",
  )

  return (
    <div className="h-[700px] flex flex-col gap-4 animate-in fade-in-0 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconFileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t("logs.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {isRunning
                ? <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                    {t("logs.running", { count: logs.length })}
                  </span>
                : t("logs.entries", { count: logs.length })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {copied ? <><IconCheck className="w-4 h-4 text-green-500" />{t("logs.copied")}</> : <><IconCopy className="w-4 h-4" />{t("logs.copy")}</>}
          </button>

          <button type="button" disabled={shareState === "loading" || logs.length === 0} onClick={() => void handleShare()} className={shareCls}>
            {shareState === "loading" ? <><IconRefresh className="w-4 h-4 animate-spin" />{t("logs.uploading")}</>
              : shareState === "done" ? <><IconCheck className="w-4 h-4" />{shareUrl ? <span className="max-w-[120px] truncate">{shareUrl.replace("https://", "")}</span> : t("logs.published")}</>
              : shareState === "error" ? <><IconTrash className="w-4 h-4" />{t("logs.shareError")}</>
              : <><IconShare className="w-4 h-4" />{t("logs.share")}</>}
          </button>

          <button type="button" onClick={clearLogs}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors">
            <IconTrash className="w-4 h-4" />{t("logs.clear")}
          </button>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/40 flex-shrink-0">
          {FILTER_DEFS.map(({ id, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                filter === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              {id === "all" ? t("logs.all") : t(`logs.${id}`)}
              {id !== "all" && <span className="opacity-60">{levelCounts[id]}</span>}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("logs.search")}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
        </div>

        <button type="button" onClick={() => setAutoScroll(v => !v)}
          className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors flex-shrink-0",
            autoScroll ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground hover:text-foreground")}>
          <IconArrowDown className="w-3.5 h-3.5" />{t("logs.autoScroll")}
        </button>
      </div>

      {/* Log area */}
      <div ref={containerRef} onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-border bg-[#0d0d14] font-mono text-[12px] leading-5">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
            <IconFileText className="w-10 h-10 mb-3 opacity-30" /><p className="text-sm">{t("logs.empty")}</p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {filtered.map(entry => <LogRow key={entry.id} entry={entry} label={levelLabels[entry.level]} />)}
          </div>
        )}
      </div>
    </div>
  )
}
