import type { ShareController } from "./use-share"
import { SharePullRequestsView } from "./share-pull-requests-view"

export function SharePullRequests({ controller, buildId }: { controller: ShareController; buildId: string }) {
  const { data, busy, run } = controller
  const repo = data.repository!, link = data.link!
  return <SharePullRequestsView requests={Object.values(repo.pullRequests)} branches={Object.keys(repo.branches)} currentBranch={link.branch} defaultBranch={repo.defaultBranch} editable={link.role !== "viewer"} busy={busy} authorName={id => data.memberNames?.[id] ?? id} currentUser={data.user} clearError={controller.clearError}
    onCreate={async value => { const id = crypto.randomUUID(); if (await run({ action: "command", buildId, command: { action: "pr", id, ...value } })) { await controller.refresh(); return id } }}
    onReview={async (pr, resolutions) => { const result = await run({ action: "mergePreview", buildId, source: pr.source, target: pr.target, resolutions, pullRequest: pr.id }); if (result?.merge) return { ...result.merge, presentation: result.contentPresentation ?? {} } }}
    onMerge={async (pr, preview, resolutions) => { if (await run({ action: "merge", buildId, source: pr.source, target: pr.target, expected: preview.current!, sourceHead: preview.incoming, message: pr.title, resolutions, pullRequest: pr.id })) { await controller.refresh(); return true } return false }}
    onState={async pr => { if (await run({ action: "command", buildId, command: { action: "prState", id: pr.id, state: pr.state === "open" ? "closed" : "open" } })) { await controller.refresh(); return true } return false }}
    onComment={async (pr, text) => { if (await run({ action: "command", buildId, command: { action: "comment", id: pr.id, text } })) { await controller.refresh(); return true } return false }}
  />
}
