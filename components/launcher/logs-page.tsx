import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useLaunchLogs, type LogEntry, type LogLevel } from "@/src/LaunchLogsContext"
import { useTranslation } from "react-i18next"
import {
  IconFileText, IconCopy, IconCheck, IconRefresh, IconTrash,
  IconSearch, IconArrowDown, IconShare, IconDeviceGamepad2,
  IconBug, IconAlertTriangle, IconCircleX, IconTerminal2,
} from "@tabler/icons-react"

// --- Syntax Highlight Patterns for Minecraft Logs ---

const LEVEL_COLORS: Record<string, string> = {
  INFO: "#5cb85c",
  ERROR: "#f62451",
  WARN: "#FF6625",
  WARNING: "#FF6625",
  DEBUG: "#A4A4A4",
  TRACE: "#A4A4A4",
  FATAL: "#f62451",
}

const CLASS_COLORS = [
  "#8be9fd", "#50fa7b", "#ffb86c", "#ff79c6", "#bd93f9",
  "#ff5555", "#f1fa8c", "#6272a4", "#44d5c3", "#e6a8d7",
]

const JAVA_KEYWORDS = new RegExp(String.raw`\b(?:public|private|protected|static|final|class|interface|extends|implements|void|int|boolean|double|float|long|short|byte|char|String|Object|null|true|false|return|if|else|while|for|switch|case|break|continue|try|catch|finally|throw|new|this|super|import|package|synchronized|volatile|transient|native|strictfp|assert|enum|instanceof)\b`, "g")

