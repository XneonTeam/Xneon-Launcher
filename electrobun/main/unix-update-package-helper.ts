import assert from "node:assert/strict"
import { constants } from "node:fs"
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import os from "node:os"
import type { authenticateUnixHelperJob } from "./unix-update-job"
import { detectUnixInstallation, selectUnixUpdateArtifact, type PackageKind } from "./unix-update-installation"
import { verifyInstalledUnixPackage, verifyUnixPackageMetadata, installUnixPackage } from "./unix-update-package"
import { resolvePreviousUnixUpdate, unixHistoricalManifestUrls, type VerifiedUnixUpdate } from "./unix-update-feed"
import { downloadUnixUpdateFile } from "./unix-update-download"
import { verifyUnixUpdateFile } from "./unix-update-state"
import { verifySignedUnixUpdateManifest } from "./unix-update-manifest"
import { updatePublicKeys } from "./update-public-keys"
import { compareReleaseVersions } from "./verified-update-manifest"
import { verifyUnixUpdatePayload } from "./unix-update-payload"
import { backupUnixUpdateDatabase, restoreUnixUpdateDatabase } from "./unix-update-profile"
import { getDefaultLauncherDataRoot, launcherLocationConfig } from "./profile-path"
import { readDataLocation } from "./data-location"
import { applyUnixPackageTransaction, recoverUnixPackageTransaction, type UnixPackagePhase, type UnixPackageTransactionPorts } from "./unix-package-transaction"
import { findUnixUpdateGroups, ownsUnixUpdateProcess, spawnUnixUpdateProcess, stopUnixUpdateGroup, waitForUnixParentExit } from "./unix-update-process"
import { readUnixUpdateHealth, waitForUnixUpdateHealth } from "./unix-update-health"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"

