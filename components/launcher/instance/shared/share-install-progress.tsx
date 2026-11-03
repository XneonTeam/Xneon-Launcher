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
  const activeRequest = useRef("")
  const [cancelling, setCancelling] = useState(false)
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
      setCancelling(false)
      setProgress({ operation: "modpack", title: job.name, iconUrl: job.iconUrl, phase: "preparing", current: 0, total: 100, message: t("share.flow.stage.start") })
      const requestId = crypto.randomUUID()
      activeRequest.current = requestId
      unsubscribe = window.electronAPI.onShareProgress(event => {
        if (!active || event.requestId !== requestId || event.stage === "error" || event.stage === "done") return
        const fraction = event.total > 0 ? Math.max(0, Math.min(1, event.done / event.total)) : 0
        const current = event.stage === "index" ? 95 : event.stage === "download" ? 10 + 80 * fraction : 5
        setProgress(previous => previous && ({ ...previous, phase: event.stage === "index" ? "scanning" : event.stage === "download" ? "files" : "preparing", current: Math.max(previous.current, current),
          ...(event.files ? {
            files: event.files.map(file => ({ id: file.path, fileName: file.path, name: file.name || file.path.split("/").pop() || file.path, iconUrl: file.iconUrl, status: file.status, kind: file.path.startsWith("mods/") ? "mod" as const : file.path.startsWith("resourcepacks/") ? "resourcepack" as const : file.path.startsWith("shaderpacks/") ? "shader" as const : "file" as const })),
            fileCount: event.files.length,
            completedFiles: event.files.filter(file => file.status === "complete").length,
          } : {}), message: t(`share.flow.stage.${event.stage}`, { defaultValue: t("share.flow.working") }) }))
      })
      job.onStarted?.()
      try {
        const result = await window.electronAPI.shareExecute({ action: "installInvite", previewId: job.previewId, name: job.name, requestId })
        if (!active) return
        if (!result.success) {
          if (result.error.code === "CANCELLED") { setProgress(null); setCancelling(false); return }
          const message = t(`share.errors.${result.error.code}`, { defaultValue: t("share.failed") })
          setError(result.error.filePath ? t("share.flow.fileError", { message, path: result.error.filePath }) : message)
          return
        }
        setProgress(previous => previous && ({ ...previous, phase: "complete", current: 100, total: 100, files: previous.files?.map(file => ({ ...file, status: "complete" })), completedFiles: previous.fileCount }))
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

  return <InstanceImportOverlay importProgress={progress} importError={error} isCancelling={cancelling} canCancel={progress?.phase !== "scanning"} onRetry={() => retry.current()} onCancel={() => {
    if (running.current) {
      setCancelling(true)
      void window.electronAPI?.cancelShareInstall(activeRequest.current).then(accepted => { if (!accepted) setCancelling(false) }).catch(() => setCancelling(false))
      return
    }
    setProgress(null); setError(null); installation.current = null
  }} />
}
