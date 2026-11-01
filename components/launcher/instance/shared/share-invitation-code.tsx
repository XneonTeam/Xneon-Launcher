import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconCopy } from "@tabler/icons-react"
import { ShareButton } from "./share-ui"

export function ShareInvitationCode({ code, hint }: { code: string; hint?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true) }
  }
  return <div className="space-y-2.5 border-t border-border/50 pt-5">
    <label htmlFor="share-invitation-code" className="block text-xs font-medium text-muted-foreground">{t("share.flow.inviteLink")}</label>
    <div className="flex items-center gap-2">
      <input id="share-invitation-code" className="h-14 w-full min-w-0 rounded-xl border border-primary/25 bg-muted/30 px-3 text-center font-mono text-sm tracking-wide text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20" value={code} readOnly onFocus={event => event.target.select()} />
      <ShareButton secondary className="h-14 w-12 px-0" aria-label={t(copied ? "share.invite.copied" : "share.invite.copyCode")} title={t(copied ? "share.invite.copied" : "share.invite.copyCode")} onClick={() => void copy()}>{copied ? <IconCheck className="h-5 w-5 text-primary" /> : <IconCopy className="h-5 w-5" />}</ShareButton>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">{hint ?? t("share.invite.installHint")}</p>
    {copied && <p role="status" className="text-xs text-primary">{t("share.launcher.linkCopied")}</p>}
    {copyFailed && <p role="alert" className="text-xs text-destructive">{t("share.invite.copyFailed")}</p>}
  </div>
}
