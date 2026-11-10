import { IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconKey, IconEye, IconDownload, IconPuzzle, IconPhoto, IconSparkles, IconFile, IconColorSwatch } from "@tabler/icons-react"
import type { ShareResponse } from "@xnlc/types"
import { ShareButton, shareInput } from "./share-ui"
import { ShareAuthor } from "./share-author"
import { LoaderIcon, loaderLabel } from "../loader-icon"
import { EntityIcon } from "../entity-icon"
import type { ShareController } from "./use-share"
import { startShareInstallation } from "./share-install-progress"

export function ShareInstallDialog({ controller, onInstalled, onCancel }: {
  controller: ShareController
  onInstalled(): void
  onCancel?(): void
}) {
  const { t } = useTranslation()
  const [invitation, setInvitation] = useState("")
  const [preview, setPreview] = useState<ShareResponse["invitationPreview"]>()
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  async function show(value: string) {
    const result = await controller.run({ action: "invitationPreview", invitation: value })
    if (result?.invitationPreview) {
      setPreview(result.invitationPreview); setId(result.previewId!); setName(result.invitationPreview.manifest.instance.name)
    }
  }
  return (
    <div className="space-y-4">
      {!preview ? <>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><IconKey className="size-3.5 text-primary" aria-hidden="true" />{t("share.flow.inviteLink")}</span>
          <input className={shareInput + " font-mono text-xs tracking-wide"} value={invitation} onChange={event => setInvitation(event.target.value)} placeholder="XNLC-ABCD-EFGH-JKLM-NPQR-STUV" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </label>
        <div className="flex justify-end gap-2">
          {onCancel && <ShareButton secondary disabled={controller.busy} onClick={onCancel}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton>}
          <ShareButton disabled={controller.busy || !invitation.trim()} busy={controller.busy} onClick={() => void show(invitation)}><IconEye className="size-4" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.viewInstance")}</ShareButton>
        </div>
      </> : <>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 text-primary">
              {preview.manifest.instance.icon || preview.manifest.instance.coverImage
                ? <EntityIcon src={preview.manifest.instance.icon || preview.manifest.instance.coverImage} className="h-full w-full p-2 text-primary" imgClassName="h-full w-full rounded-xl object-cover" />
                : <IconColorSwatch className="h-6 w-6 text-primary" strokeWidth={1.5} />}
            </div>
            <div className="min-w-0 space-y-1.5">
              <h3 className="break-words text-base font-semibold leading-tight">{preview.manifest.instance.name}</h3>
              <div className="text-xs text-muted-foreground"><ShareAuthor author={preview.owner} name={preview.owner} /></div>
            </div>
          </div>
          {preview.manifest.instance.description && <p className="break-words text-sm leading-relaxed text-muted-foreground">{preview.manifest.instance.description}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>Minecraft {preview.manifest.instance.gameVersion}</span>
            <span className="flex items-center gap-1.5"><LoaderIcon loaderId={preview.manifest.instance.loader} className="h-4 w-4 text-primary" />{loaderLabel(preview.manifest.instance.loader)} {preview.manifest.instance.loaderVersion}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border/50 pt-3">
            {([
              ["mod", "builds.tab.mods", IconPuzzle],
              ["resourcepack", "builds.tab.resourcepacks", IconPhoto],
              ["shader", "builds.tab.shaders", IconSparkles],
              ["other", "share.flow.otherChanges", IconFile],
            ] as const).map(([kind, label, Icon]) => {
              const count = preview.manifest.entries.filter(entry => kind === "other" ? entry.kind === "config" || entry.kind === "external" : entry.kind === kind).length
              if (!count) return null
              return <span key={kind} className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-4 w-4 text-primary" strokeWidth={1.75} />{t(label)}<span className="font-medium tabular-nums text-foreground">{count}</span></span>
            })}
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">{t("share.flow.instanceName")}</span>
          <input className={shareInput} value={name} onChange={event => setName(event.target.value)} maxLength={100} />
        </label>
        <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
          {onCancel && <ShareButton secondary disabled={controller.busy} onClick={onCancel}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton>}
          <ShareButton disabled={controller.busy || !name.trim()} onClick={() => {
            startShareInstallation({ previewId: id, name, iconUrl: preview.manifest.instance.icon || preview.manifest.instance.coverImage, onStarted: onCancel, onInstalled })
          }}><IconDownload className="h-3.5 w-3.5" />{t("share.flow.installInstance")}</ShareButton>
        </div>
      </>}
      {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
    </div>
  )
}
