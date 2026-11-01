import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { McServerInfo, ServerPermissions } from "@xnlc/types"
import type { ServerHistoryCommand, ServerHistoryResponse, ServerHistoryView } from "@xnlc/share"
import { ShareModal, ShareButton, shareInput } from "../instance/shared/share-ui"
import { ShareHistoryView } from "../instance/shared/share-history-view"
import { ShareBranchesView } from "../instance/shared/share-branches-view"
import { SharePullRequestsView } from "../instance/shared/share-pull-requests-view"
import { ShareContentChanges } from "../instance/shared/share-content-changes"
import { ShareVersionNavigation, type ShareVersionTab } from "../instance/shared/share-version-navigation"
import { useMcServerState } from "@/src/hooks/use-mc-servers"
import { remoteServerError } from "./remote-access-dialog"
import { serverChanges, serverPresentation, serverContentCategories } from "./server-history-adapter"

export function useServerHistory(server: McServerInfo, enabled: boolean) {
  const { t } = useTranslation()
  const [view, setView] = useState<ServerHistoryView>(), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const generation = useRef(0), running = useRef(false)
  const showError = (error: unknown) => {
    const message = (error as Error).message ?? String(error)
    if (/Merged pull request history is unavailable/.test(message)) { setError(t("share.errors.PR_HISTORY")); return }
    const key = /Stop the server|RUNNING/.test(message) ? "stopFirst" : /Save local changes|initial version first/.test(message) ? "dirty" : /changed after|preview expired|changed during/.test(message) ? "stale" : /initial version before/.test(message) ? "initialFirst" : /no changes/.test(message) ? "noChanges" : /target branch/.test(message) ? "targetFirst" : /no common ancestor/.test(message) ? "unrelated" : /branch name/.test(message) ? "invalidBranch" : /Branch is in use/.test(message) ? "branchInUse" : undefined
    setError(key ? t(`serverHistory.${key}`) : remoteServerError(error, t))
  }
  const run = async (command: ServerHistoryCommand) => {
    if (running.current) return
    const current = generation.current
    running.current = true; setBusy(true); setError("")
    try {
      const result = await window.electronAPI!.mcServerHistory(server.id, command)
      if (current !== generation.current) return
      if (result.view) setView(result.view)
      return result
    } catch (error) { if (current === generation.current) showError(error) }
    finally { if (current === generation.current) { running.current = false; setBusy(false) } }
  }
  useEffect(() => {
    generation.current++; running.current = false; setView(undefined); setError(""); setBusy(false)
    if (enabled) void run({ action: "get" })
    return () => { generation.current++ }
  }, [server.id, enabled])
  return { view, busy, error, run, clearError: () => setError(""), showError }
}
export type ServerHistoryController = ReturnType<typeof useServerHistory>

