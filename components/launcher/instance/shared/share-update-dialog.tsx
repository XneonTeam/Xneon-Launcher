import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { UpdatePreview } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { ShareModal, ShareButton } from "./share-ui"
import type { ShareController } from "./use-share"
import { ShareContentChanges } from "./share-content-changes"

export function ShareUpdateDialog({ open, onClose, controller, buildId, branch, commit, restoreMessage, onApplied }: {
  open: boolean; onClose(): void; controller: ShareController; buildId: string
  branch?: string; commit?: string; restoreMessage?: string; onApplied(): void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<UpdatePreview>()
  const [presentation, setPresentation] = useState<Record<string, ShareContentPresentation>>({})
  const [id, setId] = useState("")
  const [resolutions, setResolutions] = useState<Record<string, "current" | "incoming">>({})
  async function load(choices: Record<string, "current" | "incoming"> = {}) {
    const result = await controller.run({ action: "preview", buildId, branch, commit, resolutions: choices })
    if (result?.preview) { setPreview(result.preview); setPresentation(result.contentPresentation ?? {}); setId(result.previewId!); setResolutions(choices) }
  }
  useEffect(() => {
    if (open) { setPreview(undefined); setResolutions({}); void load() }
  }, [open, buildId, branch, commit])
  return (
    <ShareModal open={open} onClose={onClose} title={t(commit ? "share.history.restoreTitle" : branch ? "share.flow.switchPreview" : "share.flow.updateTitle")} description={t(commit ? "share.history.restoreDescription" : "share.launcher.updateDescription")} footer={<>
      <ShareButton secondary onClick={onClose}>{t("share.flow.cancel")}</ShareButton>
      <ShareButton busy={controller.busy} disabled={controller.busy || !preview || !!preview.conflicts.length} onClick={async () => {
        const result = await controller.run(commit ? { action: "restoreApply", buildId, previewId: id, message: restoreMessage || t("share.history.restoreTitle") } : { action: "apply", buildId, previewId: id })
        if (result) { await controller.refresh(); onApplied(); onClose() }
      }}>{t(commit ? "share.history.restore" : branch ? "share.switchBranch" : "share.launcher.update")}</ShareButton>
    </>}>
      <div className="space-y-4">
        {!preview ? <p className="py-6 text-center text-xs text-muted-foreground">{t("share.flow.scanning")}</p> : <>
          <ShareContentChanges changes={preview.diff} presentation={presentation} />
          {preview.conflicts.map(conflict => <div key={conflict.path} className="space-y-3 border-t border-border/50 pt-3">
            <p className="text-xs text-destructive">{t("share.conflict")}: {conflict.path}</p>
            <div className="flex flex-wrap gap-2">
              {(["current", "incoming"] as const).map(choice => <ShareButton secondary key={choice} disabled={controller.busy} onClick={() => void load({ ...resolutions, [conflict.path]: choice })}>{t(`share.${choice}`)}</ShareButton>)}
            </div>
          </div>)}
        </>}
        {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
      </div>
    </ShareModal>
  )
}
