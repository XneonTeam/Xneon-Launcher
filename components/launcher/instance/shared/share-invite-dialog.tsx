import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCopy, IconCheck, IconEye, IconPencil, IconKey } from "@tabler/icons-react"
import { ShareModal, ShareButton } from "./share-ui"
import type { ShareController } from "./use-share"

export function ShareInviteDialog({ open, onClose, controller, buildId }: {
  open: boolean
  onClose(): void
  controller: ShareController
  buildId: string
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState("")
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [role, setRole] = useState<"editor" | "viewer">("viewer")
  useEffect(() => { if (open) { setCode(""); setCopied(false); setCopyFailed(false); setRole("viewer") } }, [open, buildId])

  async function create() {
    const response = await controller.run({ action: "invite", buildId, role, maxUses: 1 })
    if (!response?.invitation) return
    setCode(response.invitation.token); setCopied(false)
  }

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true) }
  }

  return (
    <ShareModal open={open} onClose={onClose} title={t("share.launcher.inviteTitle")} titleIcon={<IconKey className="h-4 w-4" strokeWidth={1.75} />} description={t("share.launcher.inviteDescription")} footer={<>
      <ShareButton secondary onClick={onClose}>{t("share.launcher.close")}</ShareButton>
      {!code && <ShareButton busy={controller.busy} disabled={controller.busy} onClick={() => void create()}><IconKey className="h-4 w-4" />{t("share.flow.createLink")}</ShareButton>}
    </>}>
      <div className="space-y-5">
        <fieldset className="space-y-2.5">
          <legend className="text-xs font-medium text-muted-foreground">{t("share.invite.permissions")}</legend>
          <div className="grid grid-cols-2 gap-3">{(["viewer", "editor"] as const).map(value => {
            const Icon = value === "viewer" ? IconEye : IconPencil
            return <label key={value} className={`relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${role === value ? "border-primary/50 bg-primary/5" : "border-border bg-card/40 hover:bg-muted/30"} ${controller.busy ? "pointer-events-none opacity-50" : ""}`}>
              <input type="radio" className="sr-only" name="share-invite-role" value={value} checked={role === value} disabled={controller.busy} onChange={() => { setRole(value); setCode(""); setCopied(false); setCopyFailed(false) }} />
              <span className="flex items-center justify-between gap-2"><Icon className={`h-5 w-5 ${role === value ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.75} /><span className={`flex h-4 w-4 items-center justify-center rounded-full border ${role === value ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{role === value && <IconCheck className="h-3 w-3" strokeWidth={2.5} />}</span></span>
              <span><span className="block text-sm font-medium">{t(`share.roles.${value}`)}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t(`share.invite.${value}Help`)}</span></span>
            </label>
          })}</div>
        </fieldset>
        {code && <div className="space-y-2.5 border-t border-border/50 pt-5">
          <label htmlFor="share-invitation-code" className="block text-xs font-medium text-muted-foreground">{t("share.flow.inviteLink")}</label>
          <div className="flex items-center gap-2">
            <input id="share-invitation-code" className="h-14 w-full min-w-0 rounded-xl border border-primary/25 bg-muted/30 px-3 text-center font-mono text-sm tracking-wide text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" value={code} readOnly onFocus={event => event.target.select()} />
            <ShareButton secondary className="h-14 w-12 px-0" aria-label={t(copied ? "share.invite.copied" : "share.invite.copyCode")} title={t(copied ? "share.invite.copied" : "share.invite.copyCode")} onClick={() => void copy()}>{copied ? <IconCheck className="h-5 w-5 text-primary" /> : <IconCopy className="h-5 w-5" />}</ShareButton>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("share.invite.installHint")}</p>
          {copied && <p role="status" className="text-xs text-primary">{t("share.launcher.linkCopied")}</p>}
          {copyFailed && <p role="alert" className="text-xs text-destructive">{t("share.invite.copyFailed")}</p>}
        </div>}
        {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
      </div>
    </ShareModal>
  )
}