type Job = ReturnType<typeof authenticateUnixHelperJob>
const phases: UnixPackagePhase[] = ["verified", "parent-exited", "installing", "installed", "launched", "committed", "rolling-back", "rolled-back", "recovery-required"]
async function exists(file: string) { return lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false }) }
async function readJson(file: string) {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.uid === process.getuid!() && info.size > 0 && info.size <= 128 * 1024, "Invalid package helper metadata")
  return JSON.parse(await readFile(file, "utf8"))
}
async function writeJson(file: string, value: unknown) {
  const temporary = file + `.${randomBytes(8).toString("hex")}.tmp`
  try {
    const handle = await open(temporary, "wx", 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    await rename(temporary, file)
    await syncUnixUpdateDirectory(path.dirname(file))
  } finally { await rm(temporary, { force: true }) }
}

/** Системный /opt принадлежит исключительно apt/dnf/pacman, в том числе при rollback. */
export async function runUnixPackageHelper(job: Job, directory: string, recovery: boolean, keys = updatePublicKeys) {
  assert.ok(process.platform === "linux" && job.old.platform === "linux" && job.old.arch === "x64" && ["deb", "rpm", "pacman"].includes(job.installation.kind), "Unsupported package helper target")
  const kind = job.installation.kind as PackageKind, { installation, update, nonce } = job
  const nextArtifact = selectUnixUpdateArtifact(installation, update.manifest)
  const nextDirectory = path.join(directory, "packages/next"), previousDirectory = path.join(directory, "packages/previous")
  await mkdir(nextDirectory, { recursive: true, mode: 0o700 }); await mkdir(previousDirectory, { recursive: true, mode: 0o700 })
  const nextFile = path.join(nextDirectory, nextArtifact.file), previousMetadata = path.join(directory, "previous-package.json")
  const snapshot = path.join(directory, "profile-backup"), database = path.join(readDataLocation(launcherLocationConfig, getDefaultLauncherDataRoot()).root, "data.db")
  const journal = path.join(directory, "package-transaction.json"), resultFile = path.join(directory, "result.json")
  let previous: VerifiedUnixUpdate | undefined, previousFile: string | undefined, phase: UnixPackagePhase | undefined
  const cancel = new AbortController()
  const timer = setInterval(() => { void exists(path.join(directory, "cancel")).then(value => { if (value) cancel.abort(new Error("update-cancelled")) }, () => cancel.abort(new Error("update-cancelled"))) }, 100)
  timer.unref()
  const preparePrevious = async () => {
    if (!previous) {
      if (await exists(previousMetadata)) {
        const saved = await readJson(previousMetadata)
        assert.ok(typeof saved.manifest === "string" && typeof saved.signature === "string", "Invalid previous package signature metadata")
        const manifestBytes = Buffer.from(saved.manifest, "base64"), signatureBytes = Buffer.from(saved.signature, "base64")
        const manifest = verifySignedUnixUpdateManifest(manifestBytes, signatureBytes, keys, { platform: "linux", arch: "x64", channel: job.old.channel })
        assert.ok(manifest.version === job.old.version && manifest.hash === job.old.hash, "Previous package differs from original installed build")
        previous = { manifest, manifestBytes, signatureBytes, baseUrl: unixHistoricalManifestUrls(job.old, { platform: "linux", arch: "x64", channel: job.old.channel }).base }
      } else {
        assert.ok(!recovery, "Signed previous package metadata is missing during recovery")
        previous = await resolvePreviousUnixUpdate(job.old, { platform: "linux", arch: "x64", channel: job.old.channel }, { keys, signal: cancel.signal })
      }
    }
    const artifact = selectUnixUpdateArtifact(installation, previous.manifest)
    previousFile = path.join(previousDirectory, artifact.file)
    if (!await exists(previousFile)) {
      assert.ok(!recovery, "Verified previous package is missing during recovery")
      const download = await downloadUnixUpdateFile(previous.baseUrl, artifact, path.join(directory, "rollback-download"), { signal: cancel.signal })
      await copyFile(download.path, previousFile, constants.COPYFILE_EXCL)
      await rm(download.directory, { recursive: true, force: true })
    }
    await verifyUnixUpdateFile(previousFile, artifact)
    await verifyUnixPackageMetadata(previousFile, kind, previous.manifest.version)
    if (!await exists(previousMetadata)) await writeJson(previousMetadata, { manifest: previous.manifestBytes.toString("base64"), signature: previous.signatureBytes.toString("base64") })
  }
  const stopNext = async () => {
    for (const group of await findUnixUpdateGroups(nonce)) await stopUnixUpdateGroup(group)
    assert.equal((await findUnixUpdateGroups(nonce)).length, 0, "Updated processes remain alive; package rollback is unsafe")
  }
  const ports: UnixPackageTransactionPorts = {
    verifyNextPackage: async () => {
      if (!recovery) {
        const actual = await detectUnixInstallation({ platform: "linux", arch: "x64", executable: job.executable, home: os.homedir(), environment: job.mount, identity: job.old })
        assert.deepEqual(actual, installation, "Package installation changed before handoff")
        await verifyInstalledUnixPackage(kind, job.old.version)
      }
      if (!await exists(nextFile)) { await verifyUnixUpdateFile(job.source, nextArtifact); await copyFile(job.source, nextFile, constants.COPYFILE_EXCL) }
      await verifyUnixUpdateFile(nextFile, nextArtifact); await verifyUnixPackageMetadata(nextFile, kind, update.manifest.version)
    },
    verifyPreviousPackage: preparePrevious,
    ready: () => writeJson(path.join(directory, "ready.json"), { schemaVersion: 1, nonce, pid: process.pid, recovery }),
    waitForParentExit: () => waitForUnixParentExit(recovery ? process.ppid : job.parentPid, cancel.signal),
    backupProfile: async () => { await mkdir(snapshot, { mode: 0o700 }); await backupUnixUpdateDatabase(database, snapshot) },
    installNext: async () => {
      cancel.signal.throwIfAborted()
      await verifyUnixUpdateFile(nextFile, nextArtifact)
      await installUnixPackage(kind, nextFile, compareReleaseVersions(update.manifest.version, job.old.version) < 0)
    },
    verifyNextInstalled: async () => { await verifyInstalledUnixPackage(kind, update.manifest.version); await verifyUnixUpdatePayload(installation.target, update.manifest) },
    startNext: () => spawnUnixUpdateProcess(installation, nonce),
    waitHealthy: child => waitForUnixUpdateHealth({
      readHealthy: async () => !!await readUnixUpdateHealth(path.join(job.profile, "system-cache/unix-update-health"), nonce, update.manifest, pid => ownsUnixUpdateProcess(pid, child.pid)),
      isAlive: async () => (await findUnixUpdateGroups(nonce)).includes(child.pid),
    }, cancel.signal),
    stopNext,
    installPrevious: async () => {
      await preparePrevious()
      await installUnixPackage(kind, previousFile!, compareReleaseVersions(job.old.version, update.manifest.version) < 0)
    },
    verifyPreviousInstalled: async () => { await verifyInstalledUnixPackage(kind, job.old.version); await verifyUnixUpdatePayload(installation.target, job.old) },
    restoreProfile: () => restoreUnixUpdateDatabase(database, snapshot),
    startPrevious: async () => { await spawnUnixUpdateProcess(installation, nonce) },
    record: async next => {
      phase = next
      await writeJson(journal, { schemaVersion: 1, nonce, target: installation.target, kind, phase: next })
    },
  }
  try {
    if (recovery) {
      const saved = await readJson(journal)
      assert.ok(saved.schemaVersion === 1 && saved.nonce === nonce && saved.target === installation.target && saved.kind === kind && phases.includes(saved.phase), "Invalid package recovery journal")
      phase = saved.phase
      const result = await recoverUnixPackageTransaction(phase!, ports)
      await writeJson(resultFile, { ...result, nonce, version: result.status === "committed" ? update.manifest.version : job.old.version })
      return result
    }
    const result = await applyUnixPackageTransaction(ports)
    await writeJson(resultFile, { ...result, nonce, version: update.manifest.version, hash: update.manifest.hash })
    return result
  } catch (error) {
    await writeJson(resultFile, { nonce, status: phase === "rolled-back" ? "rolled-back" : cancel.signal.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : "update-failed" })
    throw error
  } finally { clearInterval(timer) }
}
