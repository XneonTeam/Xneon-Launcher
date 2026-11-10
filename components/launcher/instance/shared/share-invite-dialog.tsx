import { IconX as LauncherCloseIcon } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconEye, IconPencil, IconKey } from "@tabler/icons-react"
import { ShareInvitationCode } from "./share-invitation-code"
import { ShareModal, ShareButton } from "./share-ui"
import type { ShareController } from "./use-share"

export function ShareInviteDialog({ open, onClose, controller, buildId }: {
  open: boolean
  onClose(): void
  controller: ShareController
  buildId: string
}) {
  const { t, i18n } = useTranslation()
  const [code, setCode] = useState("")
  const [days, setDays] = useState("7")
  const [uses, setUses] = useState("1")
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const valid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 365 && /^\d+$/.test(uses) && Number(uses) >= 1 && Number(uses) <= 100
  const [role, setRole] = useState<"editor" | "viewer">("viewer")
  useEffect(() => { if (open) { setCode(""); setRole("viewer"); setDays("7"); setUses("1"); setExpiresAt(null) } }, [open, buildId])

  async function create() {
    if (!valid) return
    const response = await controller.run({ action: "invite", buildId, role, maxUses: Number(uses), expiresInDays: Number(days) })
    if (!response?.invitation) return
    setExpiresAt(response.invitation.expiresAt)
    setCode(response.invitation.token)
  }

  return (
    <ShareModal open={open} onClose={onClose} title={t("share.launcher.inviteTitle")} titleIcon={<IconKey className="h-4 w-4 text-primary" strokeWidth={1.75} />} description={t("share.launcher.inviteDescription")} footer={<>
      <ShareButton secondary onClick={onClose}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCloseIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.close")}</span>}</ShareButton>
      {!code && <ShareButton busy={controller.busy} disabled={controller.busy || !valid} onClick={() => void create()}><IconKey className="h-4 w-4" />{t("share.flow.createLink")}</ShareButton>}
    </>}>
      <div className="space-y-5">
        <fieldset className="space-y-2.5">
          <legend className="text-xs font-medium text-muted-foreground">{t("share.invite.permissions")}</legend>
          <div className="grid grid-cols-2 gap-3">{(["viewer", "editor"] as const).map(value => {
            const Icon = value === "viewer" ? IconEye : IconPencil
            return <label key={value} className={`relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${role === value ? "border-primary/50 bg-primary/5" : "border-border bg-card/40 hover:bg-muted/30"} ${controller.busy ? "pointer-events-none opacity-50" : ""}`}>
              <input type="radio" className="sr-only" name="share-invite-role" value={value} checked={role === value} disabled={controller.busy || !!code} onChange={() => { setRole(value); setCode("") }} />
              <span className="flex items-center justify-between gap-2"><Icon className={`h-5 w-5 ${role === value ? "text-primary" : "text-primary"}`} strokeWidth={1.75} /><span className={`flex h-4 w-4 items-center justify-center rounded-full border ${role === value ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{role === value && <IconCheck className="h-3 w-3 text-primary" strokeWidth={2.5} />}</span></span>
              <span><span className="block text-sm font-medium">{t(`share.roles.${value}`)}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t(`share.invite.${value}Help`)}</span></span>
            </label>
          })}</div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-2 text-xs font-medium text-muted-foreground"><span>{t("share.invite.durationDays")}</span><input type="number" min={1} max={365} step={1} value={days} disabled={controller.busy || !!code} onChange={event => setDays(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" /><span className="block font-normal">{t("share.invite.daysRange")}</span></label>
          <label className="space-y-2 text-xs font-medium text-muted-foreground"><span>{t("share.invite.maxUses")}</span><input type="number" min={1} max={100} step={1} value={uses} disabled={controller.busy || !!code} onChange={event => setUses(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" /><span className="block font-normal">{t("share.invite.usesRange")}</span></label>
        </div>
        {code && <><ShareInvitationCode key={code} code={code} />{expiresAt !== null && <p className="text-xs text-muted-foreground">{t("share.invite.expiresAt", { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" }).format(expiresAt) })}</p>}</>}
        {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
      </div>
    </ShareModal>
  )
}
