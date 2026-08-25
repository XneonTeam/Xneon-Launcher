import { useState, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { IconBrain, IconLoader2, IconCopy, IconCheck } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useLaunchLogs } from "@/src/LaunchLogsContext"

interface AiAnalysisDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AiAnalysisDialog({ open, onOpenChange }: AiAnalysisDialogProps) {
  const { t } = useTranslation()
  const { logs } = useLaunchLogs()
  const [analyzing, setAnalyzing] = useState(false)
  const [streamText, setStreamText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const requestIdRef = useRef<string | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    const cleanupChunk = api.onAiStreamChunk((data) => {
      if (data.requestId === requestIdRef.current) {
        setStreamText((prev) => prev + data.content)
      }
    })

    const cleanupDone = api.onAiStreamDone((data) => {
      if (data.requestId === requestIdRef.current) {
        setStreamText(data.fullText)
        setAnalyzing(false)
        requestIdRef.current = null
      }
    })

    const cleanupError = api.onAiStreamError((data) => {
      if (data.requestId === requestIdRef.current) {
        setError(data.error || t("ai.analysisError"))
        setAnalyzing(false)
        requestIdRef.current = null
      }
    })

    return () => {
      cleanupChunk()
      cleanupDone()
      cleanupError()
    }
  }, [t])

  const handleAnalyze = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return
    setAnalyzing(true)
    setStreamText("")
    setError(null)

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId

    try {
      const logText = logs.map((e) => e.text).join("\n")
      await api.analyzeCrashStream(requestId, logText)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ai.analysisError"))
      setAnalyzing(false)
      requestIdRef.current = null
    }
  }, [logs, t])

  const handleCopy = useCallback(() => {
    if (streamText) {
      navigator.clipboard.writeText(streamText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [streamText])

  const handleClose = useCallback(() => {
    requestIdRef.current = null
    setStreamText("")
    setError(null)
    setCopied(false)
    setAnalyzing(false)
    onOpenChange(false)
  }, [onOpenChange])

  const hasContent = streamText.length > 0

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconBrain className="w-5 h-5 text-primary" />
            {t("ai.crashAnalysis")}
          </DialogTitle>
          <DialogDescription>{t("ai.crashAnalysisDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!hasContent && !error && !analyzing && (
            <div className="text-center py-6">
              <IconBrain className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">{t("ai.crashAnalysisPrompt")}</p>
            </div>
          )}

          {analyzing && !hasContent && (
            <div className="text-center py-6">
              <IconLoader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("ai.analyzing")}</p>
            </div>
          )}

          {hasContent && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-muted/50 border border-border min-h-[80px]">
                <ReactMarkdown
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    p: ({ children }) => <p className="text-sm text-foreground leading-relaxed mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc text-sm text-foreground ml-4 mb-2 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal text-sm text-foreground ml-4 mb-2 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="text-foreground">{children}</li>,
                    h1: ({ children }) => <h1 className="text-lg font-bold text-foreground mt-3 mb-2">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-base font-bold text-foreground mt-3 mb-2">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground mt-2 mb-1">{children}</h3>,
                    code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">{children}</code>,
                    pre: ({ children }) => <pre className="bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto mb-2">{children}</pre>,
                    strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
                    em: ({ children }) => <em className="text-foreground italic">{children}</em>,
                    a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                    blockquote: ({ children }) => <blockquote className="border-l-2 border-primary pl-3 text-muted-foreground italic mb-2">{children}</blockquote>,
                  }}
                >
                  {streamText}
                </ReactMarkdown>
                {analyzing && <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />}
              </div>
              {!analyzing && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? <IconCheck className="w-3.5 h-3.5 text-green-500" /> : <IconCopy className="w-3.5 h-3.5" />}
                  {copied ? t("ai.copied") : t("ai.copyResult")}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={handleClose}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              {t("ai.close")}
            </button>
            {!analyzing && (
              <button type="button" onClick={handleAnalyze}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <IconBrain className="w-4 h-4" />
                {hasContent ? t("ai.reanalyze") : t("ai.analyze")}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
