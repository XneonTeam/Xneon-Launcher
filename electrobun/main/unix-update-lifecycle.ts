import assert from "node:assert/strict"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { acquireUnixFileLock } from "../platform/unix-file-lock"
import { unixUpdateStartupBarrier } from "../platform/unix-update-startup-barrier"
import { readActiveUnixUpdate, readUnixHelperJson, clearActiveUnixUpdate, writeUnixHelperJson, prepareUnixUpdateHandoff } from "./unix-update-handoff"
import { authenticateUnixHelperJob } from "./unix-update-job"
import { readUnixLocalIdentity, readUnixUpdateContext, unixNativeTarget, unixUpdateJob, unixUpdateProfile, unixUpdateStore } from "./unix-update-context"
import { acknowledgeUnixUpdateStartup, type UnixHealthIdentity } from "./unix-update-health"
import { verifyUnixUpdatePayload } from "./unix-update-payload"
import { verifyUnixUpdateFile } from "./unix-update-state"
import { selectUnixUpdateArtifact } from "./unix-update-installation"

type Startup = { nonce: string; inheritedNonce?: string; current: "old" | "next" | "unknown"; live: boolean; ready: boolean; journal: boolean; result?: string }
type StartupAction = "trial" | "busy" | "finish" | "abandon" | "blocked"
const failed = new Set(["failed", "cancelled"])
export function unixUpdateStartupAction(value: Startup): StartupAction {
  assert.ok(!value.inheritedNonce || value.inheritedNonce === value.nonce, "update-startup-nonce-mismatch")
  if (value.result === "committed") {
    assert.equal(value.current, "next", "update-result-identity-mismatch")
    return "finish"
  }
  if (value.result !== undefined) return failed.has(value.result) && value.current === "old" ? "finish" : "blocked"
  if (value.live) return value.inheritedNonce === value.nonce && value.current === "next" ? "trial" : "busy"
  // Без результата и без живого helper безопасно продолжать только с проверенной A.
  if (value.current === "old") return !value.ready && !value.journal ? "abandon" : "finish"
  return "blocked"
}
const exists = (file: string) => lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false })
const matches = (a: UnixHealthIdentity | null, b: UnixHealthIdentity) => !!a && ["identifier", "platform", "arch", "channel", "version", "hash"].every(key => a[key as keyof UnixHealthIdentity] === b[key as keyof UnixHealthIdentity])
type Files = NonNullable<Awaited<ReturnType<typeof readActiveUnixUpdate>>>
let trial: { acknowledge: () => Promise<void> } | undefined
async function result(files: Files) {
  const value = await readUnixHelperJson(files.result).catch(error => { if (error.code !== "ENOENT") throw error; return null })
  if (value) assert.equal(value.nonce, path.basename(files.directory), "Invalid update result nonce")
  return value
}
function helperLive(files: Files) { const release = acquireUnixFileLock(files.lock); if (!release) return true; release(); return false }
async function waitResult(files: Files) {
  const deadline = performance.now() + 120_000
  while (performance.now() < deadline) {
    const value = await result(files)
    if (value && !helperLive(files)) return value
    await Bun.sleep(100)
  }
  throw new Error("update-startup-result-timeout")
}
async function finish(files: Files, local: UnixHealthIdentity, status: "committed" | "failed") {
  const document = await readUnixHelperJson(files.job)
  const job = authenticateUnixHelperJob(document, { profile: await unixUpdateProfile(), parentPid: document.parentPid, ...unixNativeTarget() })
  assert.ok(matches(local, status === "committed" ? job.update.manifest : job.old), "update-result-identity-mismatch")
  if (job.installation.kind === "appimage") {
    if (status === "committed") await verifyUnixUpdateFile(job.installation.target, selectUnixUpdateArtifact(job.installation, job.update.manifest))
  } else await verifyUnixUpdatePayload(job.installation.target, local)
  await writeUnixHelperJson(path.join(files.root, "last-result.json"), { schemaVersion: 1, nonce: job.nonce, status, version: local.version, channel: local.channel })
  await (await unixUpdateStore()).clearPending()
  await clearActiveUnixUpdate(files)
  delete process.env.XNLC_UNIX_UPDATE_NONCE
}
async function block(files: Files, local: UnixHealthIdentity | null) {
  // Fail-closed: установленная B не подтвердила запуск, поэтому её нельзя объявлять успехом.
  // Предыдущий payload остаётся рядом с приложением и в profile-backup для ручного восстановления.
  await writeUnixHelperJson(path.join(files.root, "last-result.json"), { schemaVersion: 1, nonce: path.basename(files.directory),
    status: "failed", error: "update-recovery-required", version: local?.version ?? "unknown", channel: local?.channel ?? "unknown" }).catch(() => {})
  throw new Error("update-recovery-required")
}

