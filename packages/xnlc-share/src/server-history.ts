import type { PullRequestMerge } from "./types.js"

export interface ServerHistoryFile { sha256: string; size: number }
export interface ServerHistorySnapshot { files: Record<string, ServerHistoryFile>; settings: Record<string, string | number | boolean | null> }
export interface ServerHistoryActor { id: string; name: string }
export interface ServerHistoryCommit { id: string; parents: string[]; message: string; author: ServerHistoryActor; createdAt: string; snapshot: ServerHistorySnapshot }
export interface ServerHistoryPullRequest { id: string; title: string; description?: string; source: string; target: string; author: ServerHistoryActor; createdAt: string; state: "open" | "closed" | "merged"; comments?: { author: ServerHistoryActor; text: string; at: string }[]; merge?: PullRequestMerge }
export interface ServerHistoryRepository { version: 1; currentBranch: string; branches: Record<string, string>; commits: Record<string, ServerHistoryCommit>; pullRequests: ServerHistoryPullRequest[] }
export interface ServerHistoryChange { path: string; type: "added" | "modified" | "removed"; before?: ServerHistoryFile; after?: ServerHistoryFile; beforeValue?: unknown; afterValue?: unknown }
export interface ServerHistoryView {
  currentBranch: string
  selectedBranch: string
  branches: Record<string, string>
  head: string
  commits: (Omit<ServerHistoryCommit, "snapshot"> & { changes: number })[]
  pullRequests: ServerHistoryPullRequest[]
}
export type ServerHistoryCommand =
  | { action: "get"; branch?: string }
  | { action: "details"; commit: string }
  | { action: "file"; commit: string; path: string }
  | { action: "scan" }
  | { action: "commit"; message: string; fingerprint: string }
  | { action: "branch"; name: string; source: string; independent?: boolean }
  | { action: "deleteBranch"; branch: string }
  | { action: "preview"; branch?: string; commit?: string; pullRequest?: string; expected?: string; sourceHead?: string; resolutions?: Record<string, "current" | "incoming"> }
  | { action: "apply"; previewId: string }
  | { action: "pullRequest"; title: string; description?: string; source: string; target: string }
  | { action: "closePullRequest"; id: string; reopen?: boolean }
  | { action: "commentPullRequest"; id: string; text: string }
  | { action: "review"; id: string; resolutions?: Record<string, "current" | "incoming"> }
export interface ServerHistoryResponse {
  presentation?: Record<string, { name: string; version?: string; author?: string; iconUrl?: string; source?: "local" | "modrinth" | "curseforge" }>
  view?: ServerHistoryView
  changes?: ServerHistoryChange[]
  fingerprint?: string
  skipped?: string[]
  previewId?: string
  conflicts?: string[]
  beforeText?: string
  afterText?: string
  binary?: boolean
  current?: string
  incoming?: string
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const emptyServerSnapshot = (): ServerHistorySnapshot => ({ files: Object.create(null), settings: Object.create(null) })
export function serverHistoryDiff(before: ServerHistorySnapshot, after: ServerHistorySnapshot): ServerHistoryChange[] {
  const changes: ServerHistoryChange[] = []
  for (const path of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
    const a = Object.hasOwn(before.files, path) ? before.files[path] : undefined, b = Object.hasOwn(after.files, path) ? after.files[path] : undefined
    if (a?.sha256 !== b?.sha256) changes.push({ path, type: !a ? "added" : !b ? "removed" : "modified", before: a, after: b })
  }
  for (const key of new Set([...Object.keys(before.settings), ...Object.keys(after.settings)])) if (!equal(before.settings[key], after.settings[key])) changes.push({ path: `@settings/${key}`, type: "modified", beforeValue: before.settings[key], afterValue: after.settings[key] })
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
export function serverBranchHistory(repo: ServerHistoryRepository, branch: string): ServerHistoryCommit[] {
  const pending = [repo.branches[branch]], seen = new Set<string>(), result: ServerHistoryCommit[] = []
  while (pending.length) {
    const id = pending.shift()!
    if (!id || seen.has(id)) continue
    seen.add(id)
    const commit = repo.commits[id]
    if (commit) { result.push(commit); pending.push(...commit.parents) }
  }
  return result
}
export function serverMergeBase(repo: ServerHistoryRepository, current: string, incoming: string): string | undefined {
  const ancestors = (head: string) => {
    const pending = [head], seen = new Set<string>()
    while (pending.length) { const id = pending.shift()!; if (!seen.has(id)) { seen.add(id); pending.push(...(repo.commits[id]?.parents ?? [])) } }
    return seen
  }
  const other = ancestors(incoming)
  return [...ancestors(current)].find(id => other.has(id))
}
export function mergeServerSnapshots(base: ServerHistorySnapshot, current: ServerHistorySnapshot, incoming: ServerHistorySnapshot, resolutions: Record<string, "current" | "incoming"> = {}) {
  const conflicts: string[] = [], snapshot = emptyServerSnapshot()
  for (const group of ["files", "settings"] as const) for (const key of new Set([...Object.keys(base[group]), ...Object.keys(current[group]), ...Object.keys(incoming[group])])) {
    const b = Object.hasOwn(base[group], key) ? base[group][key] : undefined, c = Object.hasOwn(current[group], key) ? current[group][key] : undefined, i = Object.hasOwn(incoming[group], key) ? incoming[group][key] : undefined
    let chosen = c
    if (equal(c, i) || equal(b, i)) chosen = c
    else if (equal(b, c)) chosen = i
    else {
      const resolution = resolutions[group === "files" ? key : `@settings/${key}`]
      if (resolution === "current") chosen = c
      else if (resolution === "incoming") chosen = i
      else conflicts.push(group === "files" ? key : `@settings/${key}`)
    }
    if (chosen !== undefined) (snapshot[group] as Record<string, unknown>)[key] = chosen
  }
  return { snapshot, conflicts }
}
