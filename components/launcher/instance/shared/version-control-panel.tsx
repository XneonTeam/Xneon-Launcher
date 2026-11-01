import { useState } from "react"
import type { ShareController } from "./use-share"
import { ShareHistoryPanel } from "./share-history-panel"
import { SharePullRequests } from "./share-pull-requests"
import { ShareBranchesView } from "./share-branches-view"
import { ShareVersionNavigation, type ShareVersionTab } from "./share-version-navigation"

export function VersionControlPanel({ controller, buildId, onPreview, onRestore }: {
  controller: ShareController; buildId: string
  onPreview(target: { branch: string }): void
  onRestore(commit: string, message: string): void
}) {
  const [tab, setTab] = useState<ShareVersionTab>("history")
  const { data, busy, run } = controller
  const repo = data.repository, link = data.link
  if (!repo || !link) return null
  return <div className="flex h-full min-h-0 flex-col gap-4">
    <ShareVersionNavigation tab={tab} onChange={setTab}>
      {tab === "history" && <ShareHistoryPanel key={`${repo.id}:${link.branch}`} controller={controller} buildId={buildId} onRestore={onRestore} />}
      {tab === "pullRequests" && <SharePullRequests controller={controller} buildId={buildId} />}
      {tab === "branches" && <ShareBranchesView branches={Object.keys(repo.branches)} currentBranch={link.branch} editable={link.role !== "viewer"} busy={busy} canDelete={branch => branch !== repo.defaultBranch && !repo.branches[branch].protected}
        onSwitch={branch => onPreview({ branch })}
        onDelete={branch => { void run({ action: "command", buildId, command: { action: "deleteBranch", name: branch } }).then(result => { if (result) void controller.refresh() }) }}
        onCreate={async (name, source, independent) => { if (await run({ action: "createBranch", buildId, name, source, independent })) { await controller.refresh(); return true } return false }} />}
    </ShareVersionNavigation>
    {controller.error && <p role="alert" className="shrink-0 text-sm text-destructive">{controller.error}</p>}
  </div>
}