/** Bootstrap вызывает это до импорта index и открытия БД. Автоматического отката нет. */
export async function resumeUnixUpdates(helper: string, quit: () => Promise<void>): Promise<boolean> {
  const profile = await unixUpdateProfile(), files = await readActiveUnixUpdate(profile)
  if (files) {
    const document = await readUnixHelperJson(files.job)
    const job = authenticateUnixHelperJob(document, { profile, parentPid: document.parentPid, ...unixNativeTarget() })
    const local = await readUnixLocalIdentity().catch(() => null)
    const saved = await result(files)
    const action = unixUpdateStartupAction({ nonce: job.nonce, inheritedNonce: process.env.XNLC_UNIX_UPDATE_NONCE,
      current: matches(local, job.old) ? "old" : matches(local, job.update.manifest) ? "next" : "unknown", live: helperLive(files),
      ready: await exists(files.ready), journal: await exists(path.join(files.directory, "package-transaction.json")) || await exists(path.join(path.dirname(job.installation.target), `.xneon-update-${job.nonce}`, "state.json")), result: saved?.status })
    if (action === "busy") throw new Error("update-in-progress")
    if (action === "blocked") { await block(files, local); return false }
    if (action === "finish") {
      assert.ok(local, "update-local-identity-missing")
      const outcome = helperLive(files) ? await waitResult(files) : saved
      const status = outcome?.status === "committed" ? "committed" : "failed"
      await finish(files, local, status); return false
    }
    if (action === "abandon") {
      // Ни ready, ни journal не были опубликованы: helper не имел права менять приложение.
      assert.ok(local, "update-local-identity-missing")
      await finish(files, local, "failed"); return false
    }
    if (action === "trial") {
      const commit = Promise.withResolvers<void>()
      unixUpdateStartupBarrier.hold(commit.promise)
      let acknowledgement: Promise<void> | undefined
      trial = { acknowledge: () => acknowledgement ??= (async () => {
        try {
          await acknowledgeUnixUpdateStartup(path.join(profile, "system-cache/unix-update-health"), job.nonce, local!)
          const outcome = await waitResult(files)
          assert.equal(outcome.status, "committed", "update-startup-failed")
          await finish(files, local!, "committed"); commit.resolve(); trial = undefined
        } catch (error) { commit.reject(error); throw error }
      })() }
      return false
    }
    // action === "trial" return above; здесь только подтверждённая A.
    assert.fail("update-startup-action-unknown")
  }
  assert.ok(!process.env.XNLC_UNIX_UPDATE_NONCE, "update-startup-nonce-mismatch")
  const context = await readUnixUpdateContext().catch(() => null)
  if (!context) return false // Dev/unmanaged build не имеет native version.json.
  const store = await unixUpdateStore()
  const pending = await store.peek(context.local, context.installation).catch(error => { console.error("[Unix updater] Invalid deferred update", error); return null })
  if (!pending?.deferred) return false
  await store.consumeDeferred(context.local, context.installation)
  try { await prepareUnixUpdateHandoff(await unixUpdateJob(context, pending), helper) }
  catch (error) {
    if (await readActiveUnixUpdate(profile)) throw error
    console.error("[Unix updater] Deferred update was not applied", error)
    return false
  }
  await quit(); return true
}

/** Вызывается только no-arg RPC от уже смонтированного основного renderer. */
export async function confirmUnixUpdateStartup() { await trial?.acknowledge() }