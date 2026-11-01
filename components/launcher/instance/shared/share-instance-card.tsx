import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconShare, IconSettings, IconUsers, IconUserPlus, IconGitBranch, IconChevronRight, IconDownload, IconPackage, IconTrash } from "@tabler/icons-react"
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
  const [target, setTarget] = useState<{ branch?: string; commit?: string; restoreMessage?: string }>({})
  const shared = !!data.link
  const available = data.eligible && data.signedIn && !data.wrongAccount
  const updated = data.link?.status === "update_available"
  const members = Object.entries(data.repository?.members ?? {})
  const canManageMembers = !!data.user && data.repository?.owner === data.user

  function close() { setPage(null); controller.clearError() }
  function open() {
    controller.clearError()
    setPage("share")
    void controller.refresh()
  }

  return (
    <>
      <section data-component="share-instance-card" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <IconShare className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            {t("share.launcher.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(updated ? "share.updateAvailable" : shared ? "share.launcher.enabled" : "share.launcher.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {updated && available && <ShareButton onClick={() => { setTarget({}); setPage("update") }}>
            <IconDownload className="h-3.5 w-3.5" />{t("share.launcher.update")}
          </ShareButton>}
          <ShareButton secondary disabled={busy} busy={busy} onClick={open}>
            {shared ? <IconSettings className="h-3.5 w-3.5" /> : <IconShare className="h-3.5 w-3.5" />}
            {t(shared ? "share.manage" : "share.launcher.share")}
          </ShareButton>
        </div>
      </section>

      {(page === "share" || page === "members") && <ShareModal
        open
        onClose={close}
        title={t(page === "members" ? "share.tabs.members" : "share.launcher.title")}
        description={t(page === "members" ? "share.members.description" : shared ? "share.launcher.manageDescription" : "share.launcher.startDescription")}
        footer={available && page === "members" ? <>
          <ShareButton secondary onClick={() => setPage("share")}>{t("share.flow.back")}</ShareButton>
          {canManageMembers && <ShareButton disabled={busy} onClick={() => setPage("invite")}><IconUserPlus className="h-3.5 w-3.5" />{t("share.launcher.invite")}</ShareButton>}
          {!shared && <ShareButton disabled={busy} onClick={() => setPage("publish")}>{t("share.launcher.preparePublication")}</ShareButton>}
        </> : available && page === "share" ? <>
          <ShareButton secondary onClick={close}>{t("share.launcher.close")}</ShareButton>
          {(!shared || data.link?.role !== "viewer") && <ShareButton disabled={busy} onClick={() => setPage("publish")}>
            {t(shared ? "share.launcher.prepareUpdate" : "share.launcher.preparePublication")}
          </ShareButton>}
        </> : undefined}
      >
        {!available ? <ShareAccessNotice controller={controller} onClose={close} /> : page === "members" ? <ShareMembersPanel controller={controller} buildId={buildId} /> : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><IconPackage className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{t(shared ? "share.launcher.enabled" : "share.launcher.shareBuild")}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{shared ? data.link?.branch : t("share.launcher.startHelp")}</p>
                </div>
              </div>
              {!shared && <p className="mt-3 border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">{t("share.launcher.contentHelp")}</p>}
            </div>
            <div className="divide-y divide-border/50 rounded-2xl border border-border/70 bg-card/40 px-4">
              <button type="button" disabled={busy} className="flex w-full items-center gap-3 py-3 text-left text-sm transition-colors hover:text-primary disabled:opacity-50" onClick={() => setPage("members")}>
                <IconUsers className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{t("share.tabs.members")}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{members.length}</span>
                <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button type="button" disabled={busy} className="flex w-full items-center gap-3 py-3 text-left text-sm transition-colors hover:text-primary disabled:opacity-50" onClick={() => setPage("versions")}>
                <IconGitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{t("share.launcher.versions")}</span>
                <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            {shared && canManageMembers && <button type="button" disabled={busy} className="flex w-full items-center gap-3 rounded-xl border border-border/70 p-3 text-left text-xs font-medium transition-colors hover:bg-muted/40 disabled:opacity-50" onClick={() => setPage("deletePublication")}>
              <IconTrash className="h-4 w-4 shrink-0" />{t("share.deletePublication.action")}
            </button>}

            {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
          </div>
        )}
      </ShareModal>}
      {page === "deletePublication" && <ShareModal open onClose={close} title={t("share.deletePublication.title")} description={t("share.deletePublication.description")} footer={<>
        <ShareButton secondary disabled={busy} onClick={() => setPage("share")}>{t("share.flow.cancel")}</ShareButton>
        <ShareButton busy={busy} disabled={busy || !data.repository} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
          if (!data.repository) return
          const result = await controller.run({ action: "deletePublication", buildId, repositoryId: data.repository.id })
          if (result?.detached) { close(); onUpdated() }
        }}>{t("share.deletePublication.action")}</ShareButton>
      </>}>
        {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
      </ShareModal>}
      {page === "publish" && <SharePublishDialog open onClose={close} controller={controller} buildId={buildId} />}
      {page === "invite" && <ShareInviteDialog open onClose={close} controller={controller} buildId={buildId} />}
      {page === "update" && <ShareUpdateDialog open onClose={close} controller={controller} buildId={buildId} {...target} onApplied={onUpdated} />}
      {page === "versions" && <ShareModal wide fixedHeight={shared} open onClose={close} title={t("share.launcher.versions")} description={t("share.flow.versionControlDescription")} footer={!shared ? <>
        <ShareButton secondary onClick={() => setPage("share")}>{t("share.flow.back")}</ShareButton>
        {available && <ShareButton disabled={busy} onClick={() => setPage("publish")}>{t("share.launcher.preparePublication")}</ShareButton>}
      </> : undefined}>
        {!shared ? <p className="py-8 text-sm text-muted-foreground">{t("share.history.empty")}</p> : <VersionControlPanel controller={controller} buildId={buildId} onPreview={next => { setTarget(next); setPage("update") }} onRestore={(commit, restoreMessage) => { setTarget({ commit, restoreMessage }); setPage("update") }} />}
      </ShareModal>}
    </>
  )
}
