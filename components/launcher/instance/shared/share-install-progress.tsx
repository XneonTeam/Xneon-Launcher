import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ImportProgress } from "@xnlc/types"
import { InstanceImportOverlay } from "../instance-import-overlay"

interface Installation {
  previewId: string
  name: string
  iconUrl?: string
  onStarted?(): void
  onInstalled(): void
}

export function startShareInstallation(installation: Installation) {
  window.dispatchEvent(new CustomEvent<Installation>("launcher:share-install-start", { detail: installation }))
}

/** Владелец установки остаётся смонтированным после закрытия окна приглашения. */
export function ShareInstallProgress() {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const installation = useRef<Installation | null>(null)
  const running = useRef(false)
  const retry = useRef<() => void>(() => {})
  const translate = useRef(t)
  translate.current = t

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    async function run(job: Installation) {
      if (running.current || !window.electronAPI) return
      const t = translate.current
      running.current = true
      installation.current = job
      setError(null)
      setProgress({ operation: "modpack", title: job.name, iconUrl: job.iconUrl, phase: "preparing", current: 0, total: 100, message: t("share.flow.stage.start") })
      const requestId = crypto.randomUUID()
      unsubscribe = window.electronAPI.onShareProgress(event => {
        if (!active || event.requestId !== requestId || event.stage === "error" || event.stage === "done") return
        const fraction = event.total > 0 ? Math.max(0, Math.min(1, event.done / event.total)) : 0
        const current = event.stage === "index" ? 95 : event.stage === "download" ? 10 + 80 * fraction : 5
        setProgress(previous => previous && ({ ...previous, phase: event.stage === "index" ? "scanning" : event.stage === "download" ? "files" : "preparing", current: Math.max(previous.current, current), message: t(`share.flow.stage.${event.stage}`, { defaultValue: t("share.flow.working") }) }))
      })
      job.onStarted?.()
      try {
        const result = await window.electronAPI.shareExecute({ action: "installInvite", previewId: job.previewId, name: job.name, requestId })
        if (!active) return
        if (!result.success) {
          const message = t(`share.errors.${result.error.code}`, { defaultValue: t("share.failed") })
          setError(result.error.filePath ? t("share.flow.fileError", { message, path: result.error.filePath }) : message)
          return
        }
        setProgress(previous => previous && ({ ...previous, phase: "complete", current: 100, total: 100 }))
        job.onInstalled()
      } catch {
        if (active) setError(t("share.flow.connectionError"))
      } finally {
        unsubscribe?.()
        unsubscribe = undefined
        running.current = false
      }
    }
    retry.current = () => { if (installation.current) void run(installation.current) }
    const start = (event: Event) => { void run((event as CustomEvent<Installation>).detail) }
    window.addEventListener("launcher:share-install-start", start)
    return () => { active = false; unsubscribe?.(); window.removeEventListener("launcher:share-install-start", start) }
  }, [])

  return <InstanceImportOverlay importProgress={progress} importError={error} isCancelling={false} canCancel={false} onRetry={() => retry.current()} onCancel={() => { setProgress(null); setError(null); installation.current = null }} />
}
