import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import AdmZip from "adm-zip"
import { inspectExternalObject } from "@xnlc/share"
import { branchHistory, parseInvitation } from "@xnlc/share"
import { ShareSystem, ShareApiClient, ModrinthSource, CurseForgeSource, ShareError, diff, validateManifest, type Manifest, type UpdatePreview, type ScanResult } from "@xnlc/share"
import type { ShareRequest, ShareResponse, ShareLink, ShareContentPresentation } from "@xnlc/types"
import { dbHelpers } from "../../db"
import { getBuildIntentPath } from "../builds/helpers"
import { isGameDirActive } from "../minecraft-core"
import { ShareWorktree } from "./worktree"
import { shareConfiguration as config, shareRequest as request, shareSession } from "./auth"
import { getShareBinding, saveShareBinding, finishShareInstall, removeSharePublicationBindings } from "../../db/share"
import { ensureBuildIntentDir, getBuildIntentDirName } from "../builds/helpers"
import { scanIntentDir } from "../builds/scanner"
import { sendToRenderer } from "../runtime"
import { takeShareInvitation } from "./links"
import { describeIncomingShareContent, describeShareContent, describeShareHistory } from "./content-presentation"
import { serializeLaunchSettings, resolveLaunchSettings } from "./launch-settings"
import { detectJavaInstallations } from "../system"
import { prepareSharedRename } from "./instance-name"

