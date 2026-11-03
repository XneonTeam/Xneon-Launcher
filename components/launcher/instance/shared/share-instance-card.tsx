import { IconCloudUpload as PublicationIcon } from "@tabler/icons-react"
import { IconX as LauncherCloseIcon } from "@tabler/icons-react"
import { IconArrowLeft as LauncherBackIcon, IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconShare, IconSettings, IconUserPlus, IconDownload, IconPlugConnectedX } from "@tabler/icons-react"
import { ShareManagementView } from "./share-management-view"
import { useShare } from "./use-share"
import { ShareButton, ShareModal } from "./share-ui"
import { ShareMembersPanel } from "./share-members-panel"
import { ShareAccessNotice } from "./share-access-notice"
import { SharePublishDialog } from "./share-publish-dialog"
import { ShareInviteDialog } from "./share-invite-dialog"
import { ShareUpdateDialog } from "./share-update-dialog"
import { VersionControlPanel } from "./version-control-panel"

export function ShareInstanceCard({ buildId, onUpdated }: { buildId: string; onUpdated(): void }) {
  const { t } = useTranslation()
  const controller = useShare(buildId)
  const { data, busy } = controller
  const [page, setPage] = useState<"share" | "members" | "publish" | "invite" | "versions" | "update" | "deletePublication" | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [target, setTarget] = useState<{ branch?: string; commit?: string; restoreMessage?: string }>({})
  const shared = !!data.link
  const available = data.eligible && data.signedIn && !data.wrongAccount
  const updated = data.link?.status === "update_available"
  const members = Object.entries(data.repository?.members ?? {})
  const canManageMembers = !!data.user && data.repository?.owner === data.user

  function close() { setIsOpen(false); controller.clearError() }
  function navigate(next: Exclude<typeof page, null>) { setPage(next); setIsOpen(true) }
  function open() {
    controller.clearError()
    navigate("share")
    void controller.refresh()
  }

  return (
    <>
      <section data-component="share-instance-card" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <IconShare className="h-4 w-4 text-primary" strokeWidth={1.75} />
            {t("share.launcher.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(updated ? "share.updateAvailable" : shared ? "share.launcher.enabled" : "share.launcher.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {updated && available && <ShareButton onClick={() => { setTarget({}); navigate("update") }}>
            <IconDownload className="h-3.5 w-3.5" />{t("share.launcher.update")}
          </ShareButton>}
          <ShareButton secondary disabled={busy} busy={busy} onClick={open}>
            {shared ? <IconSettings className="h-3.5 w-3.5 text-primary" /> : <IconShare className="h-3.5 w-3.5 text-primary" />}
            {t(shared ? "share.manage" : "share.launcher.share")}
          </ShareButton>
        </div>
      </section>

      {(page === "share" || page === "members") && <ShareModal
        open={isOpen}
        onClose={close}
        title={t(page === "members" ? "share.tabs.members" : "share.launcher.title")}
        description={t(page === "members" ? "share.members.description" : shared ? "share.launcher.manageDescription" : "share.launcher.startDescription")}
        footer={available && page === "members" ? <>
          <ShareButton secondary onClick={() => navigate("share")}>{<span className="inline-flex items-center justify-center gap-2"><LauncherBackIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.back")}</span>}</ShareButton>
          {canManageMembers && <ShareButton disabled={busy} onClick={() => navigate("invite")}><IconUserPlus className="h-3.5 w-3.5" />{t("share.launcher.invite")}</ShareButton>}
          {!shared && <ShareButton disabled={busy} onClick={() => navigate("publish")}><PublicationIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.preparePublication")}</ShareButton>}
        </> : available && page === "share" ? <>
          <ShareButton secondary onClick={close}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCloseIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.close")}</span>}</ShareButton>
          {(!shared || data.link?.role !== "viewer") && <ShareButton disabled={busy} onClick={() => navigate("publish")}>
            <PublicationIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t(shared ? "share.launcher.prepareUpdate" : "share.launcher.preparePublication")}
          </ShareButton>}
        </> : undefined}
      >
        {!available ? <ShareAccessNotice controller={controller} onClose={close} /> : page === "members" ? <ShareMembersPanel controller={controller} buildId={buildId} /> : (
          <div className="space-y-4">
            <ShareManagementView showSummary={false} shared={shared} busy={busy} memberCount={members.length} onMembers={() => navigate("members")} onVersions={() => navigate("versions")} />
            {shared && canManageMembers && <button type="button" disabled={busy} className="flex w-full items-center gap-3 rounded-xl border border-border/70 p-3 text-left text-xs font-medium transition-colors hover:bg-muted/40 disabled:opacity-50" onClick={() => navigate("deletePublication")}>
              <IconPlugConnectedX className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />{t("share.deletePublication.action")}
            </button>}

            {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
          </div>
        )}
      </ShareModal>}
      {page === "deletePublication" && <ShareModal open={isOpen} onClose={close} title={t("share.deletePublication.title")} description={t("share.deletePublication.description")} footer={<>
        <ShareButton secondary disabled={busy} onClick={() => navigate("share")}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton>
        <ShareButton busy={busy} disabled={busy || !data.repository} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
          if (!data.repository) return
          const result = await controller.run({ action: "deletePublication", buildId, repositoryId: data.repository.id })
          if (result?.detached) { close(); onUpdated() }
        }}>{t("share.deletePublication.action")}</ShareButton>
      </>}>
        {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
      </ShareModal>}
      {page === "publish" && <SharePublishDialog open={isOpen} onClose={close} controller={controller} buildId={buildId} />}
      {page === "invite" && <ShareInviteDialog open={isOpen} onClose={close} controller={controller} buildId={buildId} />}
      {page === "update" && <ShareUpdateDialog open={isOpen} onClose={close} controller={controller} buildId={buildId} {...target} onApplied={onUpdated} />}
      {page === "versions" && <ShareModal wide fixedHeight={shared} open={isOpen} onClose={close} title={t("share.launcher.versions")} description={t("share.flow.versionControlDescription")} footer={!shared ? <>
        <ShareButton secondary onClick={() => navigate("share")}>{<span className="inline-flex items-center justify-center gap-2"><LauncherBackIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.back")}</span>}</ShareButton>
        {available && <ShareButton disabled={busy} onClick={() => navigate("publish")}><PublicationIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("share.launcher.preparePublication")}</ShareButton>}
      </> : undefined}>
        {!shared ? <p className="py-8 text-sm text-muted-foreground">{t("share.history.empty")}</p> : <VersionControlPanel controller={controller} buildId={buildId} onPreview={next => { setTarget(next); navigate("update") }} onRestore={(commit, restoreMessage) => { setTarget({ commit, restoreMessage }); navigate("update") }} />}
      </ShareModal>}
    </>
  )
}