export function ServerHistoryPanel({ server, permissions, controller }: { server: McServerInfo; permissions: ServerPermissions; controller: ServerHistoryController }) {
  const { t } = useTranslation()
  const { state } = useMcServerState(server.id)
  const { view, busy, error, run } = controller
  const [tab, setTab] = useState<ShareVersionTab>("history"), [selection, setSelection] = useState("")
  const [details, setDetails] = useState<ServerHistoryResponse>(), [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ServerHistoryResponse>(), [previewTarget, setPreviewTarget] = useState<{ branch?: string; commit?: string }>()
  const canWrite = !server.remote || permissions.versions
  const canApply = canWrite && (!server.remote || permissions.writeFiles && permissions.properties && permissions.settings)
  const stopped = state.status === "stopped"
  const selected = view?.commits.find(commit => commit.id === selection) ?? view?.commits[0]
  const branches = Object.keys(view?.branches ?? {})
  const names = Object.fromEntries([...(view?.commits.map(commit => commit.author) ?? []), ...(view?.pullRequests.flatMap(pr => [pr.author, ...(pr.comments?.map(comment => comment.author) ?? [])]) ?? [])].map(author => [author.id, author.name]))
  useEffect(() => {
    let active = true; setDetails(undefined)
    if (!selected) return
    setLoading(true)
    window.electronAPI!.mcServerHistory(server.id, { action: "details", commit: selected.id }).then(result => { if (active) setDetails(result) }).catch(error => { if (active) controller.showError(error) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [server.id, selected?.id])
  const beginPreview = async (target: { branch?: string; commit?: string }) => {
    setPreviewTarget(target); setPreview(undefined)
    const result = await run({ action: "preview", ...target })
    if (result) setPreview(result)
  }
  return <div className="flex h-full min-h-0 flex-col gap-4">
    <ShareVersionNavigation tab={tab} onChange={setTab}>
      {tab === "history" && <ShareHistoryView contentCategories={serverContentCategories(server.modloader)} commits={(view?.commits ?? []).map(commit => ({ ...commit, author: commit.author.id, changeCount: commit.changes }))} selectedId={selected?.id} head={view?.head} onSelect={setSelection} changes={serverChanges(details?.changes)} presentation={details?.presentation} authorName={id => names[id] ?? id} canRestore={canApply} busy={busy || !stopped} loading={loading} onRestore={commit => void beginPreview({ commit })} />}
      {tab === "branches" && <ShareBranchesView branches={branches} currentBranch={view?.currentBranch ?? "main"} editable={canWrite} busy={busy} canSwitch={canApply && stopped} canDelete={branch => branch !== "main" && branch !== view?.currentBranch} onSwitch={branch => void beginPreview({ branch })} onDelete={branch => void run({ action: "deleteBranch", branch })} onCreate={async (name, source, independent) => !!await run({ action: "branch", name, source, independent })} />}
      {tab === "pullRequests" && <SharePullRequestsView contentCategories={serverContentCategories(server.modloader)} requests={(view?.pullRequests ?? []).map(pr => ({ ...pr, description: pr.description ?? "", author: pr.author.id, comments: (pr.comments ?? []).map(comment => ({ ...comment, author: comment.author.id })) }))} branches={branches} currentBranch={view?.currentBranch ?? "main"} defaultBranch="main" editable={canWrite} busy={busy} authorName={id => names[id] ?? id} clearError={controller.clearError} canMerge={pr => canApply && stopped && pr.target === view?.currentBranch} mergeHint={pr => !stopped ? t("serverHistory.stopFirst") : pr.target !== view?.currentBranch ? t("serverHistory.targetFirst") : t("serverHistory.previewDescription")}
        onCreate={async value => { const result = await run({ action: "pullRequest", ...value }); return result?.view?.pullRequests.at(-1)?.id }}
        onReview={async (pr, resolutions) => { const result = await run({ action: "review", id: pr.id, resolutions }); if (result) return { diff: serverChanges(result.changes), presentation: serverPresentation(result), conflicts: (result.conflicts ?? []).map(path => ({ path })), current: result.current, incoming: result.incoming } }}
        onMerge={async (pr, review, resolutions) => { const result = await run({ action: "preview", pullRequest: pr.id, expected: review.current, sourceHead: review.incoming, resolutions }); return !!result?.previewId && !result.conflicts?.length && !!await run({ action: "apply", previewId: result.previewId }) }}
        onState={async pr => !!await run({ action: "closePullRequest", id: pr.id, reopen: pr.state === "closed" })}
        onComment={async (pr, text) => !!await run({ action: "commentPullRequest", id: pr.id, text })} />}
    </ShareVersionNavigation>
    {error && <p role="alert" className="shrink-0 text-sm text-destructive">{error}</p>}
    <ShareModal open={!!previewTarget} onClose={() => { if (!busy) setPreviewTarget(undefined) }} title={t(previewTarget?.commit ? "share.history.restoreTitle" : "share.flow.switchPreview")} description={t(previewTarget?.commit ? "share.history.restoreDescription" : "share.launcher.updateDescription")} footer={<><ShareButton secondary disabled={busy} onClick={() => setPreviewTarget(undefined)}>{t("share.flow.cancel")}</ShareButton><ShareButton busy={busy} disabled={busy || !preview} onClick={async () => { if (await run({ action: "apply", previewId: preview!.previewId! })) { setPreviewTarget(undefined); setSelection("") } }}>{t(previewTarget?.commit ? "share.history.restore" : "share.switchBranch")}</ShareButton></>}>
      <div className="space-y-4">{preview ? <ShareContentChanges contentCategories={serverContentCategories(server.modloader)} changes={serverChanges(preview.changes)} presentation={serverPresentation(preview)} /> : !error && <p className="py-6 text-center text-xs text-muted-foreground">{t("share.flow.scanning")}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>
    </ShareModal>
  </div>
}

export function ServerPublishDialog({ server, controller, onClose }: { server: McServerInfo; controller: ServerHistoryController; onClose(): void }) {
  const { t } = useTranslation()
  const { busy, error, run, view } = controller
  const [scan, setScan] = useState<ServerHistoryResponse>(), [message, setMessage] = useState("")
  useEffect(() => { let active = true; void run({ action: "scan" }).then(result => { if (active) setScan(result) }); return () => { active = false } }, [])
  return <ShareModal open onClose={() => { if (!busy) onClose() }} wide fixedHeight title={t(view?.head ? "share.launcher.publishUpdate" : "share.launcher.publishTitle")} description={t("serverHistory.publishDescription")} footer={<><ShareButton secondary disabled={busy} onClick={onClose}>{t("share.flow.cancel")}</ShareButton><ShareButton busy={busy} disabled={busy || !scan?.fingerprint} onClick={async () => { if (await run({ action: "commit", message: message.trim() || t(view?.head ? "serverHistory.defaultMessage" : "serverHistory.initialMessage"), fingerprint: scan!.fingerprint! })) onClose() }}>{t(view?.head ? "share.launcher.publishUpdate" : "share.publish")}</ShareButton></>}>
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/40">{scan ? <ShareContentChanges contentCategories={serverContentCategories(server.modloader)} expanded changes={serverChanges(scan.changes)} presentation={serverPresentation(scan)} showChangeType={!!view?.head} /> : <p className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground">{t("share.flow.scanning")}</p>}</div>
      {!!scan?.skipped?.length && <details className="shrink-0 rounded-xl border border-border/60 bg-muted/20 px-3 text-xs text-muted-foreground"><summary className="cursor-pointer py-3">{t("serverHistory.skipped", { count: scan.skipped.length })}</summary><p className="mb-3 max-h-20 overflow-auto whitespace-pre-line">{scan.skipped.join("\n")}</p></details>}
      <label className="block shrink-0 space-y-2"><span className="text-xs font-medium text-muted-foreground">{t("share.launcher.comment")}</span><input className={shareInput} value={message} onChange={event => setMessage(event.target.value)} maxLength={500} placeholder={t("serverHistory.defaultMessage")} disabled={busy} /></label>
      {error && <p role="alert" className="shrink-0 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
    </div>
  </ShareModal>
}
