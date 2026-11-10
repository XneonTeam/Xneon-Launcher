import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { branchHistory, diff } from "@xnlc/share"
import type { ShareResponse } from "@xnlc/types"
import type { ShareController } from "./use-share"
import { ShareHistoryView } from "./share-history-view"

export function ShareHistoryPanel({ controller, buildId, onRestore }: { controller: ShareController; buildId: string; onRestore(commit: string, message: string): void }) {
  const { t } = useTranslation()
  const { repository: repo, link, memberNames } = controller.data
  const [selection, setSelection] = useState("")
  const [details, setDetails] = useState<ShareResponse["history"]>()
  const [error, setError] = useState("")
  const head = repo && link ? repo.branches[link.branch]?.head : undefined
  const commits = useMemo(() => {
    return repo && link ? branchHistory(repo, link.branch) : []
  }, [repo, link?.branch])
  const selected = commits.find(commit => commit.id === selection) ?? commits.find(commit => commit.id === head) ?? commits[0]
  const changes = useMemo(() => {
    if (!repo || !selected) return []
    const manifest = selected.snapshot.manifest
    return diff(repo.commits[selected.parents[0]]?.snapshot.manifest ?? { ...manifest, entries: [] }, manifest)
  }, [repo, selected])

  useEffect(() => {
    if (!selected) return
    const api = window.electrobunAPI
    if (!api) return
    let active = true
    setDetails(undefined); setError("")
    void api.shareExecute({ action: "history", buildId, commit: selected.id }).then(result => {
      if (!active) return
      if (result.success) setDetails(result.data.history)
      else setError(t(`share.errors.${result.error.code}`, { defaultValue: t("share.failed") }))
    }).catch(() => { if (active) setError(t("share.flow.connectionError")) })
    return () => { active = false }
  }, [buildId, selected?.id, changes, t])

  if (!repo || !link) return null
  return <ShareHistoryView commits={commits.map(commit => ({ ...commit, changeCount: diff(repo.commits[commit.parents[0]]?.snapshot.manifest ?? { ...commit.snapshot.manifest, entries: [] }, commit.snapshot.manifest).length }))} selectedId={selected?.id} onSelect={setSelection} head={head} changes={changes} presentation={details?.commitId === selected?.id ? details?.presentation : {}} authorName={id => memberNames?.[id] ?? id} currentUser={controller.data.user} canRestore={link.role !== "viewer" && selected?.manifestHash !== repo.commits[head ?? ""]?.manifestHash} busy={controller.busy} loading={!details} error={error} onRestore={onRestore} />
}
