import assert from "node:assert/strict"
import { constants } from "node:fs"
import { copyFile, lstat, mkdir, open, rename, rm } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import os from "node:os"
import type { authenticateUnixHelperJob } from "./unix-update-job"
import { detectUnixInstallation, selectUnixUpdateArtifact, type PackageKind } from "./unix-update-installation"
import { verifyInstalledUnixPackage, verifyUnixPackageMetadata, installUnixPackage } from "./unix-update-package"
import { verifyUnixUpdateFile } from "./unix-update-state"
import { verifyUnixUpdatePayload } from "./unix-update-payload"
import { compareReleaseVersions } from "./update-manifest"
import { backupUnixUpdateDatabase } from "./unix-update-profile"
import { getDefaultLauncherDataRoot, launcherLocationConfig } from "./profile-path"
import { readDataLocation } from "./data-location"
import { applyUnixPackageTransaction, type UnixPackageTransactionPorts } from "./unix-package-transaction"
import { findUnixUpdateGroups, ownsUnixUpdateProcess, spawnUnixUpdateProcess, stopUnixUpdateGroup, waitForUnixParentExit } from "./unix-update-process"
import { readUnixUpdateHealth, waitForUnixUpdateHealth } from "./unix-update-health"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"

type Job = ReturnType<typeof authenticateUnixHelperJob>
async function exists(file: string) { return lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false }) }
async function writeJson(file: string, value: unknown) {
  const temporary = file + `.${randomBytes(8).toString("hex")}.tmp`
  try {
    const handle = await open(temporary, "wx", 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    await rename(temporary, file)
    await syncUnixUpdateDirectory(path.dirname(file))
  } finally { await rm(temporary, { force: true }) }
}

/** Системный /opt принадлежит исключительно apt/dnf/pacman; helper не переустанавливает A. */
export async function runUnixPackageHelper(job: Job, directory: string) {
  assert.ok(process.platform === "linux" && job.old.platform === "linux" && job.old.arch === "x64" && ["deb", "rpm", "pacman"].includes(job.installation.kind), "Unsupported package helper target")
  const kind = job.installation.kind as PackageKind, { installation, update, nonce } = job
  const nextArtifact = selectUnixUpdateArtifact(installation, update.manifest)
  const nextDirectory = path.join(directory, "packages/next")
  await mkdir(nextDirectory, { recursive: true, mode: 0o700 })
  const nextFile = path.join(nextDirectory, nextArtifact.file)
  const snapshot = path.join(directory, "profile-backup"), database = path.join(readDataLocation(launcherLocationConfig, getDefaultLauncherDataRoot()).root, "data.db")
  const journal = path.join(directory, "package-transaction.json"), resultFile = path.join(directory, "result.json")
  const cancel = new AbortController()
  const timer = setInterval(() => { void exists(path.join(directory, "cancel")).then(value => { if (value) cancel.abort(new Error("update-cancelled")) }, () => cancel.abort(new Error("update-cancelled"))) }, 100)
  timer.unref()
  const stopNext = async () => {
    for (const group of await findUnixUpdateGroups(nonce)) await stopUnixUpdateGroup(group)
    assert.equal((await findUnixUpdateGroups(nonce)).length, 0, "Updated processes remain alive; manual recovery is required")
  }
  const ports: UnixPackageTransactionPorts = {
    verifyNextPackage: async () => {
      const actual = await detectUnixInstallation({ platform: "linux", arch: "x64", executable: job.executable, home: os.homedir(), environment: job.mount, identity: job.old })
      assert.deepEqual(actual, installation, "Package installation changed before handoff")
      await verifyInstalledUnixPackage(kind, job.old.version)
      if (!await exists(nextFile)) { await verifyUnixUpdateFile(job.source, nextArtifact); await copyFile(job.source, nextFile, constants.COPYFILE_EXCL) }
      await verifyUnixUpdateFile(nextFile, nextArtifact); await verifyUnixPackageMetadata(nextFile, kind, update.manifest.version)
    },
    ready: () => writeJson(path.join(directory, "ready.json"), { schemaVersion: 1, nonce, pid: process.pid }),
    waitForParentExit: () => waitForUnixParentExit(job.parentPid, cancel.signal),
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
    record: async next => { await writeJson(journal, { schemaVersion: 1, nonce, target: installation.target, kind, phase: next }) },
  }
  try {
    const result = await applyUnixPackageTransaction(ports)
    await writeJson(resultFile, { ...result, nonce, version: update.manifest.version, hash: update.manifest.hash })
    return result
  } catch (error) {
    // Автоматического отката нет: результат фиксируется как failed/cancelled.
    await writeJson(resultFile, { nonce, status: cancel.signal.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : "update-failed" })
    throw error
  } finally { clearInterval(timer) }
}