import { useState, useEffect, useCallback } from "react"
import { IconShieldCheck, IconFlask, IconRefresh, IconDownload, IconPlayerPlay, IconLoader2, IconGitBranch } from "@tabler/icons-react"
import { ActionConfirmDialog } from "@/components/launcher/instance/action-confirm-dialog"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

type UpdateStatus = "idle" | "checking" | "downloading" | "available" | "downloaded" | "preparing" | "error" | "not-available"
type UpdateChannel = "stable" | "beta"

// main присылает стабильные коды ошибок; неизвестные (например, текст SDK)
// показываем как есть.
const UPDATE_ERROR_KEYS: Record<string, string> = {
  "unknown-channel": "launcherUpdate.errors.unknownChannel",
  "update-in-progress": "launcherUpdate.errors.updateInProgress",
  "portable-manual-update": "launcherUpdate.errors.portableManualUpdate",
  "check-unavailable": "launcherUpdate.errors.checkUnavailable",
  "unsupported-package": "launcherUpdate.errors.unsupportedPackage",
  "manifest-hash-reused": "launcherUpdate.errors.manifestHashReused",
  "download-unavailable": "launcherUpdate.errors.downloadUnavailable",
  "unsupported-channel": "launcherUpdate.errors.unsupportedChannel",
  "update-unavailable": "launcherUpdate.errors.updateUnavailable",
  "minecraft-running": "launcherUpdate.errors.minecraftRunning",
  "update-not-prepared": "launcherUpdate.errors.updateNotPrepared",
  "cleanup-failed": "launcherUpdate.errors.cleanupFailed",
  "restart-cancelled": "launcherUpdate.errors.restartCancelled",
  "update-cancelled": "launcherUpdate.errors.restartCancelled",
  "update-install-cancelled": "launcherUpdate.errors.restartCancelled",
  "update-no-permission": "launcherUpdate.errors.noPermission",
  "update-privileges-required": "launcherUpdate.errors.noPermission",
  "update-read-only-installation": "launcherUpdate.errors.noPermission",
  "update-unsupported-installation": "launcherUpdate.errors.unsupportedInstallation",
  "update-atomic-replacement-unavailable": "launcherUpdate.errors.unsupportedInstallation",
  "update-storage-inside-installation": "launcherUpdate.errors.unsupportedInstallation",
  "update-package-manager-failed": "launcherUpdate.errors.packageFailure",
  "update-helper-exited": "launcherUpdate.errors.helperFailure",
  "update-helper-timeout": "launcherUpdate.errors.helperFailure",
  "update-startup-failed": "launcherUpdate.errors.helperFailure",
  "update-recovery-required": "launcherUpdate.errors.recoveryRequired",
  "update-insufficient-space": "launcherUpdate.errors.insufficientSpace",
  "update-verification-failed": "launcherUpdate.errors.verificationFailed",
  "Unknown error": "launcherUpdate.errors.unknown",
}