const URL_PATTERN = new RegExp(String.raw`https?://[^\s<>"'\)]*`, "g")
const UUID_PATTERN = new RegExp(String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`, "gi")
const CLASS_PATTERN = new RegExp(String.raw`(?:[a-z][a-zA-Z0-9_$]*\.)+[A-Z][a-zA-Z0-9_$]*`, "g")
const STACK_TRACE_PATTERN = new RegExp(String.raw`\s+at\s+(.+)`, "g")
const EXCEPTION_PATTERN = new RegExp(String.raw`([a-zA-Z][a-zA-Z0-9_$]*(?:Exception|Error|Throwable|RuntimeException)(?:\s*.*?)?)(?=\s|$)`, "g")
const NUMBER_PATTERN = new RegExp(String.raw`\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`, "g")
const HEX_PATTERN = new RegExp(String.raw`\b0x[0-9a-fA-F]+\b`, "g")
const TIMESTAMP_PATTERN = new RegExp(String.raw`\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\]`, "g")
const THREAD_PATTERN = new RegExp(String.raw`\[([^\]]*Thread[^\]]*)\]`, "g")
const ARROW_PATTERN = new RegExp(String.raw`(\s*--->\s*|\s*==>\s*|\s*\|\s*)`, "g")
const CAUSED_BY = new RegExp(String.raw`(Caused by:|Suppressed:)`, "g")
const MIXIN_PATTERN = new RegExp(String.raw`@Mixin|@Inject|@Redirect|@Overwrite|@Shadow|@Accessor`, "g")
const ANNOTATION_PATTERN = new RegExp(String.raw`@[A-Z][a-zA-Z0-9_$]*`, "g")


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

// --- Render Utilities ---

const fmtTime = (ts: number) => {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, "0")).join(":")
}

const txtColor = (l: LogLevel) =>
  l === "error" ? "text-[#f62451]" : l === "warn" ? "text-[#FF6625]" : l === "debug" ? "text-[#A4A4A4]" : "text-[#e8e8e8]"

const pfxColor = (l: LogLevel) =>
  l === "error" ? "text-[#f62451]" : l === "warn" ? "text-[#FF6625]" : "text-[#5cb85c]"

function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function getClassColor(className: string): string {
  return CLASS_COLORS[hashString(className) % CLASS_COLORS.length]
}

interface Token {
  type: string
  text: string
  color?: string
}

function tokenizeLog(text: string, level: LogLevel): Token[] {
  const tokens: Token[] = []
  let remaining = text
  let offset = 0

  function push(type: string, color: string | undefined, text: string) {
    if (text) tokens.push({ type, text, color })
  }

  // 1. Match Minecraft prefix format [HH:MM:SS] [Thread/LEVEL]:
  const mcMatch = MC_RE.exec(text)
  if (mcMatch && mcMatch.index === 0) {
    const fullPrefix = mcMatch[0]
    const levelStr = mcMatch[2]
    const levelColor = LEVEL_COLORS[levelStr] ?? PFX_CLR[levelStr] ?? pfxColor(level)

    // Extract timestamp and thread parts
    const tsMatch = fullPrefix.match(new RegExp(String.raw`\\[(\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?)\\]`))
    const threadMatch = fullPrefix.match(new RegExp(String.raw`\\[([^\\/\\]]*)\\/(INFO|ERROR|WARN|WARNING|DEBUG|TRACE)\\]`))

    if (tsMatch) {
      push("timestamp", "#6272a4", tsMatch[0])
    }
    if (threadMatch) {
      const beforeThread = fullPrefix.substring(tsMatch ? tsMatch[0].length : 0, threadMatch.index)
      if (beforeThread) push("text", undefined, beforeThread)
      push("bracket", "#A4A4A4", "[")
      push("thread", "#bd93f9", threadMatch[1])
      push("separator", "#A4A4A4", "/")
      push("level", levelColor, threadMatch[2])
      push("bracket", "#A4A4A4", "]: ")
    } else {
      push("prefix", levelColor, fullPrefix)
    }
    offset = fullPrefix.length
    remaining = text.substring(offset)
  }

  // 2. Caused by / Suppressed
  if (CAUSED_BY.test(remaining)) {
    const cbMatch = remaining.match(CAUSED_BY)
    if (cbMatch) {
      const idx = remaining.indexOf(cbMatch[0])
      if (idx > 0) push("text", undefined, remaining.substring(0, idx))
      push("caused", "#ff79c6", cbMatch[0])
      remaining = remaining.substring(idx + cbMatch[0].length)
    }
  }

  // 3. Stack trace lines
  if (STACK_TRACE_PATTERN.test(remaining)) {
    const parts = remaining.split(STACK_TRACE_PATTERN)
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) push("text", undefined, parts[i])
      } else {
        const frame = parts[i]
        // at class.method(file:line)
        const classMatch = frame.match(/^(.+?)(\.)([a-zA-Z_$][\w$]*)(\(.*\))?(\s+\(.*\))?/)
        if (classMatch) {
          const className = classMatch[1]
          push("class", getClassColor(className), className)
          push("dot", "#A4A4A4", ".")
          push("method", "#50fa7b", classMatch[3] + (classMatch[4] || ""))
          if (classMatch[5]) push("source", "#6272a4", classMatch[5])
        } else {
          push("trace", "#A4A4A4", frame)
        }
      }
    }
    remaining = ""
  }

  // 4. Exception names
  if (EXCEPTION_PATTERN.test(remaining)) {
    const parts = remaining.split(EXCEPTION_PATTERN)
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) push("text", undefined, parts[i])
      } else {
        push("exception", "#f62451", parts[i])
      }
    }
    remaining = ""
  }

  if (remaining) {
    // 5. Remaining tokenization for URLs, numbers, UUIDs, classes, etc.
    const patterns: Array<{ re: RegExp; type: string; color?: string }> = [
      { re: URL_PATTERN, type: "url", color: "#8be9fd" },
      { re: UUID_PATTERN, type: "uuid", color: "#ffb86c" },
      { re: HEX_PATTERN, type: "hex", color: "#ff79c6" },
      { re: NUMBER_PATTERN, type: "number", color: "#bd93f9" },
      { re: MIXIN_PATTERN, type: "mixin", color: "#f1fa8c" },
      { re: ANNOTATION_PATTERN, type: "annotation", color: "#f1fa8c" },
      { re: JAVA_KEYWORDS, type: "keyword", color: "#ff79c6" },
      { re: CLASS_PATTERN, type: "class", color: undefined },
    ]

    let pos = 0
    const result: Array<{ start: number; end: number; type: string; color?: string; text: string }> = []

    for (const pat of patterns) {
      let m: RegExpExecArray | null
      const localRe = new RegExp(pat.re.source, pat.re.flags.includes("g") ? pat.re.flags : pat.re.flags + "g")
      localRe.lastIndex = 0
      while ((m = localRe.exec(remaining)) !== null) {
        result.push({
          start: m.index,
          end: m.index + m[0].length,
          type: pat.type,
          color: pat.type === "class" ? getClassColor(m[0]) : pat.color,
          text: m[0],
        })
      }
    }

    result.sort((a, b) => a.start - b.start)

    // Remove overlapping
    const cleaned: typeof result = []
    for (const r of result) {
      if (cleaned.length === 0 || r.start >= cleaned[cleaned.length - 1].end) {
        cleaned.push(r)
      }
    }

    for (const r of cleaned) {
      if (pos < r.start) push("text", undefined, remaining.substring(pos, r.start))
      push(r.type, r.color, r.text)
      pos = r.end
    }
    if (pos < remaining.length) push("text", undefined, remaining.substring(pos))
  }

  if (tokens.length === 0 && text) {
    push("text", undefined, text)
  }

  return tokens
}

function renderSyntaxHighlighted(text: string, level: LogLevel): React.ReactNode {
  const tokens = tokenizeLog(text, level)
  return (
    <>
      {tokens.map((t, i) => (
        <span
          key={i}
          style={t.color ? { color: t.color } : undefined}
          className={cn(
            !t.color && t.type === "text" && txtColor(level),
            t.type === "url" && "underline decoration-[#8be9fd]/50 hover:decoration-[#8be9fd]",
            t.type === "exception" && "font-bold",
            t.type === "keyword" && "font-semibold",
          )}
        >
          {t.text}
        </span>
      ))}
    </>
  )
}

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
  if (last < text.length) {
  parts.push(<span key={`tail-${last}`} className={tc}>{text.slice(last)}</span>)
}
  return parts.length ? <>{parts}</> : <span className={tc}>{text}</span>
}

function renderLog(text: string, level: LogLevel) {
  return (level === "game" || level === "info" || OWN_FMT.test(text))
    ? renderMcLog(text, level) : <span className={LS[level]}>{text}</span>
}

// --- LogRow ---

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
          <span className="flex-1 break-all whitespace-pre-wrap">{renderSyntaxHighlighted(entry.text, entry.level)}</span>
        </>
      )}
    </div>
  )
})

// --- LogsPage ---

export function LogsPage() {
  const { logs, clearLogs, isRunning } = useLaunchLogs()
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [shareUrl, setShareUrl] = useState<string>("")
  const [filter, setFilter] = useState<LogLevel | "all">("all")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const levelLabels = useMemo(() => {
    const map: Partial<Record<LogLevel, string>> = {}
    for (const key of Object.keys(LBL_KEY) as LogLevel[]) map[key] = t(LBL_KEY[key])
    return map
  }, [t])

  const levelCounts = useMemo(() => {
    const counts = { ...EMPTY_COUNTS }
    for (const entry of logs) counts[entry.level]++
    return counts
  }, [logs])

  const filtered = useMemo(() => {
    let entries = filter === "all" ? logs : logs.filter(e => e.level === filter)
    const q = deferredSearch.trim().toLowerCase()
    if (q) entries = entries.filter(e => e.text.toLowerCase().includes(q))
    return entries
  }, [logs, filter, deferredSearch])

  useEffect(() => {
    if (!autoScroll || !containerRef.current || filtered.length === 0) return
    const el = containerRef.current
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll > 0 && el.scrollTop >= maxScroll - 80) {
      el.scrollTop = maxScroll
    }
  }, [filtered, autoScroll])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return
    const atBottom = el.scrollTop >= maxScroll - 80
    if (!atBottom && autoScroll) setAutoScroll(false)
    if (atBottom && !autoScroll) setAutoScroll(true)
  }, [autoScroll])

  const handleCopy = useCallback(() => {
    const text = filtered.map(e => e.text).join("\n")
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }, [filtered])

  const handleShare = useCallback(async () => {
    setShareState("loading")
    try {
      const text = filtered.map(e => e.text).join("\n")
      const res = await fetch("https://api.mclo.gs/1/log", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content: text }),
      })
      const data = await res.json() as { success: boolean; url?: string; error?: string }
      if (data.success && data.url) {
        setShareUrl(data.url)
        await navigator.clipboard.writeText(data.url)
        setShareState("done")
        setTimeout(() => { setShareState("idle"); setShareUrl("") }, 3000)
      } else {
        setShareState("error")
        setTimeout(() => setShareState("idle"), 3000)
      }
    } catch {
      setShareState("error")
      setTimeout(() => setShareState("idle"), 3000)
    }
  }, [filtered])

  const shareCls = cn(
    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
    shareState === "done" ? "bg-green-500/20 text-green-500" : shareState === "error" ? "bg-destructive/20 text-destructive" : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground",
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
              : shareState === "done" ? <><IconCheck className="w-4 h-4 text-green-500" />{t("logs.copied")}</>
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
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                filter === id ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              {id === "all" ? t("logs.all") : levelLabels[id as LogLevel]}
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
            {filtered.map(entry => <LogRow key={entry.id} entry={entry} label={levelLabels[entry.level] ?? entry.level} />)}
          </div>
        )}
      </div>
    </div>
  )
}





