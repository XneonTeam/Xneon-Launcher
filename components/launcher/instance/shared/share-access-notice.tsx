import { useTranslation } from "react-i18next"
import { IconUserPlus } from "@tabler/icons-react"
import { ShareButton } from "./share-ui"
import type { ShareController } from "./use-share"

export function ShareAccessNotice({ controller, onClose }: { controller: ShareController; onClose(): void }) {
  const { t } = useTranslation()
  const { data, busy, error } = controller
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t(data.eligible === false ? "share.launcher.accountRequired" : data.wrongAccount ? "share.launcher.noAccess" : busy ? "share.launcher.connecting" : "share.flow.serviceUnavailable")}
      </p>
      {data.eligible === false ? (
        <ShareButton onClick={() => {
          onClose()
          window.dispatchEvent(new CustomEvent("launcher:open-section", { detail: { section: "accounts" } }))
        }}>
          <IconUserPlus className="h-3.5 w-3.5" />
          {t("share.launcher.openAccounts")}
        </ShareButton>
      ) : (
        <ShareButton secondary disabled={busy} busy={busy} onClick={() => void controller.refresh()}>
          {t("share.launcher.retry")}
        </ShareButton>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
