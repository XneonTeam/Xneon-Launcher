import { IconX as LauncherCloseIcon } from "@tabler/icons-react"
import { IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconLoader2, IconCloudUpload, IconShieldCheck, IconGitCommit, IconGitCompare, IconFiles } from "@tabler/icons-react"
import type { ScanResult, DiffEntry } from "@xnlc/share"
import { MAX_FILE_BYTES } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { ShareModal, ShareButton, shareInput, bytesLabel } from "./share-ui"
import { ShareFileTree } from "./share-file-tree"
import type { ShareController } from "./use-share"
import { ShareContentChanges } from "./share-content-changes"
import { ShareContentIdentity } from "./share-content-identity"

const contentPath = (path: string) => /^(mods|resourcepacks|shaderpacks)\//.test(path)

export function SharePublishDialog({ open, onClose, controller, buildId }: {
  open: boolean
  onClose(): void
  controller: ShareController
  buildId: string
}) {
  const { t } = useTranslation()
  const [scan, setScan] = useState<ScanResult>()
  const [presentation, setPresentation] = useState<Record<string, ShareContentPresentation>>({})
  const [previewId, setPreviewId] = useState("")
  const [tab, setTab] = useState<"changes" | "files">("changes")
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const [success, setSuccess] = useState<{ uploaded: number; reused: number }>()
  const [publishing, setPublishing] = useState(false)
  const [transfer, setTransfer] = useState({ stage: "start", done: 0, total: 1, bytes: 0 })
  const requestId = useRef("")
  const shared = !!controller.data.link
  const indeterminate = transfer.stage === "start" || transfer.stage === "commit" || transfer.total <= 0
  const percent = Math.min(100, Math.max(0, Math.round(100 * transfer.done / Math.max(transfer.total, 1))))
  const TransferIcon = transfer.stage === "upload" ? IconCloudUpload : transfer.stage === "commit" ? IconGitCommit : IconShieldCheck

  useEffect(() => {
    if (!open) return
    return window.electronAPI?.onShareProgress(event => {
      if (event.requestId === requestId.current && event.buildId === buildId && !["done", "error"].includes(event.stage)) setTransfer(event)
    })
  }, [open, buildId])

  useEffect(() => {
    if (!open) return
    let active = true
    setScan(undefined); setPresentation({}); setSelected([]); setSuccess(undefined); setMessage(""); setTab("changes")
    void controller.run({ action: "scan", buildId }).then(result => {
      if (active && result?.scan) {
        setScan(result.scan); setPresentation(result.contentPresentation ?? {}); setPreviewId(result.previewId!)
        setSelected([...new Set([...result.scan.manifest.entries.filter(entry => !contentPath(entry.path)).map(entry => entry.path), ...(result.scan.changes?.filter(change => !change.path.startsWith("@") && !contentPath(change.path)).map(change => change.path) ?? [])])])
      }
    })
    return () => { active = false }
  }, [open, buildId])

  const content = scan?.manifest.entries.filter(entry => contentPath(entry.path)) ?? []
  const additional = scan?.manifest.entries.filter(entry => !contentPath(entry.path)) ?? []
  const changes: DiffEntry[] = scan?.changes?.filter(change => contentPath(change.path) || change.path.startsWith("@instance/") || selected.includes(change.path))
    ?? (scan?.manifest.entries.filter(entry => contentPath(entry.path) || selected.includes(entry.path)) ?? []).map(entry => ({ path: entry.path, type: "added", changes: [] }))

  async function publish() {
    if (publishing) return
    requestId.current = crypto.randomUUID()
    setPublishing(true)
    setTransfer({ stage: "start", done: 0, total: 1, bytes: 0 })
    const paths = [
      ...content.map(entry => entry.path),
      ...(scan?.changes?.flatMap(change => change.before && contentPath(change.before.path) ? [change.before.path] : []) ?? []),
      ...selected, "@instance", "@exclusions",
    ]
    try {
    const result = await controller.run({
      action: shared ? "push" : "publish", buildId, previewId, selected: paths,
      requestId: requestId.current,
      message: message.trim() || (shared ? "Update instance" : "Initial commit"),
    })
    if (result) {
      setSuccess({ uploaded: result.uploadedBytes ?? 0, reused: result.reusedBytes ?? 0 })
      await controller.refresh()
    }
    } finally { setPublishing(false); requestId.current = "" }
  }

  return (
    <ShareModal
      wide
      fixedHeight={!success}
      open={open}
      onClose={() => { if (!publishing) onClose() }}
      title={t(success ? "share.launcher.published" : shared ? "share.launcher.publishUpdate" : "share.launcher.publishTitle")}
      description={t(success ? "share.flow.publishedDescription" : "share.launcher.publishDescription")}
      footer={success ? <ShareButton onClick={onClose}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCloseIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.close")}</span>}</ShareButton> : <>
        <ShareButton secondary disabled={publishing} onClick={onClose}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton>
        <ShareButton disabled={controller.busy || !scan} busy={controller.busy} onClick={() => void publish()}>
          {t(shared ? "share.launcher.publishUpdate" : "share.publish")}
        </ShareButton>
      </>}
    >
      {success ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><IconCheck className="h-6 w-6 text-primary" /></div>
          <p className="text-sm font-medium">{t("share.flow.published")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("share.flow.transferResult", { uploaded: bytesLabel(success.uploaded), reused: bytesLabel(success.reused) })}</p>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex shrink-0 gap-1 rounded-xl border border-border/70 bg-muted/30 p-1" aria-label={t("share.launcher.publishTitle")}>
            {(["changes", "files"] as const).map(value => {
              const Icon = value === "changes" ? IconGitCompare : IconFiles
              return <button
                type="button"
                key={value}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                {t(value === "changes" && !shared ? "share.launcher.content" : `share.flow.${value}`)}
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{value === "changes" ? changes.length : selected.length}</span>
              </button>
            })}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/40">
            {!scan && <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-xs text-muted-foreground">
              {controller.busy && <IconLoader2 className="h-6 w-6 animate-spin text-primary" />}
              {t(controller.busy ? "share.flow.scanning" : "share.failed")}
            </div>}
            {scan && tab === "changes" && <ShareContentChanges expanded changes={changes} presentation={presentation} showChangeType={shared} />}
            {scan && tab === "files" && <>
              <p className="shrink-0 border-b border-border/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">{t("share.launcher.filesDescription")}</p>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
                {additional.length ? <ShareFileTree files={additional} selected={selected} onChange={setSelected} />
                  : <p className="flex h-full items-center justify-center py-6 text-xs text-muted-foreground">{t("share.flow.noAdditionalFiles")}</p>}
                {!!scan.blockedDetails?.length && <details className="mt-3 rounded-xl border border-border/60 bg-muted/20 px-3">
                  <summary className="cursor-pointer py-3 text-xs text-muted-foreground">{t("share.flow.blockedFiles", { count: scan.blockedDetails.length })}</summary>
                  <div className="divide-y divide-border/50">{scan.blockedDetails.map(file => <div key={file.path} className="space-y-1 py-3 text-xs">
                    <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate" title={file.path}>{file.path}</span><span className="shrink-0 text-muted-foreground">{bytesLabel(file.size)}</span></div>
                    <p className="text-muted-foreground">{t(file.reason === "size" ? "share.flow.blockedSize" : "share.flow.blockedFormat", { size: MAX_FILE_BYTES / 1024 / 1024 })}</p>
                  </div>)}</div>
                </details>}
              </div>
              <p className="shrink-0 border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">{t("share.flow.fileSizeLimit", { size: MAX_FILE_BYTES / 1024 / 1024 })}</p>
            </>}
          </div>
          {publishing && <div className="shrink-0 space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3" role="status" aria-live="polite">
            {content.length > 0 && <div className="max-h-36 space-y-2 overflow-y-auto border-b border-border/50 pb-2 pr-1" aria-live="off">
              {content.map(entry => <div key={entry.path} className="flex items-center gap-3 rounded-lg bg-card/40 p-2">
                <ShareContentIdentity path={entry.path} presentation={presentation[entry.path]} />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{bytesLabel(entry.size)}</span>
              </div>)}
            </div>}
            <div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><TransferIcon className="size-4 shrink-0 text-primary" strokeWidth={1.75} /><IconLoader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />{t(`share.flow.stage.${transfer.stage}`, { defaultValue: t("share.flow.working") })}</span>{!indeterminate && <span className="font-medium tabular-nums">{percent}%</span>}</div>
            <div role="progressbar" aria-label={t("share.publish")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : percent} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none ${indeterminate ? "animate-pulse" : ""}`} style={{ width: indeterminate ? "100%" : `${percent}%` }} /></div>
            {transfer.bytes > 0 && <p className="text-xs tabular-nums text-muted-foreground">{t("share.flow.uploadedBytes", { size: bytesLabel(transfer.bytes) })}</p>}
          </div>}
          <label className="block shrink-0 space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{t("share.launcher.comment")}</span>
            <input className={shareInput} value={message} onChange={event => setMessage(event.target.value)} placeholder={t("share.flow.updateNotePlaceholder")} maxLength={500} disabled={controller.busy} />
          </label>
          {controller.error && <p role="alert" className="shrink-0 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{controller.error}</p>}
        </div>
      )}
    </ShareModal>
  )
}
