import type { Manifest, InstanceMetadata, ContentEntry, SharePorts, Repository, RepositoryCommand, SourceReference, Hashes, FileInfo, Commit, ResolvedFile } from "./types.js"
import { fail, excluded, validateManifest, validateExternal, manifestHash, stable, MAX_FILE_BYTES } from "./manifest.js"
import { createCommit, diff, merge, mergeBase, isAncestor, branchHistory } from "./versioning.js"
import { ShareError } from "./types.js"
import { resolvePullRequestMerge } from "./pull-request-history.js"

export interface ScanResult { manifest: Manifest; localOnly: string[]; blocked?: string[]; blockedDetails?: { path: string; size: number; reason: "size" | "format" }[]; statistics: { totalBytes: number; managedBytes: number; externalBytes: number }; root: string; changes?: ReturnType<typeof diff> }
export interface UpdatePreview { head: string; manifest: Manifest; diff: ReturnType<typeof diff>; conflicts: ReturnType<typeof merge>["conflicts"]; downloads: Record<string, number>; localBytes: number; expected: Record<string, string | null> }
export class ShareSystem {
  private cache = new Map<string, { fingerprint: string; hashes: Hashes }>()
  private externalValidationCache = new Map<string, { fingerprint: string; sha256: string }>()
  private scannedSources = new Map<string, { fingerprint: string; sha256: string; source: string }>()
  constructor(private ports: SharePorts) {}
  setProgress(progress: SharePorts["progress"]): void { this.ports.progress = progress }
  setAbortSignal(signal?: AbortSignal): void { this.ports.remote.setSignal?.(signal) }
  private async hashes(file: FileInfo, force: boolean): Promise<Hashes> {
    const cached = this.cache.get(file.path)
    if (!force && cached?.fingerprint === file.fingerprint) return cached.hashes
    const hashes = await this.ports.files.hash(file.path)
    if (this.cache.size >= 10000) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(file.path, { fingerprint: file.fingerprint, hashes }); return hashes
  }
  async scan(instance: InstanceMetadata, options: { exclusions?: string[]; selected?: string[]; hints?: Record<string, SourceReference>; force?: boolean } = {}): Promise<ScanResult> {
    const files = await this.ports.files.list(), entries: ContentEntry[] = [], localOnly: string[] = [], blocked: string[] = []
    const blockedDetails: NonNullable<ScanResult["blockedDetails"]> = []
    function block(file: FileInfo, reason: "size" | "format") {
      blocked.push(file.path); localOnly.push(file.path); blockedDetails.push({ path: file.path, size: file.size, reason })
    }
    const content = files.filter(file => /^(mods|resourcepacks|shaderpacks)\//.test(file.path)
      && !excluded(file.path, options.exclusions) && (!options.selected || options.selected.includes(file.path)))
    const contentHashes: Hashes[] = new Array(content.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(4, content.length) }, async () => {
      for (;;) {
        const index = cursor++
        if (index >= content.length) return
        contentHashes[index] = await this.hashes(content[index], options.force ?? false)
      }
    }))
    const prefetched = new Map<string, Map<string, ResolvedFile | null>>()
    const hashesByPath = new Map(content.map((file, index) => [file.path, contentHashes[index]]))
    for (const adapter of this.ports.sources) if (adapter.identifyMany && content.length) {
      const matches = await adapter.identifyMany(contentHashes, options.force)
      prefetched.set(adapter.id, new Map(content.map((file, index) => [file.path, matches[index] ?? null])))
    }
    let totalBytes = 0, managedBytes = 0, externalBytes = 0, done = 0
    for (const file of files) {
      totalBytes += file.size
      if (excluded(file.path, options.exclusions) || options.selected && !options.selected.includes(file.path)) { localOnly.push(file.path); continue }
      if (file.size > MAX_FILE_BYTES && !/^(mods|resourcepacks|shaderpacks)\//.test(file.path)) { block(file, "size"); continue }
      const hashes = hashesByPath.get(file.path) ?? await this.hashes(file, options.force ?? false)
      let source: SourceReference | undefined
      if (/^(mods|resourcepacks|shaderpacks)\//.test(file.path)) {
        for (const adapter of this.ports.sources) {
          const batch = prefetched.get(adapter.id)
          const resolved = batch ? batch.get(file.path) : await adapter.identify(hashes, options.hints?.[file.path] ?? await this.ports.localSource?.(file, hashes))
          if (resolved && resolved.size === file.size && (resolved.sha256 === hashes.sha256 || resolved.sha512 === hashes.sha512)) { source = resolved.source; break }
        }
      }
      if (!source) {
        if (file.size > MAX_FILE_BYTES) { block(file, "size"); continue }
        const validated = this.externalValidationCache.get(file.path)
        if (options.force || validated?.fingerprint !== file.fingerprint || validated.sha256 !== hashes.sha256) {
          try {
            const bytes = await this.ports.files.read(file.path)
            validateExternal(file.path, bytes)
            this.ports.inspectExternal?.(bytes)
          }
          catch (e) { if ((e as { code?: string }).code !== "FILE_POLICY") throw e; this.externalValidationCache.delete(file.path); block(file, "format"); continue }
          if (this.externalValidationCache.size >= 10000) this.externalValidationCache.delete(this.externalValidationCache.keys().next().value!)
          this.externalValidationCache.set(file.path, { fingerprint: file.fingerprint, sha256: hashes.sha256 })
        }
        externalBytes += file.size
      } else {
        managedBytes += file.size
        if (this.scannedSources.size >= 10000) this.scannedSources.delete(this.scannedSources.keys().next().value!)
        this.scannedSources.set(file.path, { fingerprint: file.fingerprint, sha256: hashes.sha256, source: stable(source) })
      }
      entries.push({ path: file.path, kind: file.path.startsWith("mods/") ? "mod" : file.path.startsWith("resourcepacks/") ? "resourcepack" : file.path.startsWith("shaderpacks/") ? "shader" : "config", sha256: hashes.sha256, size: file.size, enabled: !file.path.endsWith(".disabled"), ...(source ? { source } : { object: hashes.sha256 }) })
      this.ports.progress?.({ stage: "scan", done: ++done, total: files.length, bytes: externalBytes })
    }
    const manifest = validateManifest({ schemaVersion: 1, instance, entries, exclusions: options.exclusions ?? [] })
    return { manifest, root: await manifestHash(manifest, this.ports.hash), localOnly, blocked, blockedDetails, statistics: { totalBytes, managedBytes, externalBytes } }
  }
  private async prepare(id: string, manifest: Manifest, base?: Manifest): Promise<{ uploadedBytes: number; reusedBytes: number }> {
    let uploadedBytes = 0, reusedBytes = 0, done = 0
    const objects = new Set<string>()
    const previousByPath = new Map(base?.entries.map(entry => [entry.path, entry]) ?? [])
    const inheritedObjects = new Set(base?.entries.filter(entry => entry.object).map(entry => entry.sha256) ?? [])
    // Учитываем в прогрессе только локальные объекты: моды из каталога не загружаются.
    const total = manifest.entries.reduce((sum, entry) => {
      const previous = previousByPath.get(entry.path)
      return entry.object && (!previous || stable(previous) !== stable(entry)) ? sum + Math.max(1, entry.size) : sum
    }, 0)
    let currentSize = 0
    const reportUpload = (fraction = 0, bytes = uploadedBytes) => this.ports.progress?.({ stage: "upload", done: done + fraction * currentSize, total, bytes })
    const currentFiles = this.scannedSources.size ? new Map((await this.ports.files.list()).map(file => [file.path, file])) : new Map<string, FileInfo>()
    for (const e of manifest.entries) {
      currentSize = Math.max(1, e.size)
      const previous = previousByPath.get(e.path)
      if (previous && stable(previous) === stable(e)) {
        // Неизменённая запись уже проверена и закреплена предыдущим коммитом.
        // Для неё не нужны запрос в каталог, чтение файла или проверка объекта по сети.
        if (e.object && !objects.has(e.sha256)) {
          objects.add(e.sha256); reusedBytes += e.size
        }
        continue
      }
      if (e.source) {
        const scanned = this.scannedSources.get(e.path), current = currentFiles.get(e.path)
        const matchesScan = scanned && current && scanned.fingerprint === current.fingerprint && scanned.sha256 === e.sha256 && scanned.source === stable(e.source) && current.size === e.size
        if (!matchesScan) {
          const adapter = this.ports.sources.find(a => a.id === e.source!.provider)
          if (!adapter) fail("SOURCE", `Unsupported provider: ${e.source.provider}`)
          const resolved = await adapter.resolve(e.source)
          const local = await this.ports.files.hash(e.path)
          if (local.sha256 !== e.sha256 || resolved.size !== e.size) fail("INTEGRITY", `Managed content changed: ${e.path}`)
          if (resolved.sha512 ? resolved.sha512 !== local.sha512 : resolved.sha256 ? resolved.sha256 !== local.sha256 : await this.ports.hash.digest(await adapter.download(resolved)) !== e.sha256) fail("INTEGRITY", `Source content mismatch: ${e.path}`)
        }
        continue
      }
      const bytes = await this.ports.files.read(e.path)
      try {
        validateExternal(e.path, bytes)
        this.ports.inspectExternal?.(bytes)
      } catch (error) {
        if (error instanceof ShareError) throw new ShareError(error.code, error.message, e.path)
        throw error
      }
      if (bytes.length !== e.size || await this.ports.hash.digest(bytes) !== e.sha256) fail("INTEGRITY", `External file changed after preview: ${e.path}`)
      if (objects.has(e.sha256)) { done += currentSize; continue }
      objects.add(e.sha256)
      if (inheritedObjects.has(e.sha256) || await this.ports.remote.hasObject(id, e.sha256)) reusedBytes += bytes.length
      else {
        try { await this.ports.remote.upload(id, e.sha256, bytes, this.ports.progress ? transferred => reportUpload(e.size ? Math.min(1, transferred / e.size) : 0, uploadedBytes + transferred) : undefined) }
        catch (error) {
          if (error instanceof ShareError) throw new ShareError(error.code, error.message, e.path)
          throw error
        }
        uploadedBytes += bytes.length
      }
      done += currentSize
    }
    return { uploadedBytes, reusedBytes }
  }
  async publish(manifest: Manifest, author: string, message = "Initial commit", repositoryId?: string) {
    manifest = validateManifest(manifest)
    const id = repositoryId ?? await this.ports.remote.create()
    const transfer = await this.prepare(id, manifest)
    const commit = await createCommit({ repositoryId: id, author, manifest, message, parents: [], now: this.ports.now() }, this.ports.hash)
    this.ports.progress?.({ stage: "commit", done: 0, total: 1, bytes: transfer.uploadedBytes })
    const repository = await this.ports.remote.mutate(id, { action: "push", branch: "main", expected: null, commit })
    return { repository, commit, ...transfer, metadataBytes: new TextEncoder().encode(stable(commit)).length }
  }
  async push(id: string, branch: string, expected: string, manifest: Manifest, author: string, message: string, options: { selected?: string[]; type?: Commit["type"]; mergeParent?: string } = {}) {
    const repository = await this.ports.remote.get(id), parent = repository.commits[expected]
    if (!parent || repository.branches[branch]?.head !== expected) fail("NON_FAST_FORWARD", "Branch changed; pull before pushing")
    if (options.selected) {
      const selected = new Set(options.selected)
      const old = parent.snapshot.manifest
      manifest = { ...manifest, instance: selected.has("@instance") ? manifest.instance : old.instance, exclusions: selected.has("@exclusions") ? manifest.exclusions : old.exclusions, entries: [...old.entries.filter(e => !selected.has(e.path)), ...manifest.entries.filter(e => selected.has(e.path))] }
    }
    manifest = validateManifest(manifest)
    const transfer = await this.prepare(id, manifest, parent.snapshot.manifest)
    const second = options.mergeParent ? repository.commits[options.mergeParent] : undefined
    if (options.mergeParent && !second) fail("PARENTS", "Merge parent missing")
    const commit = await createCommit({ repositoryId: id, author, manifest, message, parents: second ? [parent, second] : [parent], now: this.ports.now(), type: options.type }, this.ports.hash)
    this.ports.progress?.({ stage: "commit", done: 0, total: 1, bytes: transfer.uploadedBytes })
    const updated = await this.ports.remote.mutate(id, { action: "push", branch, expected, commit })
    return { repository: updated, commit, ...transfer, metadataBytes: new TextEncoder().encode(stable(commit)).length }
  }
  get(id: string): Promise<Repository> { return this.ports.remote.get(id) }
  async observe(instance: InstanceMetadata, base?: Manifest): Promise<Manifest> {
    const entries: ContentEntry[] = []
    for (const file of await this.ports.files.list()) {
      if (excluded(file.path, base?.exclusions)) continue
      const hashes = await this.ports.files.hash(file.path), old = base?.entries.find(e => e.path === file.path)
      if (!old && !/^(mods|resourcepacks|shaderpacks)\//.test(file.path)) {
        if (file.size > MAX_FILE_BYTES) continue
        try { validateExternal(file.path, await this.ports.files.read(file.path)) } catch { continue }
      }
      entries.push(old && old.sha256 === hashes.sha256 ? old : { path: file.path, kind: "external", sha256: hashes.sha256, size: file.size, enabled: !file.path.endsWith(".disabled"), object: hashes.sha256 })
    }
    return { schemaVersion: 1, instance, entries, exclusions: base?.exclusions ?? [] }
  }
  command(id: string, command: RepositoryCommand): Promise<Repository> { return this.ports.remote.mutate(id, command) }
  async createBranch(id: string, name: string, source: string, author: string, independent = false): Promise<Repository> {
    const repo = await this.get(id), from = repo.branches[source]?.head
    if (!from || !repo.commits[from]) fail("BRANCH", "Source branch does not exist")
    const initial = independent ? await createCommit({ repositoryId: id, author, message: `Initial state: ${name}`, manifest: repo.commits[from].snapshot.manifest, parents: [], now: this.ports.now() }, this.ports.hash) : undefined
    return this.command(id, { action: "branch", name, from, ...(initial ? { initial } : {}) })
  }
  async preview(id: string, branch: string, applied: string | null, local: Manifest, resolutions: Record<string, "current" | "incoming"> = {}, targetCommit?: string): Promise<UpdatePreview> {
    const repo = await this.ports.remote.get(id), head = targetCommit ?? repo.branches[branch]?.head
    if (!head) fail("BRANCH", "Branch does not exist")
    const incoming = validateManifest(repo.commits[head].snapshot.manifest)
    if (applied && !repo.commits[applied]) fail("HISTORY", "Applied commit missing")
    const base = applied ? repo.commits[applied].snapshot.manifest : { ...incoming, entries: [], instance: local.instance }
    return this.plan(head, base, local, incoming, resolutions)
  }
  private async plan(head: string, base: Manifest, local: Manifest, incoming: Manifest, resolutions: Record<string, "current" | "incoming">): Promise<UpdatePreview> {
    const merged = merge(base, local, incoming, resolutions)
    const downloads: Record<string, number> = {}, expected: Record<string, string | null> = {}; let localBytes = 0
    const current = new Map((await this.ports.files.list()).map(f => [f.path, f]))
    for (const entry of [...local.entries, ...merged.manifest.entries]) {
      if (!Object.hasOwn(expected, entry.path)) expected[entry.path] = current.has(entry.path) ? (await this.ports.files.hash(entry.path)).sha256 : null
    }
    for (const entry of merged.manifest.entries) {
      const existing = current.get(entry.path)
      if (existing && (await this.ports.files.hash(entry.path)).sha256 === entry.sha256) localBytes += entry.size
      else { const provider = entry.source?.provider ?? "objects"; downloads[provider] = (downloads[provider] ?? 0) + entry.size }
    }
    return { head, manifest: merged.manifest, conflicts: merged.conflicts, diff: diff(local, merged.manifest), downloads, localBytes, expected }
  }
  async apply(id: string, preview: UpdatePreview): Promise<void> {
    if (preview.conflicts.length) fail("CONFLICT", "Resolve conflicts before applying update")
    const manifest = preview.manifest
    // Неизменённые локальные дополнения не становятся публикуемыми external objects.
    validateManifest({ ...manifest, entries: manifest.entries.filter(e => preview.expected[e.path] !== e.sha256) })
    const files = new Map((await this.ports.files.list()).map(f => [f.path, f]))
    for (const [path, expected] of Object.entries(preview.expected)) {
      const current = files.has(path) ? (await this.ports.files.hash(path)).sha256 : null
      if (current !== expected) fail("LOCAL_CHANGED", `Local file changed after preview: ${path}`)
    }
    const changes: { path: string; bytes: Uint8Array | null; expected: string | null }[] = []
    let downloadedBytes = 0, processed = 0
    const transferFiles = manifest.entries.filter(entry => preview.expected[entry.path] !== entry.sha256).map(entry => ({ path: entry.path, size: entry.size, status: "queued" as "queued" | "downloading" | "complete" | "error" }))
    const reportDownload = () => this.ports.progress?.({ stage: "download", done: processed, total: transferFiles.length, bytes: downloadedBytes, files: transferFiles.map(file => ({ ...file })) })
    reportDownload()

    for (const change of preview.diff) if (change.before && !manifest.entries.some(e => e.path === change.before!.path)) {
      changes.push({ path: change.before.path, bytes: null, expected: change.before.sha256 })
    }
    for (const entry of manifest.entries) {
      const current = files.get(entry.path), existing = current ? (await this.ports.files.hash(entry.path)).sha256 : null
      if (existing === entry.sha256) continue
      const transferFile = transferFiles.find(file => file.path === entry.path)
      if (transferFile) transferFile.status = "downloading"
      reportDownload()
      let bytes: Uint8Array
      try {
      if (entry.source) {
        const adapter = this.ports.sources.find(s => s.id === entry.source!.provider)
        if (!adapter) fail("SOURCE", `Provider unavailable: ${entry.source.provider}`)
        const resolved = await adapter.resolve(entry.source)
        if (resolved.size !== entry.size) fail("INTEGRITY", "Source size changed")
        bytes = await adapter.download(resolved)
      } else { bytes = await this.ports.remote.download(id, entry.sha256); validateExternal(entry.path, bytes) }
      if (bytes.length !== entry.size || await this.ports.hash.digest(bytes) !== entry.sha256) fail("INTEGRITY", `Downloaded content is corrupt: ${entry.path}`)
      changes.push({ path: entry.path, bytes, expected: preview.expected[entry.path] ?? null })
      downloadedBytes += bytes.length
      if (transferFile) transferFile.status = "complete"
      processed++
      reportDownload()
      } catch (error) {
        if (transferFile) transferFile.status = "error"
        reportDownload()
        throw error
      }
    }
    await this.ports.files.apply(changes)
  }
  async mergePreview(id: string, current: string, incoming: string, resolutions: Record<string, "current" | "incoming"> = {}, pullRequest?: string) {
    const repo = await this.get(id), a = repo.branches[current]?.head, b = repo.branches[incoming]?.head
    if (pullRequest) {
      const pr = repo.pullRequests[pullRequest]
      if (!pr || pr.source !== incoming || pr.target !== current) fail("PR", "Pull request not found")
      if (pr.state === "merged") {
        const saved = resolvePullRequestMerge(repo.commits, pr, a)
        if (!saved) fail("PR_HISTORY", "Merged pull request history is unavailable")
        const manifest = repo.commits[saved.commit].snapshot.manifest
        return { current: saved.targetHead, incoming: saved.sourceHead, base: saved.targetHead, manifest, conflicts: [], diff: diff(repo.commits[saved.targetHead].snapshot.manifest, manifest) }
      }
    }
    if (!a || !b) fail("BRANCH", "Branch missing")
    const base = mergeBase(repo, a, b)
    const result = merge(repo.commits[base].snapshot.manifest, repo.commits[a].snapshot.manifest, repo.commits[b].snapshot.manifest, resolutions)
    return { current: a, incoming: b, base, ...result, diff: diff(repo.commits[a].snapshot.manifest, result.manifest) }
  }
  async mergeBranches(id: string, target: string, source: string, expected: string, author: string, message: string, resolutions: Record<string, "current" | "incoming"> = {}, pullRequest?: string, sourceHead?: string) {
    const repo = await this.get(id), a = repo.branches[target]?.head, b = repo.branches[source]?.head
    if (!a || !b || a !== expected) fail("NON_FAST_FORWARD", "Target branch changed")
    if (sourceHead && b !== sourceHead) fail("NON_FAST_FORWARD", "Source branch changed; review changes again")
    if (isAncestor(repo, a, b)) return this.command(id, { action: "fastForward", branch: target, expected: a, head: b, pullRequest })
    if (isAncestor(repo, b, a)) return pullRequest ? this.command(id, { action: "fastForward", branch: target, expected: a, head: a, pullRequest }) : repo
    const base = mergeBase(repo, a, b)
    const result = merge(repo.commits[base].snapshot.manifest, repo.commits[a].snapshot.manifest, repo.commits[b].snapshot.manifest, resolutions)
    if (result.conflicts.length) fail("CONFLICT", "Resolve merge conflicts before committing")
    const commit = await createCommit({ repositoryId: id, author, message, manifest: validateManifest(result.manifest), parents: [repo.commits[a], repo.commits[b]], now: this.ports.now() }, this.ports.hash)
    return this.command(id, { action: "push", branch: target, expected, commit, pullRequest })
  }
  async restore(id: string, branch: string, expected: string, target: string, author: string, message: string) {
    const repo = await this.get(id)
    if (repo.branches[branch]?.head !== expected || !repo.commits[target]) fail("NON_FAST_FORWARD", "Branch changed or target commit is missing")
    if (!branchHistory(repo, branch).some(commit => commit.id === target)) fail("HISTORY", "Target version is not in this branch")
    const commit = await createCommit({ repositoryId: id, author, message, manifest: repo.commits[target].snapshot.manifest, parents: [repo.commits[expected]], now: this.ports.now(), type: "REVERT" }, this.ports.hash)
    return this.command(id, { action: "push", branch, expected, commit })
  }
  async stash(id: string, name: string, base: string, manifest: Manifest) {
    await this.prepare(id, validateManifest(manifest))
    return this.command(id, { action: "stash", id: name, base, manifest })
  }
  async previewStash(id: string, branch: string, applied: string, stashId: string, local: Manifest, resolutions: Record<string, "current" | "incoming"> = {}) {
    const repo = await this.get(id), stash = repo.stashes[stashId]
    if (!stash || !repo.commits[applied] || repo.branches[branch]?.head !== applied) fail("STASH", "Stash missing or pull required")
    return this.plan(applied, repo.commits[stash.base].snapshot.manifest, local, stash.manifest, resolutions)
  }
  async branchFromStash(id: string, name: string, stashId: string, author: string) {
    const repo = await this.get(id), stash = repo.stashes[stashId]
    if (!stash) fail("STASH", "Stash missing")
    await this.command(id, { action: "branch", name, from: stash.base })
    const commit = await createCommit({ repositoryId: id, author, manifest: stash.manifest, message: `Apply stash ${stashId}`, parents: [repo.commits[stash.base]], now: this.ports.now() }, this.ports.hash)
    return this.command(id, { action: "push", branch: name, expected: stash.base, commit })
  }
}
