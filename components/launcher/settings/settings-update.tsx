import { useState, useEffect, useCallback } from "react"
import { IconShieldCheck, IconFlask, IconRefresh, IconDownload, IconCheck, IconPlayerPlay, IconLoader2, IconGitBranch } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

type UpdateStatus = "idle" | "checking" | "available" | "downloaded" | "error" | "not-available"
type UpdateChannel = "stable" | "beta"

export function SettingsUpdate() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus>("idle")
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [channel, setChannel] = useState<UpdateChannel>("stable")

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    // Загружаем текущий канал обновлений.
    void api.updateGetChannel?.().then((ch) => {
      if (ch) setChannel(ch)
    })
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

  const handleChannelChange = useCallback((next: UpdateChannel) => {
    setChannel(next)
    void window.electronAPI?.updateSetChannel?.(next)
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
    <div data-ui="settings-settings-update-div-1" data-component="settings-update" data-settings-tone="green" className="space-y-4 pt-5">
      {/* Переключатель ветки обновлений */}
      <div data-ui="settings-settings-update-div-8" className="flex flex-wrap items-center justify-between gap-4">
        <div data-ui="settings-settings-update-div-9">
          <div data-ui="settings-settings-update-div-10" className="flex items-center gap-2 font-medium text-foreground"><IconGitBranch className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("launcherUpdate.channel")}</div>
          <p data-ui="settings-settings-update-p-4" className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(channel === "stable" ? "launcherUpdate.channelDescStable" : "launcherUpdate.channelDescBeta")}</p>
        </div>
        <div data-ui="settings-settings-update-div-11" className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border">
          <button
            data-ui="settings-settings-update-button-6"
            type="button"
            onClick={() => handleChannelChange("stable")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              channel === "stable"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <IconShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {t("launcherUpdate.channelStable")}
          </button>
          <button
            data-ui="settings-settings-update-button-7"
            type="button"
            onClick={() => handleChannelChange("beta")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              channel === "beta"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <IconFlask className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {t("launcherUpdate.channelBeta")}
          </button>
        </div>
      </div>

      <div data-ui="settings-settings-update-div-12" className="border-t border-border" />

      <div data-ui="settings-settings-update-div-2" className="flex items-center justify-between">
        <div data-ui="settings-settings-update-div-3">
          <div data-ui="settings-settings-update-div-4" className="flex items-center gap-2 font-medium text-foreground"><IconDownload className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />{t("launcherUpdate.title")}</div>
        </div>
        {status === "idle" && (
          <button data-ui="settings-settings-update-button-1"
            onClick={handleCheck}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconRefresh className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.check")}
          </button>
        )}
        {status === "checking" && (
          <button data-ui="settings-settings-update-button-2" disabled className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground font-medium">
            <IconLoader2 className="w-4 h-4 text-primary animate-spin" strokeWidth={2} />
            {t("launcherUpdate.checking")}
          </button>
        )}
        {status === "available" && (
          <button data-ui="settings-settings-update-button-3"
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconDownload className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.download")}
          </button>
        )}
        {status === "downloaded" && (
          <button data-ui="settings-settings-update-button-4"
            onClick={handleInstall}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconPlayerPlay className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.restart")}
          </button>
        )}
        {(status === "not-available" || status === "error") && (
          <button data-ui="settings-settings-update-button-5"
            onClick={handleCheck}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors"
          >
            <IconRefresh className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.checkAgain")}
          </button>
        )}
      </div>

      {status === "available" && progress > 0 && (
        <div data-ui="settings-settings-update-div-5" className="space-y-2">
          <div data-ui="settings-settings-update-div-6" className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div data-ui="settings-settings-update-div-7"
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p data-ui="settings-settings-update-p-2" className="text-xs text-muted-foreground text-right">{Math.round(progress)}%</p>
        </div>
      )}

      {statusLabel && (
        <p data-ui="settings-settings-update-p-3" className={cn(
          "text-sm",
          status === "error" ? "text-destructive" :
          status === "downloaded" ? "text-success" :
          "text-muted-foreground"
        )}>
          {statusLabel}
        </p>
      )}
    </div>
  )
}
