import { CONTENT_ENTER_DELAYED } from "../content-motion"
import { useEffect, useRef, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { IconSend, IconTrash, IconTerminal2, IconCopy, IconCheck, IconShare, IconBrain, IconArrowDown, IconLoader2 } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { parseAnsi, hasAnsiCodes, stripAnsi } from "@/lib/ansi"
import { openAgentWithLog } from "@/components/launcher/agent/store"

interface ConsoleTabProps {
  serverId: string
  serverName?: string
  logs: string[]
  isRunning: boolean
  command: string
  onCommandChange: (cmd: string) => void
  onSendCommand: () => void
  onClearLogs: () => void
}

export function ConsoleTab({ serverId, serverName, logs, isRunning, command, onCommandChange, onSendCommand, onClearLogs }: ConsoleTabProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<"idle" | "loading" | "done" | "error">("idle")

  const commandHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef<number>(-1)

  // Автоскролл включён — всегда держим низ консоли. Проверять «были ли мы у низа»
  // здесь нельзя: к моменту эффекта контейнер уже вырос на всю новую порцию строк,
  // и на пачке логов (запуск сервера, загрузка модов) условие не проходило —
  // автоскролл переставал листать, хотя оставался включённым.
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [logs, autoScroll])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return
    const atBottom = el.scrollTop >= maxScroll - 80
    if (!atBottom && autoScroll) setAutoScroll(false)
    if (atBottom && !autoScroll) setAutoScroll(true)
  }, [autoScroll])

  const handleCopy = useCallback(() => {
    const text = logs.map(l => stripAnsi(l)).join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [logs])

  const handleShare = useCallback(async () => {
    setShareState("loading")
    try {
      const text = logs.map(l => stripAnsi(l)).join("\n")
      const res = await fetch("https://api.mclo.gs/1/log", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content: text }),
      })
      const data = await res.json() as { success: boolean; url?: string; error?: string }
      if (data.success && data.url) {
        await navigator.clipboard.writeText(data.url)
        setShareState("done")
        setTimeout(() => setShareState("idle"), 3000)
      } else {
        setShareState("error")
        setTimeout(() => setShareState("idle"), 3000)
      }
    } catch {
      setShareState("error")
      setTimeout(() => setShareState("idle"), 3000)
    }
  }, [logs])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (command.trim()) {
        commandHistoryRef.current.push(command.trim())
        if (commandHistoryRef.current.length > 100) commandHistoryRef.current.shift()
        historyIndexRef.current = commandHistoryRef.current.length
        onSendCommand()
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const hist = commandHistoryRef.current
      if (hist.length === 0) return
      if (historyIndexRef.current <= 0) historyIndexRef.current = hist.length
      historyIndexRef.current--
      onCommandChange(hist[historyIndexRef.current] ?? "")
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const hist = commandHistoryRef.current
      if (hist.length === 0) return
      historyIndexRef.current++
      if (historyIndexRef.current >= hist.length) {
        historyIndexRef.current = hist.length
        onCommandChange("")
      } else {
        onCommandChange(hist[historyIndexRef.current] ?? "")
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault()
      onClearLogs()
    }
  }, [command, onCommandChange, onSendCommand, onClearLogs])

  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div data-ui="server-console-tab-div-1" data-component="console-tab" className={`flex flex-col flex-1 min-h-0 p-4 gap-3 ${CONTENT_ENTER_DELAYED}`} onClick={handleContainerClick}>
      {/* Toolbar */}
      <div data-ui="server-console-tab-div-2" className="flex items-center justify-between flex-wrap gap-2">
        <div data-ui="server-console-tab-div-3" className="flex items-center gap-2">
        </div>

        <div data-ui="server-console-tab-div-4" className="flex items-center gap-1.5">
          <button data-ui="server-console-tab-button-1"
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied
              ? <><IconCheck className="w-3.5 h-3.5 text-success" />{t("logs.copied")}</>
              : <><IconCopy className="w-3.5 h-3.5" />{t("logs.copy")}</>}
          </button>

          <button data-ui="server-console-tab-button-2"
            type="button"
            disabled={shareState === "loading" || logs.length === 0}
            onClick={() => void handleShare()}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
              shareState === "done" ? "bg-success/20 text-success"
                : shareState === "error" ? "bg-destructive/20 text-destructive"
                : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground",
              (shareState === "loading" || logs.length === 0) && "opacity-50 cursor-not-allowed",
            )}
          >
            {shareState === "loading"
              ? <><IconLoader2 className="w-3.5 h-3.5 text-primary animate-spin" />{t("logs.uploading")}</>
              : shareState === "done"
              ? <><IconCheck className="w-3.5 h-3.5 text-success" />{t("logs.copied")}</>
              : shareState === "error"
              ? <><IconTrash className="w-3.5 h-3.5" />{t("logs.shareError")}</>
              : <><IconShare className="w-3.5 h-3.5" />{t("logs.share")}</>}
          </button>

          {logs.length > 0 && (
            <button data-ui="server-console-tab-button-3"
              type="button"
              onClick={() => void openAgentWithLog(logs.map(stripAnsi).join("\n"), `${serverName || serverId}-server.log`)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            >
              <IconBrain className="w-3.5 h-3.5" />{t("ai.analyze")}
            </button>
          )}

          <button data-ui="server-console-tab-button-4"
            type="button"
            onClick={onClearLogs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted/50 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <IconTrash className="w-3.5 h-3.5" />{t("logs.clear")}
          </button>
        </div>
      </div>

      {/* Log output */}
      <div data-ui="server-console-tab-div-5"
        data-slot="console-output" ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-border bg-background p-4 font-mono text-[12px] leading-5"
      >
        {logs.length === 0 ? (
          <div data-ui="server-console-tab-div-6" className="flex flex-col items-center justify-center h-full text-center">
            <IconTerminal2 className="w-10 h-10 text-muted-foreground/30 mb-3" strokeWidth={1.5} />
            <p data-ui="server-console-tab-p-1" className="text-sm text-muted-foreground">
              {isRunning ? t("servers.console.waiting") : t("servers.console.empty")}
            </p>
          </div>
        ) : (
          <div data-ui="server-console-tab-div-7" className="space-y-0.5">
            {logs.map((line, i) => (
              <AnsiLine key={i} line={line} />
            ))}
          </div>
        )}
      </div>

      {/* Auto-scroll */}
      <div data-ui="server-console-tab-div-8" className="flex items-center justify-end">
        <button data-ui="server-console-tab-button-5"
          type="button"
          onClick={(e) => { e.stopPropagation(); setAutoScroll(v => !v) }}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium transition-colors",
            autoScroll ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <IconArrowDown className="w-3 h-3" />{t("logs.autoScroll")}
        </button>
      </div>

      {/* Command input */}
      {isRunning && (
        <div data-ui="server-console-tab-div-9" className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div data-ui="server-console-tab-div-10" className="relative flex-1">
            <IconTerminal2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input data-ui="server-console-tab-input-1"
              data-slot="console-command" ref={inputRef}
              value={command}
              onChange={e => onCommandChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter command..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              autoFocus
            />
          </div>
          <button data-ui="server-console-tab-button-6"
            onClick={onSendCommand}
            disabled={!command.trim()}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]"
          >
            <IconSend className="w-4 h-4" />
          </button>
        </div>
      )}

    </div>
  )
}

function AnsiLine({ line }: { line: string }) {
  if (!hasAnsiCodes(line)) {
    return (
      <div data-ui="server-console-tab-div-11" data-component="ansi-line" className="whitespace-pre-wrap break-all text-foreground/80">{line}</div>
    )
  }

  const spans = parseAnsi(line)
  return (
    <div data-ui="server-console-tab-div-12" data-component="ansi-line" className="whitespace-pre-wrap break-all">
      {spans.map((s, i) => (
        <span data-ui="server-console-tab-span-1"
          key={i}
          style={{
            color: s.color,
            backgroundColor: s.bg,
            fontWeight: s.bold ? 700 : undefined,
            fontStyle: s.italic ? "italic" : undefined,
            textDecoration: s.underline ? "underline" : s.strikethrough ? "line-through" : undefined,
            opacity: s.dim ? 0.6 : undefined,
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  )
}
