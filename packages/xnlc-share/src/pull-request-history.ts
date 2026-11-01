import type { PullRequestMerge } from "./types.js"

/** Сравнение объединённого PR привязано к коммитам, а не к подвижным HEAD веток. */
export function resolvePullRequestMerge(commits: Record<string, { id: string; parents: string[]; message: string; createdAt: string }>, pr: { title: string; merge?: PullRequestMerge }, targetHead?: string): PullRequestMerge | undefined {
  if (pr.merge) return commits[pr.merge.targetHead] && commits[pr.merge.commit] && commits[pr.merge.sourceHead] ? pr.merge : undefined
  // Старые публикации не сохраняли ссылки PR. Восстанавливаем их только при
  // однозначном совпадении merge-коммита в истории целевой ветки.
  const reachable = new Set<string>(), pending = targetHead ? [targetHead] : Object.keys(commits)
  while (pending.length) { const id = pending.pop()!; if (!reachable.has(id)) { reachable.add(id); pending.push(...(commits[id]?.parents ?? [])) } }
  const candidates = [...reachable].map(id => commits[id]).filter(commit => commit?.parents.length === 2 && commit.message === pr.title)
  if (candidates.length !== 1) return undefined
  const commit = candidates[0]
  return { targetHead: commit.parents[0], sourceHead: commit.parents[1], commit: commit.id, at: commit.createdAt }
}
