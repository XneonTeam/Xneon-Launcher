import { useState, useCallback, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { IconBrain, IconLoader2, IconCopy, IconCheck } from "@tabler/icons-react"
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
  const unsubRef = useRef<(() => void) | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onAiStreamChunk) return
    const unsub = api.onAiStreamChunk((chunk) => {
      if (chunk.sessionId !== activeSessionIdRef.current) return
      if (chunk.delta) {
        setStreamText((prev) => prev + chunk.delta)
      }
      if (chunk.done) {
        setAnalyzing(false)
      }
    })
    unsubRef.current = unsub
    return () => { unsub(); unsubRef.current = null }
  }, [])

  const handleAnalyze = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return
    setAnalyzing(true)
    setStreamText("")
    setError(null)
    try {
      const logText = logs.map((e) => e.text).join("\n")
      activeSessionIdRef.current = crypto.randomUUID()
      const response = await api.analyzeCrash(logText, activeSessionIdRef.current)
      if (response.analysis) setStreamText(response.analysis)
      if (!response.success && response.error) {
        setError(response.error || t("ai.analysisError"))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ai.analysisError"))
    } finally {
      setAnalyzing(false)
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
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    setStreamText("")
    setError(null)
    setCopied(false)
    activeSessionIdRef.current = null
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
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {streamText}
                  {analyzing && <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />}
                </p>
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