export function SettingsUpdate() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus>("idle")
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [channel, setChannel] = useState<UpdateChannel>("stable")
  const [pendingChannel, setPendingChannel] = useState<UpdateChannel | null>(null)
  const [savingChannel, setSavingChannel] = useState(false)
  const [restartPrompt, setRestartPrompt] = useState(false)
  const [deferred, setDeferred] = useState(false)
  const [deferring, setDeferring] = useState(false)
  const busy = savingChannel || deferring || status === "checking" || status === "downloading" || status === "preparing"
  const describeError = useCallback((raw: string) => {
    const key = UPDATE_ERROR_KEYS[raw]
    return key ? t(key) : raw
  }, [t])
  const showError = useCallback((error: unknown) => {
    setStatus("error")
    setErrorMsg(describeError(error instanceof Error ? error.message : String(error)))
  }, [describeError])

  useEffect(() => {
    const api = window.electrobunAPI
    if (!api) return
    let active = true
    let receivedStatus = false
    // Загружаем текущий канал обновлений.
    void api.updateGetChannel?.().then((ch) => {
      if (active && ch) setChannel(ch)
    }).catch(showError)
    void api.updateGetState?.().then(state => {
      if (!active || receivedStatus || !state) return
      setStatus(state.status)
      setRemoteVersion(state.version ?? null)
      setDeferred(state.deferred)
      setRestartPrompt(state.status === "downloaded" && !state.deferred)
    }).catch(showError)
    const unsubStatus = api.onUpdateStatus((s) => {
      receivedStatus = true
      if (s.status === "idle") {
        setStatus("idle")
        setDeferred(false)
        setRestartPrompt(false)
        setProgress(null)
      } else if (s.status === "available") {
        setStatus("available")
        setRemoteVersion(s.version ?? null)
      } else if (s.status === "downloaded") {
        setStatus("downloaded")
        setRemoteVersion(s.version ?? null)
        setDeferred(false)
        setRestartPrompt(true)
      } else if (s.status === "downloading") {
        setStatus("downloading")
      } else if (s.status === "preparing") {
        setStatus("preparing")
      } else if (s.status === "checking") {
        setStatus("checking")
      } else if (s.status === "not-available") {
        setStatus("not-available")
      } else if (s.status === "error") {
        setStatus("error")
        setErrorMsg(describeError(s.error ?? "Unknown error"))
      }
    })
    const unsubProgress = api.onUpdateProgress((p) => {
      setProgress(p.percent)
    })
    return () => { active = false; unsubStatus(); unsubProgress() }
  }, [showError])

  const confirmChannel = async () => {
    const api = window.electrobunAPI
    if (!api || !pendingChannel || busy) return
    const next = pendingChannel
    setPendingChannel(null)
    setSavingChannel(true)
    try {
      // Меняем только целевую ветку. Проверка, скачивание и перезапуск — отдельно.
      const result = await api.updateSetChannel(next)
      if (result.state === "error" && result.error) showError(result.error)
      else {
        setChannel(next)
        setStatus("idle")
        setRemoteVersion(null)
        setProgress(null)
        setDeferred(false)
        setErrorMsg(null)
      }
    } catch (error) {
      showError(error)
    } finally { setSavingChannel(false) }
  }

  const handleCheck = useCallback(async () => {
    setStatus("checking")
    setErrorMsg(null)
    setProgress(null)
    try {
      const result = await window.electrobunAPI?.updateCheck()
      if (!result) setStatus("idle")
      else if (result.error) showError(result.error)
    } catch (error) {
      showError(error)
    }
  }, [showError])

  const handleDownload = useCallback(async () => {
    setProgress(null)
    setStatus("downloading")
    try {
      const result = await window.electrobunAPI?.updateDownload()
      if (!result?.success) showError(result?.error ?? "Download failed")
    } catch (error) {
      showError(error)
    }
  }, [showError])

  const handleInstall = useCallback(() => {
    setRestartPrompt(false)
    void window.electrobunAPI?.updateInstall().catch(showError)
  }, [showError])

  const handleLater = async () => {
    if (deferring) return
    setDeferring(true)
    try {
      const result = await window.electrobunAPI?.updateDefer()
      if (!result?.success) throw new Error(result?.error ?? "Could not defer update")
      setDeferred(true)
      setRestartPrompt(false)
    } catch (error) { showError(error) }
    finally { setDeferring(false) }
  }

  const statusLabel = (() => {
    switch (status) {
      case "checking": return t("launcherUpdate.checking")
      case "available": return t("launcherUpdate.available", { version: remoteVersion })
      case "downloaded": return t(deferred ? "launcherUpdate.deferred" : "launcherUpdate.downloaded", { version: remoteVersion })
      case "not-available": return t("launcherUpdate.notAvailable")
      case "error": return t("launcherUpdate.error", { message: errorMsg })
      default: return null
    }
  })()

  return (
    <div data-ui="settings-settings-update-div-1" data-component="settings-update" data-settings-tone="green" className="space-y-4 pt-5">
      <div data-ui="settings-settings-update-div-8" className="flex flex-wrap items-center justify-between gap-4">
        <div data-ui="settings-settings-update-div-9">
          <div data-ui="settings-settings-update-div-10" className="flex items-center gap-2 font-medium text-foreground"><IconGitBranch className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("launcherUpdate.channel")}</div>
          <p data-ui="settings-settings-update-p-4" className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(channel === "stable" ? "launcherUpdate.channelDescStable" : "launcherUpdate.channelDescBeta")}</p>
        </div>
        <div data-ui="settings-settings-update-div-11" className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border">
          <button
            data-ui="settings-settings-update-button-6"
            type="button"
            aria-pressed={channel === "stable"}
            disabled={busy || channel === "stable"}
            onClick={() => setPendingChannel("stable")}
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
            aria-pressed={channel === "beta"}
            disabled={busy || channel === "beta"}
            onClick={() => setPendingChannel("beta")}
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

      <ActionConfirmDialog
        open={pendingChannel !== null}
        onClose={() => setPendingChannel(null)}
        onConfirm={() => { void confirmChannel() }}
        title={t("launcherUpdate.channel")}
        description={t("launcherUpdate.channelSwitchInfo")}
        variant="info"
        icon="info"
      />

      <Dialog open={restartPrompt} onOpenChange={setRestartPrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("launcherUpdate.restartTitle")}</DialogTitle>
            <DialogDescription>{t("launcherUpdate.restartInfo", { version: remoteVersion })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" disabled={busy} onClick={() => { void handleLater() }} className="rounded-xl border border-border px-4 py-2.5 hover:bg-muted disabled:opacity-50">{t("launcherUpdate.later")}</button>
            <button type="button" disabled={busy} onClick={handleInstall} className="rounded-xl bg-primary px-4 py-2.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{t("launcherUpdate.restartNow")}</button>
          </div>
        </DialogContent>
      </Dialog>

      <div data-ui="settings-settings-update-div-12" className="border-t border-border" />

      <div data-ui="settings-settings-update-div-2" className="flex items-center justify-between">
        <div data-ui="settings-settings-update-div-3">
          <div data-ui="settings-settings-update-div-4" className="flex items-center gap-2 font-medium text-foreground"><IconDownload className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />{t("launcherUpdate.title")}</div>
        </div>
        {status === "idle" && (
          <button data-ui="settings-settings-update-button-1"
            onClick={handleCheck}
            disabled={savingChannel}
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
            disabled={savingChannel}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconDownload className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.download")}
          </button>
        )}
        {status === "downloaded" && (
          <div className="flex flex-wrap items-center gap-2">
          {!deferred && <button type="button" onClick={() => { void handleLater() }} disabled={busy} className="rounded-xl border border-border px-4 py-2.5 hover:bg-muted disabled:opacity-50">{t("launcherUpdate.later")}</button>}
          <button data-ui="settings-settings-update-button-4"
            onClick={handleInstall}
            disabled={savingChannel}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <IconPlayerPlay className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.restartNow")}
          </button>
          </div>
        )}
        {status === "preparing" && (
          <button onClick={() => { void window.electrobunAPI?.updateCancelInstall().catch(showError) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground font-medium">
            <IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
            {t("common.cancel")}
          </button>
        )}
        {(status === "not-available" || status === "error") && (
          <button data-ui="settings-settings-update-button-5"
            onClick={handleCheck}
            disabled={savingChannel}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors"
          >
            <IconRefresh className="w-4 h-4" strokeWidth={2} />
            {t("launcherUpdate.checkAgain")}
          </button>
        )}
      </div>

      {status === "downloading" && (
        <div data-ui="settings-settings-update-div-5" className="space-y-2">
          <div data-ui="settings-settings-update-div-6" className="w-full h-2 rounded-full bg-muted overflow-hidden"
            role="progressbar" aria-label={t("launcherUpdate.download")} aria-valuenow={progress ?? undefined}>
            <div data-ui="settings-settings-update-div-7"
              className={cn("h-full rounded-full bg-primary transition-all duration-300", progress === null && "animate-pulse")}
              style={{ width: progress === null ? "100%" : `${progress}%` }}
            />
          </div>
          {progress !== null && <p data-ui="settings-settings-update-p-2" className="text-xs text-muted-foreground text-right">{Math.round(progress)}%</p>}
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
