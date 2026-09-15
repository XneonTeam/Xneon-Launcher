import { useState, useEffect, useCallback } from "react"
import { IconRefresh, IconDownload, IconCheck, IconPlayerPlay } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { APP_VERSION } from "@/lib/app-meta"
import { useTranslation } from "react-i18next"

type UpdateStatus = "idle" | "checking" | "available" | "downloaded" | "error" | "not-available"

export function SettingsUpdate() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus>("idle")
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const unsubStatus = api.onUpdateStatus((s) => {
      if (s.status === "available") {
        setStatus("available")
        setRemoteVersion(s.version ?? null)
      } else if (s.status === "downloaded") {
        setStatus("downloaded")
        setRemoteVersion(s.version ?? null)
      } else if (s.status === "checking") {
        setStatus("checking")
      } else if (s.status === "not-available") {
        setStatus("not-available")
      } else if (s.status === "error") {
        setStatus("error")
        setErrorMsg(s.error ?? "Unknown error")
      }
    })
    const unsubProgress = api.onUpdateProgress((p) => {
      setProgress(p.percent)
    })
    return () => { unsubStatus(); unsubProgress() }
  }, [])

  const handleCheck = useCallback(async () => {
    setStatus("checking")
    setErrorMsg(null)
    setProgress(0)
    const result = await window.electronAPI?.updateCheck()
    if (!result) {
      setStatus("idle")
      return
    }
    if (result.available) {
      setStatus("available")
      setRemoteVersion(result.version ?? null)
    } else if (result.error) {
      setStatus("error")
      setErrorMsg(result.error)
    } else {
      setStatus("not-available")
    }
  }, [])

  const handleDownload = useCallback(async () => {
    setProgress(0)
    const result = await window.electronAPI?.updateDownload()
    if (!result?.success) {
      setStatus("error")
      setErrorMsg(result?.error ?? "Download failed")
    } else {
      setProgress(100)
    }
  }, [])

  const handleInstall = useCallback(() => {
    void window.electronAPI?.updateInstall()
  }, [])

  const statusLabel = (() => {
    switch (status) {
      case "checking": return t("launcherUpdate.checking")
      case "available": return t("launcherUpdate.available", { version: remoteVersion })
      case "downloaded": return t("launcherUpdate.downloaded", { version: remoteVersion })
      case "not-available": return t("launcherUpdate.notAvailable")
      case "error": return t("launcherUpdate.error", { message: errorMsg })
      default: return null
    }
  })()

  return (
    <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">{t("launcherUpdate.title")}</div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("launcherUpdate.currentVersion")} <span className="text-foreground font-medium">v{APP_VERSION}</span>
          </p>
        </div>
        {status === "idle" && (
          <button
            onClick={handleCheck}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconRefresh className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.check")}
          </button>
        )}
        {status === "checking" && (
          <button disabled className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground font-medium">
            <IconRefresh className="w-4 h-4 animate-spin" strokeWidth={2} />
            {t("launcherUpdate.checking")}
          </button>
        )}
        {status === "available" && (
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconDownload className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.download")}
          </button>
        )}
        {status === "downloaded" && (
          <button
            onClick={handleInstall}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 transition-colors"
          >
            <IconPlayerPlay className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.restart")}
          </button>
        )}
        {(status === "not-available" || status === "error") && (
          <button
            onClick={handleCheck}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors"
          >
            <IconRefresh className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.checkAgain")}
          </button>
        )}
      </div>

      {status === "available" && progress > 0 && (
        <div className="space-y-2">
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right">{Math.round(progress)}%</p>
        </div>
      )}

      {statusLabel && (
        <p className={cn(
          "text-sm",
          status === "error" ? "text-red-400" :
          status === "downloaded" ? "text-green-400" :
          "text-muted-foreground"
        )}>
          {statusLabel}
        </p>
      )}
    </div>
  )
}
