import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, ShareError, stable, remoteFilePath, emptyServerSnapshot, serverHistoryDiff, serverBranchHistory, serverMergeBase, mergeServerSnapshots, type ServerHistoryActor, type ServerHistoryCommand, type ServerHistoryRepository, type ServerHistorySnapshot, type ServerHistoryResponse } from "@xnlc/share"
import { ShareWorktree } from "../share/worktree"
import { resolvePullRequestMerge } from "@xnlc/share"

interface Ports { root: string; store: string; settings(): Promise<ServerHistorySnapshot["settings"]>; saveSettings(settings: ServerHistorySnapshot["settings"]): Promise<void>; isRunning(): boolean }
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
function fail(code: string, message: string): never { throw new ShareError(code, message) }
const skipDirectory = new Set(["logs", "crash-reports", "cache", ".cache", "libraries", "runtime", "versions", "jars", ".git", ".xnlc-share"])
type Preview = { id: string; actor: string; expiresAt: number; repository: string; fingerprint: string; snapshot: ServerHistorySnapshot; branch?: string; target?: string; pullRequest?: string; conflicts: string[] }

/** История и объекты хранятся отдельно от папки сервера и никогда не загружаются в Cloudflare. */
export class ServerHistory {
  private queue: Promise<unknown> = Promise.resolve()
  private previews = new Map<string, Preview>()
  private disposed = false
  constructor(private ports: Ports) {}
  run(command: ServerHistoryCommand, actor: ServerHistoryActor): Promise<ServerHistoryResponse> {
    if (this.disposed) return Promise.reject(new ShareError("REMOTE_DELETED", "Server publication history was deleted"))
    const result = this.queue.then(() => this.execute(command, actor))
    this.queue = result.catch(() => {})
    return result
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await this.queue
    this.previews.clear()
  }
  private async load(): Promise<ServerHistoryRepository> {
    await fs.mkdir(this.ports.store, { recursive: true })
    if ((await fs.lstat(this.ports.store)).isSymbolicLink()) fail("PATH", "History directory cannot be a link")
    await this.recoverPending()
    try {
      const repository = JSON.parse(await fs.readFile(path.join(this.ports.store, "repository.json"), "utf8"))
      if (repository.version !== 1 || !repository.commits || !repository.branches || !Array.isArray(repository.pullRequests) || !Object.hasOwn(repository.branches, repository.currentBranch)) fail("HISTORY", "Invalid server history")
      return repository
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, currentBranch: "main", branches: { main: "" }, commits: {}, pullRequests: [] }
      throw error
    }
  }
  private async recoverPending() {
    const journalPath = path.join(this.ports.store, "pending-apply.json")
    const journal = await fs.readFile(journalPath, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error }) as { before: ServerHistorySnapshot; after: ServerHistorySnapshot; beforeRepo: string; afterRepo: string } | null
    if (!journal) return
    this.stopped()
    const tree = new ShareWorktree(this.ports.root)
    await tree.recover()
    const persisted = JSON.parse(await fs.readFile(path.join(this.ports.store, "repository.json"), "utf8"))
    const persistedHash = digest(stable(persisted))
    if (persistedHash === journal.afterRepo) { await fs.rm(journalPath); return }
    if (persistedHash !== journal.beforeRepo) fail("HISTORY", "Server history changed during interrupted update")
    const rollback: Parameters<ShareWorktree['apply']>[0] = []
    for (const change of serverHistoryDiff(journal.before, journal.after).filter(change => !change.path.startsWith("@"))) {
      const actual = await tree.hash(change.path).then(hash => hash.sha256).catch(error => { if (error.code === "ENOENT") return null; throw error })
      if (actual === (change.before?.sha256 ?? null)) continue
      if (actual !== (change.after?.sha256 ?? null)) fail("LOCAL_CHANGED", "Server file changed after interrupted update")
      rollback.push({ path: change.path, expected: actual, bytes: change.before ? await this.object(change.before.sha256) : null })
    }
    await tree.apply(rollback)
    await this.ports.saveSettings(journal.before.settings)
    await fs.rm(journalPath)
  }
  private async save(repository: ServerHistoryRepository) {
    const value = JSON.stringify(repository)
    if (Buffer.byteLength(value) > 64 * 1024 * 1024) fail("QUOTA", "Server history metadata exceeds limit")
    const next = path.join(this.ports.store, `repository-${randomUUID()}.tmp`)
    await fs.writeFile(next, value)
    await fs.rename(next, path.join(this.ports.store, "repository.json"))
  }
  private stopped() { if (this.ports.isRunning()) fail("RUNNING", "Stop the server before saving or applying a version") }
  private async scan(materialize = false) {
    this.stopped()
    const snapshot = emptyServerSnapshot(), skipped: string[] = []
    snapshot.settings = await this.ports.settings()
    let total = 0, count = 0
    const walk = async (directory: string, prefix = "") => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name
        if (entry.isSymbolicLink()) { skipped.push(relative); continue }
        if (entry.isDirectory()) {
          if (!skipDirectory.has(entry.name.toLowerCase())) await walk(path.join(directory, entry.name), relative + "/")
          continue
        }
        if (!entry.isFile() || entry.name === "session.lock") continue
        remoteFilePath(relative)
        const file = path.join(directory, entry.name), before = await fs.stat(file, { bigint: true })
        if (before.size > BigInt(MAX_FILE_BYTES)) { skipped.push(relative); continue }
        total += Number(before.size)
        if (++count > 10000 || total > MAX_TOTAL_BYTES) fail("QUOTA", "Server version exceeds file or size limits")
        const hash = createHash("sha256")
        for await (const chunk of createReadStream(file)) hash.update(chunk)
        const after = await fs.stat(file, { bigint: true })
        if (before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.size !== after.size || before.ctimeNs !== after.ctimeNs) fail("LOCAL_CHANGED", "Server file changed during scan")
        const sha256 = hash.digest("hex")
        snapshot.files[relative] = { sha256, size: Number(after.size) }
        if (materialize) {
          const object = path.join(this.ports.store, "objects", sha256)
          await fs.mkdir(path.dirname(object), { recursive: true })
          if (!await fs.stat(object).then(() => true).catch(() => false)) {
            const bytes = await fs.readFile(file)
            if (digest(bytes) !== sha256) fail("LOCAL_CHANGED", "Server file changed after scan")
            await fs.writeFile(object, bytes, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error })
          }
        }
      }
    }
    await fs.mkdir(this.ports.root, { recursive: true })
    await walk(this.ports.root)
    return { snapshot, skipped, fingerprint: digest(stable(snapshot)) }
  }
  private view(repository: ServerHistoryRepository, branch = repository.currentBranch) {
    if (!Object.hasOwn(repository.branches, branch)) fail("BRANCH", "Branch not found")
    return { currentBranch: repository.currentBranch, selectedBranch: branch, branches: repository.branches, head: repository.branches[branch], commits: serverBranchHistory(repository, branch).slice(0, 200).map(({ snapshot, ...commit }) => ({ ...commit, changes: serverHistoryDiff(repository.commits[commit.parents[0]]?.snapshot ?? emptyServerSnapshot(), snapshot).length })), pullRequests: repository.pullRequests }
  }
  private addCommit(repository: ServerHistoryRepository, snapshot: ServerHistorySnapshot, message: string, actor: ServerHistoryActor, parents: string[]) {
    if (typeof message !== "string" || !message.trim() || message.length > 500) fail("MESSAGE", "Commit message is required")
    const id = randomUUID()
    repository.commits[id] = { id, parents, snapshot, message: message.trim(), author: actor, createdAt: new Date().toISOString() }
    return id
  }
  private async object(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) fail("HISTORY", "Invalid history object")
    const bytes = await fs.readFile(path.join(this.ports.store, "objects", hash))
    if (digest(bytes) !== hash) fail("INTEGRITY", "Server history object is corrupt")
    return bytes
  }
  private async execute(command: ServerHistoryCommand, actor: ServerHistoryActor): Promise<ServerHistoryResponse> {
    const repo = await this.load(), head = repo.branches[repo.currentBranch], current = repo.commits[head]?.snapshot ?? emptyServerSnapshot()
    if (command.action === "get") return { view: this.view(repo, command.branch) }
    if (command.action === "details" || command.action === "file") {
      const commit = repo.commits[command.commit]
      if (!commit) fail("HISTORY", "Version not found")
      const before = repo.commits[commit.parents[0]]?.snapshot ?? emptyServerSnapshot()
      if (command.action === "details") return { changes: serverHistoryDiff(before, commit.snapshot) }
      const a = Object.hasOwn(before.files, command.path) ? before.files[command.path] : undefined, b = Object.hasOwn(commit.snapshot.files, command.path) ? commit.snapshot.files[command.path] : undefined
      if (!a && !b) fail("PATH", "File is not in this version")
      if ((a?.size ?? 0) > 128 * 1024 || (b?.size ?? 0) > 128 * 1024) return { binary: true }
      const read = async (hash?: string) => hash ? this.object(hash) : Buffer.alloc(0)
      const oldBytes = await read(a?.sha256), newBytes = await read(b?.sha256)
      try {
        if (oldBytes.includes(0) || newBytes.includes(0)) return { binary: true }
        return { beforeText: new TextDecoder("utf-8", { fatal: true }).decode(oldBytes), afterText: new TextDecoder("utf-8", { fatal: true }).decode(newBytes) }
      } catch { return { binary: true } }
    }
    if (command.action === "scan" || command.action === "commit") {
      const scan = await this.scan(command.action === "commit")
      if (command.action === "commit") {
        if (scan.fingerprint !== command.fingerprint) fail("LOCAL_CHANGED", "Server changed after preview")
        if (head && !serverHistoryDiff(current, scan.snapshot).length) fail("NO_CHANGES", "Server has no changes")
        repo.branches[repo.currentBranch] = this.addCommit(repo, scan.snapshot, command.message, actor, head ? [head] : [])
        await this.save(repo)
      }
      return { view: this.view(repo), changes: serverHistoryDiff(current, scan.snapshot), fingerprint: scan.fingerprint, skipped: scan.skipped }
    }
    if (command.action === "branch") {
      if (typeof command.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/.test(command.name) || command.name.includes("..") || command.name.endsWith("/") || Object.hasOwn(repo.branches, command.name)) fail("BRANCH", "Invalid or existing branch name")
      const source = repo.branches[command.source]
      if (!source || !repo.commits[source]) fail("HISTORY", "Save the initial version before creating branches")
      repo.branches[command.name] = command.independent ? this.addCommit(repo, repo.commits[source].snapshot, `Initial state: ${command.name}`, actor, []) : source
      await this.save(repo); return { view: this.view(repo) }
    }
    if (command.action === "deleteBranch") {
      if (command.branch === "main" || command.branch === repo.currentBranch || repo.pullRequests.some(pr => pr.state === "open" && [pr.source, pr.target].includes(command.branch))) fail("BRANCH", "Branch is in use")
      delete repo.branches[command.branch]; await this.save(repo); return { view: this.view(repo) }
    }
    if (command.action === "pullRequest") {
      if (!repo.branches[command.source] || !repo.branches[command.target] || command.source === command.target || typeof command.title !== "string" || !command.title.trim() || command.title.length > 300 || command.description !== undefined && (typeof command.description !== "string" || command.description.length > 8000)) fail("PULL_REQUEST", "Invalid pull request")
      if (repo.pullRequests.some(pr => pr.state === "open" && pr.source === command.source && pr.target === command.target)) fail("PULL_REQUEST", "Pull request already exists")
      if (serverMergeBase(repo, repo.branches[command.target], repo.branches[command.source]) === repo.branches[command.source]) fail("NO_CHANGES", "Server has no changes")
      repo.pullRequests.push({ id: randomUUID(), source: command.source, target: command.target, title: command.title.trim(), description: command.description ?? "", author: actor, createdAt: new Date().toISOString(), state: "open", comments: [] })
      await this.save(repo); return { view: this.view(repo) }
    }
    if (command.action === "commentPullRequest") {
      const pr = repo.pullRequests.find(pr => pr.id === command.id)
      if (!pr || typeof command.text !== "string" || !command.text.trim() || command.text.length > 8000) fail("PULL_REQUEST", "Invalid pull request comment")
      ;(pr.comments ??= []).push({ author: actor, text: command.text.trim(), at: new Date().toISOString() })
      await this.save(repo); return { view: this.view(repo) }
    }
    if (command.action === "review") {
      const pr = repo.pullRequests.find(pr => pr.id === command.id)
      if (!pr) fail("PULL_REQUEST", "Pull request not found")
      if (pr.state === "merged") {
        const saved = resolvePullRequestMerge(repo.commits, pr, repo.branches[pr.target])
        if (!saved) fail("PR_HISTORY", "Merged pull request history is unavailable")
        return { current: saved.targetHead, incoming: saved.sourceHead, changes: serverHistoryDiff(repo.commits[saved.targetHead].snapshot, repo.commits[saved.commit].snapshot), conflicts: [] }
      }
      if (!repo.branches[pr.source] || !repo.branches[pr.target]) fail("PULL_REQUEST", "Pull request not found")
      const currentHead = repo.branches[pr.target], incoming = repo.branches[pr.source], base = serverMergeBase(repo, currentHead, incoming)
      if (!base) fail("HISTORY", "Branches have no common ancestor")
      const merged = mergeServerSnapshots(repo.commits[base].snapshot, repo.commits[currentHead].snapshot, repo.commits[incoming].snapshot, command.resolutions)
      return { current: currentHead, incoming, changes: serverHistoryDiff(repo.commits[currentHead].snapshot, merged.snapshot), conflicts: merged.conflicts }
    }
    if (command.action === "closePullRequest") {
      const pr = repo.pullRequests.find(pr => pr.id === command.id)
      if (!pr || pr.state === "merged") fail("PULL_REQUEST", "Pull request not found")
      pr.state = command.reopen ? "open" : "closed"; await this.save(repo); return { view: this.view(repo) }
    }
    if (command.action === "preview") {
      const observed = await this.scan()
      if (head && serverHistoryDiff(current, observed.snapshot).length) fail("DIRTY", "Save local changes before switching or restoring versions")
      let branch = command.branch, target = command.commit ?? (branch ? repo.branches[branch] : undefined), snapshot = target ? repo.commits[target]?.snapshot : undefined
      let conflicts: string[] = []
      if (command.pullRequest) {
        const pr = repo.pullRequests.find(pr => pr.id === command.pullRequest && pr.state === "open")
        if (!pr || pr.target !== repo.currentBranch) fail("PULL_REQUEST", "Switch to the target branch before merging")
        const incoming = repo.branches[pr.source], base = serverMergeBase(repo, head, incoming)
        if (command.expected !== undefined && command.expected !== head || command.sourceHead !== undefined && command.sourceHead !== incoming) fail("REMOTE_CHANGED", "Branches changed after review")
        if (!base) fail("HISTORY", "Branches have no common ancestor")
        const merged = mergeServerSnapshots(repo.commits[base].snapshot, current, repo.commits[incoming].snapshot, command.resolutions)
        snapshot = merged.snapshot; conflicts = merged.conflicts; target = incoming
      }
      if (!snapshot || !target) fail("HISTORY", "Target version not found")
      if (!head && Object.keys(observed.snapshot.files).length) fail("DIRTY", "Save the initial version first")
      for (const [id, item] of this.previews) if (item.expiresAt < Date.now()) this.previews.delete(id)
      if (this.previews.size > 20) this.previews.delete(this.previews.keys().next().value!)
      const previewId = randomUUID()
      this.previews.set(previewId, { id: previewId, actor: actor.id, expiresAt: Date.now() + 10 * 60000, repository: digest(stable(repo)), fingerprint: observed.fingerprint, snapshot, branch, target, pullRequest: command.pullRequest, conflicts })
      return { previewId, changes: serverHistoryDiff(observed.snapshot, snapshot), conflicts }
    }
    if (command.action === "apply") {
      const preview = this.previews.get(command.previewId)
      if (!preview || preview.actor !== actor.id || preview.expiresAt < Date.now() || preview.repository !== digest(stable(repo))) fail("PREVIEW", "Server version preview expired")
      if (preview.conflicts.length) fail("CONFLICT", "Merge conflicts require manual resolution")
      const observed = await this.scan()
      if (preview.fingerprint !== observed.fingerprint) fail("LOCAL_CHANGED", "Server changed after preview")
      const tree = new ShareWorktree(this.ports.root)
      const changes = serverHistoryDiff(observed.snapshot, preview.snapshot).filter(change => !change.path.startsWith("@"))
      const forward: Parameters<ShareWorktree['apply']>[0] = []
      const backward: typeof forward = []
      for (const change of changes) {
        forward.push({ path: change.path, expected: change.before?.sha256 ?? null, bytes: change.after ? await this.object(change.after.sha256) : null })
        backward.push({ path: change.path, expected: change.after?.sha256 ?? null, bytes: change.before ? await this.object(change.before.sha256) : null })
      }
      const beforeRepo = digest(stable(repo))
      if (preview.branch) repo.currentBranch = preview.branch
      else {
        const id = this.addCommit(repo, preview.snapshot, preview.pullRequest ? repo.pullRequests.find(pr => pr.id === preview.pullRequest)!.title : repo.commits[preview.target!].message, actor, preview.pullRequest ? [head, preview.target!] : [head])
        repo.branches[repo.currentBranch] = id
        if (preview.pullRequest) {
          const pr = repo.pullRequests.find(pr => pr.id === preview.pullRequest)!
          pr.state = "merged"
          pr.merge = { targetHead: head, sourceHead: preview.target!, commit: id, at: new Date().toISOString() }
        }
      }
      const journal = path.join(this.ports.store, "pending-apply.json")
      await fs.writeFile(journal, JSON.stringify({ before: observed.snapshot, after: preview.snapshot, beforeRepo, afterRepo: digest(stable(repo)) }), { flag: "wx" })
      let applied = false
      try {
        await tree.apply(forward); applied = true
        await this.ports.saveSettings(preview.snapshot.settings)
        await this.save(repo)
      } catch (error) {
        if (applied) { await tree.apply(backward); await this.ports.saveSettings(observed.snapshot.settings) }
        await fs.rm(journal)
        throw error
      }
      await fs.rm(journal)
      this.previews.delete(command.previewId)
      return { view: this.view(repo) }
    }
    return fail("COMMAND", "Unsupported server history action")
  }
}
