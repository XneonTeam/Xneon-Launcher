import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useShare } from "./use-share"
import { ShareModal } from "./share-ui"
import { ShareAccessNotice } from "./share-access-notice"
import { ShareInstallDialog } from "./share-install-dialog"
import { ShareUpdateDialog } from "./share-update-dialog"

export function ShareEntryHandler() {
  const { t } = useTranslation()
  const [invitation, setInvitation] = useState("")
  const [installOpen, setInstallOpen] = useState(false)
  const [reviewBuild, setReviewBuild] = useState("")
  const controller = useShare(reviewBuild)
  const available = controller.data.eligible && controller.data.signedIn && !controller.data.wrongAccount
  function close() { setInvitation(""); setInstallOpen(false); setReviewBuild("") }

  useEffect(() => {
    const off = window.electronAPI?.onShareInvitation(event => {
      setInvitation(event.invitation); setInstallOpen(true); setReviewBuild(""); void controller.refresh()
    })
    void window.electronAPI?.shareExecute({ action: "pendingInvitation" }).then(result => {
      if (result.success && result.data.pendingInvitation) { setInvitation(result.data.pendingInvitation); setInstallOpen(true) }
    })
    const review = (event: Event) => {
      setInvitation("")
      setInstallOpen(false)
      setReviewBuild((event as CustomEvent<{ buildId: string }>).detail.buildId)
    }
    window.addEventListener("launcher:share-review", review)
    const install = () => { setInvitation(""); setInstallOpen(true); setReviewBuild(""); void controller.refresh() }
    window.addEventListener("launcher:share-install", install)
    return () => { off?.(); window.removeEventListener("launcher:share-review", review); window.removeEventListener("launcher:share-install", install) }
  }, [])

  return (
    <>
      {(installOpen || !!reviewBuild && !available) && <ShareModal open onClose={close} title={t(installOpen ? "share.flow.installTitle" : "share.launcher.title")} description={t("share.launcher.installDescription")}>
        {available
          ? <ShareInstallDialog key={invitation} controller={controller} initialInvitation={invitation} onInstalled={close} onCancel={close} />
          : <ShareAccessNotice controller={controller} onClose={close} />}
      </ShareModal>}
      {!!reviewBuild && !!available && <ShareUpdateDialog open onClose={close} controller={controller} buildId={reviewBuild} onApplied={() => window.dispatchEvent(new Event("launcher:share-updated"))} />}
    </>
  )
}
