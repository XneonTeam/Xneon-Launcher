import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { ShareRequest } from "@xnlc/types"
import { ShareButton, shareInput } from "./share-ui"
import type { ShareController } from "./use-share"
import { ShareHistoryPanel } from "./share-history-panel"
import { IconGitBranch, IconGitPullRequest, IconHistory, IconPlus } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShareBranchSelect } from "./share-branch-select"
import { SharePullRequests } from "./share-pull-requests"

export function VersionControlPanel({ controller, buildId, onPreview, onRestore }: {
  controller: ShareController
  buildId: string
  onPreview(target: { branch: string }): void
  onRestore(commit: string, message: string): void
}) {
  const { t } = useTranslation()
  const { data, busy, run } = controller
  const [tab, setTab] = useState("history")
  const [name, setName] = useState("")
  const [source, setSource] = useState("")
  const [independent, setIndependent] = useState(false)
  const repo = data.repository, link = data.link
  if (!repo || !link) return null
  const branches = Object.keys(repo.branches)
  const sourceBranch = branches.includes(source) ? source : link.branch
  async function mutate(request: ShareRequest) {
    if (await run(request)) { setName(""); await controller.refresh() }
  }
  return <div className="flex h-full min-h-0 flex-col gap-4">
    <nav aria-label={t("share.launcher.versions")} className="mx-auto flex w-fit max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {[{ value: "history", Icon: IconHistory }, { value: "branches", Icon: IconGitBranch }, { value: "pullRequests", Icon: IconGitPullRequest }].map(({ value, Icon }) => <button type="button" data-share-tab={value} aria-current={tab === value ? "page" : undefined} key={value} className={`flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-[7px] text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setTab(value)}><Icon className={`h-4 w-4 ${tab === value ? "text-primary-foreground" : "text-primary"}`} strokeWidth={1.75} />{t(value === "pullRequests" ? "share.pullRequests" : `share.tabs.${value}`)}</button>)}
    </nav>
    <div className={`min-h-0 flex-1 ${tab === "history" ? "overflow-hidden" : "overflow-y-auto pr-3"}`}>
    {tab === "history" && <ShareHistoryPanel key={`${repo.id}:${link.branch}`} controller={controller} buildId={buildId} onRestore={onRestore} />}
    {tab === "pullRequests" && <SharePullRequests controller={controller} buildId={buildId} />}
    {tab === "branches" && <div className="space-y-4">
      <div className="divide-y divide-border/50">
        {Object.entries(repo.branches).map(([branch, entry]) => <div className="flex items-center gap-3 py-3 text-sm" key={branch}>
          <IconGitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={`min-w-0 flex-1 truncate ${branch === link.branch ? "font-semibold text-primary" : "font-medium"}`}>{branch}</span>
          <ShareButton secondary disabled={busy || branch === link.branch} onClick={() => onPreview({ branch })}>{t("share.switchBranch")}</ShareButton>
          {link.role !== "viewer" && branch !== repo.defaultBranch && !entry.protected && <ShareButton secondary disabled={busy} onClick={() => void mutate({ action: "command", buildId, command: { action: "deleteBranch", name: branch } })}>{t("share.delete")}</ShareButton>}
        </div>)}
      </div>
      {link.role !== "viewer" && <div className="space-y-3 border-t border-border/50 pt-4">
        <input aria-label={t("share.branchName")} className={shareInput} value={name} onChange={event => setName(event.target.value)} placeholder={t("share.branchName")} />
        <div className="grid grid-cols-2 gap-3">
          <ShareBranchSelect value={sourceBranch} onChange={setSource} branches={branches} label={t("share.branch.source")} disabled={busy} />
          <label className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"><span>{t("share.branch.history")}</span>
            <Select value={independent ? "independent" : "linked"} onValueChange={value => setIndependent(value === "independent")} disabled={busy}>
              <SelectTrigger className="w-full rounded-xl border-border bg-muted/40" aria-label={t("share.branch.history")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="linked">{t("share.branch.linked")}</SelectItem><SelectItem value="independent">{t("share.branch.independent")}</SelectItem></SelectContent>
            </Select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t(independent ? "share.branch.independentHelp" : "share.branch.linkedHelp", { branch: sourceBranch })}</p>
        <div className="flex justify-end"><ShareButton disabled={busy || !name.trim() || !sourceBranch} onClick={() => void mutate({ action: "createBranch", buildId, name: name.trim(), source: sourceBranch, independent })}><IconPlus className="h-4 w-4" />{t("share.createBranch")}</ShareButton></div>
      </div>}
    </div>}
    </div>
    {controller.error && <p role="alert" className="shrink-0 text-sm text-destructive">{controller.error}</p>}
  </div>
}