type PreviewState = { scan?: ScanResult; update?: UpdatePreview; observed?: Manifest; branch?: string; origin?: { branch: string; applied: string }; restore?: { expected: string; target: string } }
const previews = new Map<string, PreviewState & { buildId: string; at: number }>()
const systems = new Map<string, { directory: string; system: ShareSystem }>()
const busy = new Set<string>()
const hash = { digest: async (bytes: Uint8Array, algorithm: "SHA-256" | "SHA-512" = "SHA-256") => createHash(algorithm.replace("-", "").toLowerCase()).update(bytes).digest("hex") }
async function linkFor(buildId: string): Promise<ShareLink | null> { return getShareBinding(buildId) }
async function setLink(buildId: string, link: ShareLink) { saveShareBinding(buildId, link) }
function forgetPublication(repositoryId: string): void {
  const builds = new Set(removeSharePublicationBindings(repositoryId))
  for (const buildId of builds) systems.delete(buildId)
  for (const [id, preview] of previews) if (builds.has(preview.buildId)) previews.delete(id)
}
const invitations = new Map<string, { token: string; user: string; at: number; data: NonNullable<ShareResponse["invitationPreview"]>; accepted?: boolean; buildId?: string; installing?: boolean }>()
function remember(buildId: string, data: PreviewState) {
  for (const [id, item] of previews) if (Date.now() - item.at > 30 * 60000) previews.delete(id)
  if (previews.size > 30) previews.delete(previews.keys().next().value!)
  const id = randomUUID(); previews.set(id, { buildId, at: Date.now(), ...data }); return id
}
export async function executeShare(input: ShareRequest, progress: (event: { stage: string; done: number; total: number; bytes: number; files?: { path: string; size: number; name?: string; iconUrl?: string; status: "queued" | "downloading" | "complete" | "error" }[] }) => void): Promise<ShareResponse> {
  if (input.action === "session") return shareSession()
  if (input.action === "pendingInvitation") return { pendingInvitation: takeShareInvitation() }
  if (input.action === "invitationPreview") {
    const token = parseInvitation(input.invitation)
    const me = await request("/auth/me") as { id: string }
    const data = await request(`/invites/${encodeURIComponent(token)}`) as NonNullable<ShareResponse["invitationPreview"]>
    data.manifest = validateManifest(data.manifest)
    for (const [key, value] of invitations) if (Date.now() - value.at > 30 * 60000) invitations.delete(key)
    const previewId = randomUUID(); invitations.set(previewId, { token, user: me.id, at: Date.now(), data })
    return { invitationPreview: data, previewId }
  }
  if (input.action === "installInvite") {
    const invite = invitations.get(input.previewId), me = await request("/auth/me") as { id: string }
    if (!invite || invite.user !== me.id || Date.now() - invite.at > 30 * 60000) throw new ShareError("PREVIEW", "Invitation preview expired")
    if (invite.installing) throw new ShareError("BUSY", "Invitation installation already running")
    invite.installing = true
    try {
    const existing = await dbHelpers.loadBuilds()
    const baseName = input.name.trim() || invite.data.manifest.instance.name
    if (baseName.length > 100) throw new ShareError("NAME", "Instance name is too long")
    let name = baseName, number = 2
    while (existing.some(b => getBuildIntentDirName(b.name).toLowerCase() === getBuildIntentDirName(name).toLowerCase()) || await fs.lstat(getBuildIntentPath(name)).then(() => true).catch(e => { if (e.code === "ENOENT") return false; throw e })) name = `${baseName} (${number++})`
    if (!invite.accepted) {
      await request(`/invites/${encodeURIComponent(invite.token)}/accept`, "POST", {})
      invite.accepted = true
    }
    const repo = await request(`/repositories/${encodeURIComponent(invite.data.repositoryId)}`)
    if (!repo.branches[invite.data.branch]) throw new ShareError("BRANCH", "Branch does not exist")
    if (!invite.buildId) {
    const buildId = randomUUID(), directory = await ensureBuildIntentDir(name), m = invite.data.manifest.instance
    const launch = m.launchSettings ? resolveLaunchSettings(m.launchSettings, await dbHelpers.loadAccounts(), m.launchSettings.java ? await detectJavaInstallations() : []) : {}
    await dbHelpers.insertBuild({ id: buildId, name, description: m.description, version: m.gameVersion, modLoader: m.loader, loaderVersion: m.loaderVersion, icon: m.icon ?? m.coverImage ?? "", coverImage: m.coverImage, createdAt: new Date().toISOString(), source: "local", playtime: 0, mods: [], resourcepacks: [], shaders: [], intentPath: directory, ...launch })
    invite.buildId = buildId
    }
    const buildId = invite.buildId
    if (!await linkFor(buildId)) {
    await setLink(buildId, { repositoryId: repo.id, branch: invite.data.branch, applied: "", latest: repo.branches[invite.data.branch].head, userId: me.id, role: repo.members[me.id], status: "not_ready" })
    }
    // Первая установка — обычное получение ветки, а не откат её истории.
    const preview = await executeShare({ action: "preview", buildId }, progress)
    await executeShare({ action: "apply", buildId, previewId: preview.previewId! }, progress)
    invitations.delete(input.previewId)
    return { buildId, link: (await linkFor(buildId))! }
    } finally { invite.installing = false }
  }
  if (input.action === "acceptInvite") return request(`/invites/${encodeURIComponent(input.token)}/accept`, "POST", {})
  if (busy.has(input.buildId)) throw new ShareError("BUSY", "Share operation already running")
  busy.add(input.buildId)
  try {
    const build = await dbHelpers.findBuildById(input.buildId)
    if (!build) throw new ShareError("BUILD", "Instance not found")
    let link = await linkFor(build.id)
    if (input.action === "checkLaunch" && !link) return {}
    const session = await shareSession()
    link = await linkFor(build.id)
    const configured = session.configured
    if (!session.signedIn) {
      if (input.action === "status") return { ...session, link: link ?? undefined }
      throw new ShareError(session.eligible ? "SERVICE_UNAVAILABLE" : "ACCOUNT_REQUIRED", "Share requires a non-offline launcher account and an available service")
    }
    const c = await config(), me = await request("/auth/me") as { id: string }
    if (input.action === "deletePublication") {
      if (!link || link.repositoryId !== input.repositoryId) throw new ShareError("LINK", "Publication binding changed")
      if (link.userId !== me.id) throw new ShareError("WRONG_ACCOUNT", "Use the linked Share account")
      try { await request(`/repositories/${encodeURIComponent(link.repositoryId)}`, "DELETE") }
      catch (error) { if (!(error instanceof ShareError) || error.code !== "PUBLICATION_DELETED") throw error }
      forgetPublication(link.repositoryId)
      return { ...session, detached: true }
    }
    const directory = build.intentPath || getBuildIntentPath(build.name)
    if (input.action !== "status" && isGameDirActive(directory)) throw new ShareError("RUNNING", "Stop Minecraft before modifying shared content")
    const files = new ShareWorktree(directory)
    if (link && link.userId !== me.id) {
      if (input.action === "status" || input.action === "checkLaunch") return { ...session, link, wrongAccount: true }
      throw new ShareError("WRONG_ACCOUNT", "Sign in using the linked Share account")
    }
    if (!isGameDirActive(directory)) await files.recover()
    let system = systems.get(build.id)?.directory === directory ? systems.get(build.id)!.system : undefined
    if (!system) {
      system = new ShareSystem({ files, hash, remote: new ShareApiClient(c.url, async () => (await config()).token, fetch), sources: [new ModrinthSource(fetch), new CurseForgeSource(fetch, process.env.CURSEFORGE_API_KEY || "", hash)], now: () => new Date().toISOString(), progress,
        inspectExternal: bytes => inspectExternalObject(bytes, data => new AdmZip(Buffer.from(data)).getEntries().map((entry: { entryName: string; header: { size: number }; isDirectory: boolean; getData(): Buffer }) => ({ name: entry.entryName, size: entry.header.size, directory: entry.isDirectory, read: () => entry.getData() }))),
        localSource: async (_file, hashes) => {
          const row = hashes.sha1 ? (await dbHelpers.getResources([hashes.sha1]))[0] : undefined
          if (row?.modId && row.fileId) return { provider: "curseforge", projectId: String(row.modId), versionId: String(row.fileId), fileId: String(row.fileId) }
          if (row?.projectId && row.versionId) return { provider: "modrinth", projectId: row.projectId, versionId: row.versionId, fileId: hashes.sha512 }
          return undefined
        },
      })
      if (systems.size > 16) systems.delete(systems.keys().next().value!)
      systems.set(build.id, { directory, system })
    }
    system.setProgress(progress)
    const instance: Manifest["instance"] = { name: build.name, description: build.description || "", gameVersion: build.version, loader: build.modLoader, loaderVersion: build.loaderVersion || "", icon: build.icon || "", coverImage: build.coverImage || "" }
    if (input.action === "status" || input.action === "checkLaunch") {
      let repository: Awaited<ReturnType<typeof system.get>> | undefined
      try { repository = link ? await system.get(link.repositoryId) : undefined }
      catch (error) {
        if (!(error instanceof ShareError) || error.code !== "PUBLICATION_DELETED" || !link) throw error
        forgetPublication(link.repositoryId)
        return { ...session, detached: true }
      }
      const latest = repository && link ? repository.branches[link.branch]?.head : undefined
      const next = link && latest ? { ...link, role: repository!.members[me.id], latest, status: link.applied === latest ? "up_to_date" as const : "update_available" as const } : link
      if (next) await setLink(build.id, next)
      const memberNames = repository ? await request(`/repositories/${encodeURIComponent(repository.id)}/members`) : undefined
      return { ...session, link: next ?? undefined, repository, memberNames }
    }
    if (input.action === "connect") {
      const repo = await system.get(input.repositoryId)
      if (!repo.branches[input.branch]) throw new ShareError("BRANCH", "Branch not found")
      if (link) throw new ShareError("LINK", "Instance is already linked")
      const next: ShareLink = { repositoryId: repo.id, branch: input.branch, applied: "", latest: repo.branches[input.branch].head, userId: me.id, role: repo.members[me.id], status: "not_ready" }
      await setLink(build.id, next)
      return { repository: repo, link: next }
    }
    if (input.action === "history") {
      if (!link) throw new ShareError("LINK", "Instance is not linked")
      const repo = await system.get(link.repositoryId)
      const commit = repo.commits[input.commit]
      if (!commit || !link || !branchHistory(repo, link.branch).some(entry => entry.id === commit.id)) throw new ShareError("HISTORY", "Commit is not in the selected branch")
      const current = commit.snapshot.manifest
      const parent = commit.parents[0] ? repo.commits[commit.parents[0]] : undefined
      if (commit.parents[0] && !parent) throw new ShareError("HISTORY", "Parent commit not found")
      const changes = diff(parent?.snapshot.manifest ?? { ...current, entries: [] }, current)
      const entries = changes.flatMap(change => [change.before, change.after].filter((entry): entry is NonNullable<typeof entry> => !!entry))
      return { history: { commitId: commit.id, changes, presentation: await describeShareHistory(directory, entries) } }
    }
    if (input.action === "scan") {
      const repository = link ? await system.get(link.repositoryId) : undefined
      const baseline = link ? repository?.commits[link.applied]?.snapshot.manifest.instance.launchSettings : undefined
      instance.launchSettings = serializeLaunchSettings(build, await dbHelpers.loadAccounts(), build.javaPath || baseline?.java ? await detectJavaInstallations() : [], baseline)
      const scan = await system.scan(instance, { selected: input.selected, exclusions: input.exclusions })
      if (link?.applied) {
        const parent = repository!.commits[link.applied]
        if (parent) scan.changes = diff(parent.snapshot.manifest, scan.manifest)
      }
      const paths = [...scan.manifest.entries.map(entry => entry.path), ...(scan.changes?.flatMap(change => [change.path, ...(change.before ? [change.before.path] : [])]) ?? [])].filter(relative => !relative.startsWith("@"))
      const contentPresentation = await describeShareContent(directory, paths)
      return { scan, contentPresentation, previewId: remember(build.id, { scan, origin: link ? { branch: link.branch, applied: link.applied } : undefined }) }
    }
    if (input.action === "publish" || input.action === "push") {
      const preview = previews.get(input.previewId)
      if (!preview?.scan || preview.buildId !== build.id || Date.now() - preview.at > 30 * 60000) throw new ShareError("PREVIEW", "Scan preview expired")
      if (input.action === "publish" && link) throw new ShareError("LINK", "Instance is already linked")
      if (input.action === "push" && (!link || !link.applied)) throw new ShareError("LINK", "Install shared base before pushing")
      if (input.action === "push" && (preview.origin?.branch !== link!.branch || preview.origin?.applied !== link!.applied)) throw new ShareError("PREVIEW", "Branch changed; prepare publication again")
      const manifest = input.action === "publish" && input.selected ? { ...preview.scan.manifest, entries: preview.scan.manifest.entries.filter(e => input.selected!.includes(e.path)) } : preview.scan.manifest
      const result = input.action === "publish" ? await system.publish(manifest, me.id, input.message) : await system.push(link!.repositoryId, link!.branch, link!.applied, manifest, me.id, input.message, { selected: input.selected })
      const next: ShareLink = { repositoryId: result.repository.id, branch: link?.branch ?? "main", applied: result.commit.id, latest: result.commit.id, userId: me.id, role: result.repository.members[me.id], status: "up_to_date" }
      await setLink(build.id, next); previews.delete(input.previewId)
      return { repository: result.repository, link: next, uploadedBytes: result.uploadedBytes, reusedBytes: result.reusedBytes, metadataBytes: result.metadataBytes }
    }
    if (!link) throw new ShareError("LINK", "Instance is not linked")
    if (input.action === "preview") {
      // Локальный скан не зависит от доступности каталога: для overlay достаточно SHA-256.
      const repo = await system.get(link.repositoryId)
      if (input.commit) {
        if (repo.members[me.id] === "viewer") throw new ShareError("FORBIDDEN", "Read-only membership")
        if (!branchHistory(repo, link.branch).some(commit => commit.id === input.commit)) throw new ShareError("HISTORY", "Target version is not in this branch")
        if (input.branch && input.branch !== link.branch || repo.branches[link.branch]?.head !== link.applied) throw new ShareError("NON_FAST_FORWARD", "Update the current branch before restoring a version")
      }
      const base = link.applied ? repo.commits[link.applied]?.snapshot.manifest : undefined
      instance.launchSettings = serializeLaunchSettings(build, await dbHelpers.loadAccounts(), build.javaPath || base?.instance.launchSettings?.java ? await detectJavaInstallations() : [], base?.instance.launchSettings)
      const observed = await system.observe(instance, base)
      const targetBranch = input.branch ?? link.branch
      const preview = input.stash ? await system.previewStash(link.repositoryId, targetBranch, link.applied, input.stash, observed, input.resolutions) : await system.preview(link.repositoryId, targetBranch, link.applied || null, observed, input.resolutions, input.commit)
      const paths = [...preview.manifest.entries.map(entry => entry.path), ...observed.entries.map(entry => entry.path)]
      const contentPresentation = await describeShareContent(directory, paths)
      return { preview, contentPresentation, previewId: remember(build.id, { update: preview, observed, branch: targetBranch, origin: { branch: link.branch, applied: link.applied }, restore: input.commit ? { expected: link.applied, target: input.commit } : undefined }) }
    }
    if (input.action === "apply" || input.action === "restoreApply") {
      const saved = previews.get(input.previewId)
      if (!saved?.update || saved.buildId !== build.id || Date.now() - saved.at > 30 * 60000) throw new ShareError("PREVIEW", "Update preview expired")
      if (saved.origin?.branch !== link.branch || saved.origin?.applied !== link.applied) throw new ShareError("PREVIEW", "Branch changed; prepare preview again")
      if ((input.action === "restoreApply") !== !!saved.restore) throw new ShareError("PREVIEW", "Preview action does not match")
      if (saved.restore && input.action === "restoreApply") {
        if (saved.update.conflicts.length) throw new ShareError("CONFLICT", "Resolve conflicts before restoring")
        // Не публикуем откат, если файлы изменились после предпросмотра.
        for (const [relative, expected] of Object.entries(saved.update.expected)) {
          const current = await files.hash(relative).then(hashes => hashes.sha256).catch(error => { if (error.code === "ENOENT") return null; throw error })
          if (current !== expected) throw new ShareError("LOCAL_CHANGED", "Local file changed after preview")
        }
        const restored = await system.restore(link.repositoryId, link.branch, saved.restore.expected, saved.restore.target, me.id, input.message)
        const head = restored.branches[link.branch].head
        saved.update = { ...saved.update, head }
        link = { ...link, latest: head }
      }
      await setLink(build.id, { ...link, status: "applying" })
      try {
      const incomingPresentation = await describeIncomingShareContent(saved.update.manifest.entries).catch(() => ({} as Record<string, ShareContentPresentation>))
      system.setProgress(event => progress({ ...event, files: event.files?.map(file => ({ ...file, name: incomingPresentation[file.path]?.name, iconUrl: incomingPresentation[file.path]?.iconUrl })) }))
      await system.apply(link.repositoryId, saved.update)
      const metadata = saved.update.manifest.instance
      const launch = metadata.launchSettings ? resolveLaunchSettings(metadata.launchSettings, await dbHelpers.loadAccounts(), metadata.launchSettings.java ? await detectJavaInstallations() : []) : undefined
      progress({ stage: "index", done: 0, total: 1, bytes: 0 })
      const scanned = await scanIntentDir(directory)
      const next: ShareLink = { ...link, branch: saved.branch ?? link.branch, applied: saved.update.head, latest: saved.update.head, status: "up_to_date" }
      // При первой установке сохраняем имя, выбранное в диалоге импорта.
      const rename = link.applied && metadata.name !== build.name
        ? await prepareSharedRename(directory, build.name, metadata.name, (await dbHelpers.loadBuilds()).filter(item => item.id !== build.id).map(item => item.name), getBuildIntentDirName) : undefined
      try {
        await rename?.move()
        finishShareInstall(build.id, next, { ...(rename ? { name: rename.name, intentPath: rename.directory } : {}), description: metadata.description, version: metadata.gameVersion, modLoader: metadata.loader, loaderVersion: metadata.loaderVersion, icon: metadata.icon, coverImage: metadata.coverImage, launch, ...scanned })
      } catch (error) { await rename?.rollback(); throw error }
      if (rename) systems.delete(build.id)
      sendToRenderer("share:installed", { buildId: build.id }); previews.delete(input.previewId)
      return { link: next }
      } catch (error) { await setLink(build.id, { ...link, status: "error" }); throw error }
    }
    if (input.action === "command") return { repository: await system.command(link.repositoryId, input.command) }
    if (input.action === "createBranch") return { repository: await system.createBranch(link.repositoryId, input.name, input.source, me.id, input.independent) }
    if (input.action === "stash") {
      const scan = previews.get(input.previewId)
      if (!scan?.scan || scan.buildId !== build.id) throw new ShareError("PREVIEW", "Scan preview expired")
      return { repository: await system.stash(link.repositoryId, input.name, link.applied, scan.scan.manifest) }
    }
    if (input.action === "restore") return { repository: await system.restore(link.repositoryId, link.branch, link.applied, input.commit, me.id, input.message) }
    if (input.action === "mergePreview") {
      const merge = await system.mergePreview(link.repositoryId, input.target ?? link.branch, input.source, input.resolutions, input.pullRequest)
      const entries = merge.diff.flatMap(change => [change.before, change.after].filter((entry): entry is NonNullable<typeof entry> => !!entry))
      const byHash = await describeShareHistory(directory, entries)
      const contentPresentation: Record<string, ShareContentPresentation> = {}
      for (const entry of entries) if (byHash[entry.sha256]) contentPresentation[entry.path] = byHash[entry.sha256]
      return { merge, contentPresentation }
    }
    if (input.action === "merge") return { repository: await system.mergeBranches(link.repositoryId, input.target ?? link.branch, input.source, input.expected, me.id, input.message, input.resolutions, input.pullRequest, input.sourceHead) }
    if (input.action === "invite") return { invitation: await request(`/repositories/${encodeURIComponent(link.repositoryId)}/invites`, "POST", { role: input.role, maxUses: input.maxUses }) }
    throw new ShareError("COMMAND", "Unsupported Share command")
  } finally { busy.delete(input.buildId) }
}
