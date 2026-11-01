import type { Manifest, ContentEntry, DiffEntry, MergeResult, Repository, RepositoryCommand, Role, Commit, HashPort } from "./types.js"
import { fail, stable, validateManifest, manifestHash } from "./manifest.js"
import { LAUNCH_SETTING_KEYS } from "./launch-settings.js"
import type { SharedLaunchSettings } from "./types.js"

export function diff(before: Manifest, after: Manifest): DiffEntry[] {
  const old = new Map(before.entries.map(e => [e.path, e]))
  const next = new Map(after.entries.map(e => [e.path, e]))
  const result: DiffEntry[] = []
  const consumed = new Set<string>()
  const identity = (entry: ContentEntry) => entry.source ? JSON.stringify([entry.kind, entry.source.provider, entry.source.projectId]) : undefined
  const removedByProject = new Map<string, ContentEntry[]>()
  const addedByProject = new Map<string, ContentEntry[]>()
  for (const [entries, other, grouped] of [[before.entries, next, removedByProject], [after.entries, old, addedByProject]] as const) {
    for (const entry of entries) {
      const project = identity(entry)
      if (project && !other.has(entry.path)) grouped.set(project, [...(grouped.get(project) ?? []), entry])
    }
  }
  for (const e of before.entries) {
    const n = next.get(e.path)
    if (n) {
      const changes = ["sha256", "size", "enabled", "kind", "source"].filter(k => stable(e[k as keyof ContentEntry] ?? null) !== stable(n[k as keyof ContentEntry] ?? null))
      if (changes.length) result.push({ path: e.path, type: "modified", before: e, after: n, changes })
    } else {
      const rename = after.entries.find(n => !old.has(n.path) && !consumed.has(n.path) && n.sha256 === e.sha256 && n.size === e.size)
      if (rename) { consumed.add(rename.path); result.push({ path: rename.path, type: "renamed", before: e, after: rename, changes: ["path"] }) }
      else {
        const project = identity(e)
        const candidates = project ? addedByProject.get(project) : undefined
        // Обновление одного проекта меняет и байты, и имя JAR. При нескольких
        // версиях одного проекта не угадываем соответствие между файлами.
        const replacement = project && removedByProject.get(project)?.length === 1 && candidates?.length === 1 && !consumed.has(candidates[0].path) ? candidates[0] : undefined
        if (replacement) {
          consumed.add(replacement.path)
          const changes = ["sha256", "size", "enabled", "kind", "source"].filter(key => stable(e[key as keyof ContentEntry] ?? null) !== stable(replacement[key as keyof ContentEntry] ?? null))
          result.push({ path: replacement.path, type: "modified", before: e, after: replacement, changes: ["path", ...changes] })
        } else result.push({ path: e.path, type: "removed", before: e, changes: [] })
      }
    }
  }
  for (const n of after.entries) if (!old.has(n.path) && !consumed.has(n.path)) result.push({ path: n.path, type: "added", after: n, changes: [] })
  for (const key of new Set([...Object.keys(before.instance), ...Object.keys(after.instance)].filter(key => key !== "launchSettings")) as Set<Exclude<keyof Manifest["instance"], "launchSettings">>) if ((before.instance[key] ?? "") !== (after.instance[key] ?? "")) result.push({ path: `@instance/${key}`, type: "modified", changes: [before.instance[key] ?? "", after.instance[key] ?? ""] })
  for (const key of LAUNCH_SETTING_KEYS) {
    const a = before.instance.launchSettings?.[key], b = after.instance.launchSettings?.[key]
    if (stable(a ?? null) !== stable(b ?? null)) result.push({ path: `@instance/launchSettings/${key}`, type: "modified", changes: [typeof a === "string" ? a : stable(a ?? null), typeof b === "string" ? b : stable(b ?? null)] })
  }
  if (stable(before.exclusions) !== stable(after.exclusions)) result.push({ path: "@exclusions", type: "modified", changes: [stable(before.exclusions), stable(after.exclusions)] })
  return result
}
export function merge(base: Manifest, current: Manifest, incoming: Manifest, resolutions: Record<string, "current" | "incoming"> = {}): MergeResult {
  const conflicts: MergeResult["conflicts"] = []
  function choose<T>(path: string, b: T, c: T, i: T): T {
    if (stable(c) === stable(i) || stable(b) === stable(i)) return c
    if (stable(b) === stable(c)) return i
    if (resolutions[path]) return resolutions[path] === "current" ? c : i
    conflicts.push({ path, base: b, current: c, incoming: i }); return c
  }
  const maps = [base, current, incoming].map(m => new Map(m.entries.map(e => [e.path, e])))
  const entries: ContentEntry[] = []
  for (const path of new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])) {
    const entry = choose(path, maps[0].get(path) ?? null, maps[1].get(path) ?? null, maps[2].get(path) ?? null)
    if (entry) entries.push(entry)
  }
  const instance = { ...current.instance }
  for (const key of Object.keys(instance).filter(key => key !== "icon" && key !== "coverImage" && key !== "launchSettings") as Exclude<keyof typeof instance, "icon" | "coverImage" | "launchSettings">[]) instance[key] = choose(`@instance/${key}`, base.instance[key], current.instance[key], incoming.instance[key])
  for (const key of ["icon", "coverImage"] as const) if ([base, current, incoming].some(manifest => manifest.instance[key] !== undefined)) instance[key] = choose(`@instance/${key}`, base.instance[key] ?? "", current.instance[key] ?? "", incoming.instance[key] ?? "")
  const oldLaunch = base.instance.launchSettings ?? current.instance.launchSettings
  const localLaunch = current.instance.launchSettings ?? oldLaunch ?? incoming.instance.launchSettings
  const nextLaunch = incoming.instance.launchSettings ?? oldLaunch ?? localLaunch
  if (localLaunch && nextLaunch) instance.launchSettings = Object.fromEntries(LAUNCH_SETTING_KEYS.map(key => [key, choose(`@instance/launchSettings/${key}`, oldLaunch?.[key], localLaunch[key], nextLaunch[key])])) as unknown as SharedLaunchSettings
  const exclusions = choose("@exclusions", base.exclusions, current.exclusions, incoming.exclusions)
  return { manifest: { schemaVersion: 1, instance, entries, exclusions }, conflicts }
}
export function isAncestor(repo: Repository, ancestor: string, head: string): boolean {
  const pending = [head], seen = new Set<string>()
  while (pending.length) { const id = pending.pop()!; if (id === ancestor) return true; if (!seen.has(id)) { seen.add(id); pending.push(...(repo.commits[id]?.parents ?? [])) } }
  return false
}
/** Все предки HEAD, включая историю до ответвления и коммиты слитых веток. */
export function branchHistory(repo: Repository, branchName: string): Commit[] {
  const branch = repo.branches[branchName]
  if (!branch) return []
  const reachable = new Map<string, Commit>(), pending = [branch.head]
  while (pending.length) {
    const id = pending.pop()!
    if (reachable.has(id)) continue
    const commit = repo.commits[id]
    if (!commit) return []
    reachable.set(id, commit)
    pending.push(...[...commit.parents].reverse())
  }
  // Дочерние коммиты всегда идут раньше родителей, независимо от часов автора.
  const children = new Map([...reachable.keys()].map(id => [id, 0]))
  for (const commit of reachable.values()) for (const parent of commit.parents) children.set(parent, children.get(parent)! + 1)
  const order = new Map([...reachable.keys()].map((id, index) => [id, index]))
  const ready = [...reachable.values()].filter(commit => children.get(commit.id) === 0)
  const result: Commit[] = []
  while (ready.length) {
    ready.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || order.get(a.id)! - order.get(b.id)!)
    const commit = ready.shift()!
    result.push(commit)
    for (const parent of commit.parents) {
      children.set(parent, children.get(parent)! - 1)
      if (children.get(parent) === 0) ready.push(reachable.get(parent)!)
    }
  }
  return result.length === reachable.size ? result : []
}
export function mergeBase(repo: Repository, a: string, b: string): string {
  const pending = [a], seen = new Set<string>()
  while (pending.length) { const id = pending.shift()!; if (isAncestor(repo, id, b)) return id; if (!seen.has(id)) { seen.add(id); pending.push(...(repo.commits[id]?.parents ?? [])) } }
  return fail("HISTORY", "No common ancestor")
}
export async function createCommit(input: { repositoryId: string; author: string; message: string; description?: string; manifest: Manifest; parents: Commit[]; now: string; type?: Commit["type"] }, hash: HashPort): Promise<Commit> {
  if (!input.message.trim() || input.message.length > 500 || (input.description?.length ?? 0) > 8000) fail("MESSAGE", "Commit message is required and must fit limits")
  const manifest = validateManifest(input.manifest)
  const root = await manifestHash(manifest, hash)
  const snapshot = { id: await hash.digest(new TextEncoder().encode(stable({ root, parent: input.parents[0]?.snapshot.id ?? null, createdAt: input.now }))), rootHash: root, manifest, parent: input.parents[0]?.snapshot.id ?? null, createdAt: input.now,
    statistics: { managed: manifest.entries.filter(e => e.source).length, external: manifest.entries.filter(e => e.object).length, bytes: manifest.entries.reduce((s, e) => s + e.size, 0) } }
  const data = { repositoryId: input.repositoryId, author: input.author, parents: input.parents.map(p => p.id), message: input.message.trim(), description: input.description ?? "", createdAt: input.now, manifestHash: root, snapshot, type: input.type ?? (input.parents.length === 0 ? "INITIAL" : input.parents.length === 2 ? "MERGE" : "COMMIT") } satisfies Omit<Commit, "id">
  return { ...data, id: await hash.digest(new TextEncoder().encode(stable(data))) }
}
export function emptyRepository(id: string, owner: string): Repository {
  return { id, owner, members: { [owner]: "owner" }, branches: {}, commits: {}, defaultBranch: "main", stashes: {}, pullRequests: {}, releases: {} }
}
function name(value: string): void { if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) fail("NAME", "Invalid name") }
export function mutateRepository(input: Repository, user: string, command: RepositoryCommand, now: string): Repository {
  const r: Repository = structuredClone(input)
  const role: Role | undefined = Object.hasOwn(r.members, user) ? r.members[user] : undefined
  if (!role) fail("FORBIDDEN", "Repository membership required")
  const manager = role === "owner" || role === "editor"
  if (role === "viewer") fail("FORBIDDEN", "Read-only membership")
  const c = command
  if (c.action === "push") {
    name(c.branch)
    const branch = r.branches[c.branch]
    const commit = c.commit
    if (commit.author !== user || commit.repositoryId !== r.id) fail("COMMIT", "Invalid commit identity")
    if (branch && branch.head !== c.expected || !branch && c.expected !== null) fail("NON_FAST_FORWARD", "Branch HEAD changed; pull before pushing")
    if (!branch && (c.branch !== "main" || Object.keys(r.commits).length)) fail("BRANCH", "Create branch before pushing")
    if (branch?.protected && !manager || !manager && branch?.owner !== user) fail("FORBIDDEN", "Branch is protected or owned by another member")
    if (commit.parents.length > 2 || commit.parents.some(p => !r.commits[p]) || (branch && commit.parents[0] !== branch.head) || (!branch && (commit.parents.length !== 0 || commit.type !== "INITIAL"))) fail("PARENTS", "Invalid commit parents")
    if (Object.hasOwn(r.commits, commit.id)) fail("COMMIT", "Commit already exists")
    r.commits[commit.id] = commit
    r.branches[c.branch] = { head: commit.id, owner: branch?.owner ?? user, protected: branch?.protected ?? true, ...(branch?.base ? { base: branch.base } : {}) }
    if (c.pullRequest) {
      const pr = r.pullRequests[c.pullRequest]
      if (!manager || !pr || pr.state !== "open" || pr.target !== c.branch || commit.parents[1] !== r.branches[pr.source]?.head) fail("PR", "Pull request changed before merge")
      pr.state = "merged"
    }
  } else if (c.action === "fastForward") {
    const branch = r.branches[c.branch]
    if (!branch || branch.head !== c.expected) fail("NON_FAST_FORWARD", "Branch HEAD changed")
    if (!manager && (branch.protected || branch.owner !== user)) fail("FORBIDDEN", "Branch is protected or owned by another member")
    if (!r.commits[c.head] || !isAncestor(r, c.expected, c.head)) fail("NON_FAST_FORWARD", "Target is not a descendant")
    if (c.pullRequest) {
      const pr = r.pullRequests[c.pullRequest]
      if (!manager || !pr || pr.state !== "open" || pr.target !== c.branch || !r.branches[pr.source] || !isAncestor(r, r.branches[pr.source].head, c.head)) fail("PR", "Pull request changed before merge")
      pr.state = "merged"
    }
    branch.head = c.head
  } else if (c.action === "branch") {
    name(c.name); if (Object.hasOwn(r.branches, c.name) || !r.commits[c.from]) fail("BRANCH", "Branch exists or commit is missing")
    if (c.initial) {
      if (c.initial.repositoryId !== r.id || c.initial.author !== user || c.initial.parents.length || c.initial.type !== "INITIAL" || c.initial.snapshot.parent !== null || c.initial.manifestHash !== r.commits[c.from].manifestHash || Object.hasOwn(r.commits, c.initial.id)) fail("COMMIT", "Invalid independent branch initial state")
      r.commits[c.initial.id] = c.initial
    }
    const head = c.initial?.id ?? c.from
    r.branches[c.name] = { head, owner: user, protected: false, base: head }
  } else if (c.action === "member") {
    if (role !== "owner" || c.user === r.owner || !/^[a-zA-Z0-9_-]{1,100}$/.test(c.user) || c.role !== null && !["viewer", "editor"].includes(c.role)) fail("FORBIDDEN", "Owner permission required")
    if (c.role) r.members[c.user] = c.role; else delete r.members[c.user]
  } else if (c.action === "deleteBranch" || c.action === "renameBranch" || c.action === "protect" || c.action === "defaultBranch") {
    const b = r.branches[c.name]; if (!b || !manager && b.owner !== user) fail("FORBIDDEN", "Branch management denied")
    if (c.action === "deleteBranch") { if (c.name === r.defaultBranch || b.protected) fail("BRANCH", "Cannot delete default/protected branch"); delete r.branches[c.name] }
    if (c.action === "renameBranch") { name(c.to); if (Object.hasOwn(r.branches, c.to)) fail("BRANCH", "Branch exists"); r.branches[c.to] = b; delete r.branches[c.name]; if (r.defaultBranch === c.name) r.defaultBranch = c.to }
    if (c.action === "protect") { if (!manager) fail("FORBIDDEN", "Manager required"); b.protected = c.protected }
    if (c.action === "defaultBranch") { if (!manager) fail("FORBIDDEN", "Manager required"); r.defaultBranch = c.name }
  } else if (c.action === "stash") {
    name(c.id); if (!r.commits[c.base] || Object.hasOwn(r.stashes, c.id)) fail("STASH", "Invalid stash")
    r.stashes[c.id] = { author: user, base: c.base, manifest: validateManifest(c.manifest) }
  } else if (c.action === "dropStash") {
    if (!r.stashes[c.id] || r.stashes[c.id].author !== user) fail("FORBIDDEN", "Stash ownership required"); delete r.stashes[c.id]
  } else if (c.action === "pr") {
    name(c.id); if (Object.hasOwn(r.pullRequests, c.id) || !r.branches[c.source] || !r.branches[c.target] || c.source === c.target || !c.title?.trim() || c.title.length > 300 || c.description.length > 8000) fail("PR", "Invalid pull request")
    try { mergeBase(r, r.branches[c.source].head, r.branches[c.target].head) } catch { fail("UNRELATED_BRANCHES", "Independent branches have no common history") }
    r.pullRequests[c.id] = { ...c, author: user, state: "open", comments: [] }
  } else if (c.action === "comment") {
    const pr = r.pullRequests[c.id]; if (!pr || !c.text?.trim() || c.text.length > 8000) fail("PR", "Invalid comment"); pr.comments.push({ author: user, text: c.text, at: now })
  } else if (c.action === "prState") {
    const pr = r.pullRequests[c.id]; if (!pr || !manager && pr.author !== user || pr.state === "merged" || !["open", "closed"].includes(c.state)) fail("FORBIDDEN", "Cannot change pull request"); pr.state = c.state
  } else fail("COMMAND", "Unsupported repository command")
  return r
}
