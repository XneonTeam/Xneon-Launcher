import { IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconArrowRight, IconGitMerge, IconGitPullRequest, IconGitPullRequestClosed, IconPlus } from "@tabler/icons-react"
import type { ShareContentPresentation } from "@xnlc/types"
import type { DiffEntry, PullRequest } from "@xnlc/share"
import { ShareButton, shareInput, shareTextarea } from "./share-ui"
import { ShareBranchSelect } from "./share-branch-select"
import { ShareAuthor } from "./share-author"
import { ShareContentChanges } from "./share-content-changes"
import { EmptyState } from "@/components/ui/empty-state"
import { ShareCommentComposer } from "./share-comment-composer"
import type { ShareContentCategory } from "./share-content-category"

const statuses = [{ state: "open", Icon: IconGitPullRequest }, { state: "closed", Icon: IconGitPullRequestClosed }, { state: "merged", Icon: IconGitMerge }] as const

export interface SharePullRequestPreview { diff: DiffEntry[]; conflicts: { path: string }[]; presentation: Record<string, ShareContentPresentation>; current?: string; incoming?: string; previewId?: string }
export function SharePullRequestsView({ requests: allRequests, branches, currentBranch, defaultBranch, editable, busy, authorName, currentUser, onCreate, onReview, onMerge, onState, onComment, clearError, canMerge = true, mergeHint, contentCategories }: {
  requests: PullRequest[]; branches: string[]; currentBranch: string; defaultBranch: string; editable: boolean; busy: boolean
  authorName(id: string): string; currentUser?: string; canMerge?: boolean | ((pr: PullRequest) => boolean); mergeHint?: string | ((pr: PullRequest) => string)
  clearError(): void
  contentCategories?: readonly ShareContentCategory[]
  onCreate(value: { title: string; description: string; source: string; target: string }): Promise<string | undefined>
  onReview(pr: PullRequest, choices: Record<string, "current" | "incoming">): Promise<SharePullRequestPreview | undefined>
  onMerge(pr: PullRequest, preview: SharePullRequestPreview, choices: Record<string, "current" | "incoming">): Promise<boolean>
  onState(pr: PullRequest): Promise<boolean>
  onComment(pr: PullRequest, text: string): Promise<boolean>
}) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [source, setSource] = useState("")
  const [target, setTarget] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [selected, setSelected] = useState<string>()
  const [filter, setFilter] = useState("open")
  const [comment, setComment] = useState("")
  const [preview, setPreview] = useState<SharePullRequestPreview>()
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [presentation, setPresentation] = useState<Record<string, ShareContentPresentation>>({})
  const [resolutions, setResolutions] = useState<Record<string, "current" | "incoming">>({})
  const sourceBranch = branches.includes(source) ? source : currentBranch
  const targetBranch = branches.includes(target) ? target : defaultBranch
  const requests = allRequests.filter(pr => pr.state === filter).slice().reverse()
  const emptyIcon = statuses.find(status => status.state === filter)?.Icon ?? IconGitPullRequest
  const pr = selected ? allRequests.find(pr => pr.id === selected) : undefined
  function resetReview() { setPreview(undefined); setReviewExpanded(false); setPresentation({}); setResolutions({}); setComment(""); clearError() }
  async function review(choices: Record<string, "current" | "incoming"> = {}) {
    if (!pr) return
    setPreview(undefined)
    const result = await onReview(pr, choices)
    if (result) { setPreview(result); setReviewExpanded(true); setPresentation(result.presentation); setResolutions(choices) }
  }
  return <div className={!pr && !creating ? "flex min-h-full flex-col gap-4" : "space-y-4"}>
    {!pr && !creating && <>
      <div className="grid shrink-0 grid-cols-1 items-center gap-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <nav aria-label={t("share.pullRequests")} className="flex w-fit max-w-full justify-self-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1 xl:col-start-2">{statuses.map(({ state, Icon }) => <button type="button" aria-current={filter === state ? "page" : undefined} key={state} onClick={() => setFilter(state)} className={`flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-[7px] text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${filter === state ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${filter === state ? "text-primary-foreground" : "text-primary"}`} strokeWidth={1.75} />{t(`share.prStates.${state}`)} <span className="tabular-nums opacity-70">{allRequests.filter(pr => pr.state === state).length}</span></button>)}</nav>
        {editable && <ShareButton className="justify-self-end xl:col-start-3" disabled={busy || branches.length < 2} onClick={() => { resetReview(); setCreating(true); setSource(currentBranch); setTarget(branches.find(branch => branch === defaultBranch && branch !== currentBranch) ?? branches.find(branch => branch !== currentBranch) ?? "") }}><IconPlus className="h-4 w-4" />{t("share.createPr")}</ShareButton>}
      </div>
      {requests.length ? <div className="divide-y divide-border/50 rounded-xl border border-border/70 px-4">
        {requests.map(request => <button type="button" key={request.id} disabled={busy} onClick={() => { resetReview(); setSelected(request.id) }} className="flex w-full items-start gap-3 py-4 text-left hover:text-primary">
          <IconGitPullRequest className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{request.title}</span><span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{request.source}<IconArrowRight className="h-3 w-3 text-primary" />{request.target}</span><span className="mt-2 block text-xs text-muted-foreground"><ShareAuthor author={request.author} name={authorName(request.author)} currentUser={currentUser} /></span></span>
        </button>)}
      </div> : <EmptyState icon={emptyIcon} title={t("share.pr.empty")} className="min-h-48 flex-1 py-8" />}
    </>}
    {creating && <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3"><ShareBranchSelect value={targetBranch} onChange={setTarget} branches={branches} label={t("share.pr.target")} disabled={busy} /><ShareBranchSelect value={sourceBranch} onChange={setSource} branches={branches} label={t("share.sourceBranch")} disabled={busy} /></div>
      <label className="block space-y-1.5 text-xs text-muted-foreground"><span>{t("share.prTitle")}</span><input className={shareInput} value={title} onChange={event => setTitle(event.target.value)} maxLength={300} /></label>
      <label className="block space-y-1.5 text-xs text-muted-foreground"><span>{t("share.pr.description")}</span><textarea className={`${shareTextarea} min-h-24 resize-y`} value={description} onChange={event => setDescription(event.target.value)} maxLength={8000} /></label>
      <p className="text-xs text-muted-foreground">{t("share.pr.direction", { source: sourceBranch, target: targetBranch })}</p>
      <div className="flex justify-end gap-2"><ShareButton secondary disabled={busy} onClick={() => setCreating(false)}>{<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("share.flow.cancel")}</span>}</ShareButton><ShareButton disabled={busy || !title.trim() || sourceBranch === targetBranch} busy={busy} onClick={async () => {
        const id = await onCreate({ title: title.trim(), description, source: sourceBranch, target: targetBranch })
        if (id) { setCreating(false); setSelected(id); setTitle(""); setDescription("") }
      }}><IconGitPullRequest className="h-4 w-4" />{t("share.createPr")}</ShareButton></div>
    </div>}
    {pr && <div className="space-y-4">
      <ShareButton secondary disabled={busy} onClick={() => { setSelected(undefined); resetReview() }}><IconArrowLeft className="h-4 w-4 text-primary" />{t("share.flow.back")}</ShareButton>
      <div className="space-y-3 border-b border-border/50 pb-4">
        <div className="flex items-center gap-3"><IconGitPullRequest className="h-5 w-5 shrink-0 text-primary" /><h3 className="min-w-0 flex-1 break-words text-lg font-semibold">{pr.title}</h3><span className="rounded-lg bg-muted px-2.5 py-1 text-xs">{t(`share.prStates.${pr.state}`)}</span></div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><ShareAuthor author={pr.author} name={authorName(pr.author)} currentUser={currentUser} /><span>{pr.source} → {pr.target}</span></div>
        {pr.description && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{pr.description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <ShareButton secondary disabled={busy} aria-expanded={!!preview && reviewExpanded} onClick={() => { if (preview) setReviewExpanded(value => !value); else void review() }}>{t(preview && reviewExpanded ? "share.collapseChanges" : "share.review")}</ShareButton>
        {editable && pr.state !== "merged" && <ShareButton secondary disabled={busy} onClick={async () => {
          if (await onState(pr)) resetReview()
        }}>{t(pr.state === "open" ? "share.closePr" : "share.reopenPr")}</ShareButton>}
      </div>
      {preview && reviewExpanded && <div className="space-y-4 rounded-xl border border-border/70 p-4">
        <ShareContentChanges changes={preview.diff} presentation={presentation} contentCategories={contentCategories} />
        {preview.conflicts.map(conflict => <div className="space-y-2 border-t border-border/50 pt-3" key={conflict.path}><p className="break-all text-xs text-destructive">{t("share.conflict")}: {conflict.path}</p><div className="flex gap-2">{(["current", "incoming"] as const).map(choice => <ShareButton secondary key={choice} disabled={busy} onClick={() => void review({ ...resolutions, [conflict.path]: choice })}>{t(choice === "current" ? "share.pr.keepTarget" : "share.pr.takeSource")}</ShareButton>)}</div></div>)}
        <p className="text-xs text-muted-foreground">{typeof mergeHint === "function" ? mergeHint(pr) : mergeHint ?? t("share.mergeLocalHint")}</p>
        {editable && pr.state === "open" && <ShareButton disabled={busy || !(typeof canMerge === "function" ? canMerge(pr) : canMerge) || !!preview.conflicts.length} busy={busy} onClick={async () => {
          if (await onMerge(pr, preview, resolutions)) resetReview()
        }}><IconGitMerge className="h-4 w-4" />{t("share.merge")}</ShareButton>}
      </div>}
      <div className="space-y-3 border-t border-border/50 pt-4">
        {pr.comments.map((entry, index) => <div key={index} className="rounded-xl border border-border/70 p-3"><div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><ShareAuthor author={entry.author} name={authorName(entry.author)} currentUser={currentUser} /><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{entry.text}</p></div>)}
        {editable && <ShareCommentComposer value={comment} onChange={setComment} busy={busy} onSend={async () => {
          if (await onComment(pr, comment.trim())) setComment("")
        }} />}
      </div>
    </div>}
  </div>
}
