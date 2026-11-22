import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { constants } from "node:fs"
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { getDefaultLauncherDataRoot, launcherLocationConfig } from "./profile-path"
import { readDataLocation } from "./data-location"
import { authenticateUnixHelperJob } from "./unix-update-job"
import { detectUnixInstallation, nativeInstallationProbe, selectUnixUpdateArtifact } from "./unix-update-installation"
import { verifyUnixUpdateFile } from "./unix-update-state"
import { extractUnixUpdateArchive } from "./unix-update-archive"
import { verifyUnixUpdatePayload } from "./unix-update-payload"
import { backupUnixUpdateDatabase } from "./unix-update-profile"
import { applyUnixUpdateTransaction, syncUnixUpdateDirectory, unixTransactionPaths, type UnixReplacementPlan } from "./unix-update-transaction"
import { probeUnixUpdateExchange } from "./unix-update-atomic"
import { findUnixUpdateGroups, ownsUnixUpdateProcess, spawnUnixUpdateProcess, stopUnixUpdateGroup, waitForUnixParentExit } from "./unix-update-process"
import { readUnixUpdateHealth, waitForUnixUpdateHealth } from "./unix-update-health"
import { assertUpdateFreeSpace } from "./unix-update-download"
import { appIdentifier } from "./app-identity"
import { acquireUnixFileLock } from "../platform/unix-file-lock"
import { runUnixPackageHelper } from "./unix-update-package-helper"
import { assertUnixUpdateStorageOutsideInstallation } from "./unix-update-storage"
import { unixHelperPaths, readUnixHelperJson } from "./unix-update-handoff"

async function privateDirectory(file: string) {
  const info = await lstat(file)
  assert.ok(info.isDirectory() && info.uid === process.getuid!() && !(info.mode & 0o077), "Update helper directory is not private")
  assert.equal(await realpath(file), file, "Update helper path is not canonical")
}
async function json(file: string, maximum = 128 * 1024) {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.uid === process.getuid!() && info.size > 0 && info.size <= maximum, "Invalid update helper metadata file")
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
async function exists(file: string) {
  return lstat(file).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false })
}
async function digestTree(root: string, directory: boolean) {
  const hash = createHash("sha256")
  const append = (value: string) => hash.update(Buffer.byteLength(value) + ":" + value)
  const names = directory ? ["", ...(await readdir(root, { recursive: true })).sort()] : [""]
  for (const name of names) {
    const file = name ? path.join(root, name) : root, info = await lstat(file)
    append(name.replaceAll("\\", "/")); append(String(info.mode & 0o777))
    if (info.isSymbolicLink()) { append("link"); append(await readlink(file)) }
    else if (info.isDirectory()) append("directory")
    else {
      assert.ok(info.isFile(), "Unsafe installed update payload file")
      append("file"); append(String(info.size))
      for await (const chunk of Bun.file(file).stream()) hash.update(chunk)
    }
  }
  return hash.digest("hex")
}
async function appImage(file: string) {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.mode & 0o111, "AppImage is not executable")
  const header = await nativeInstallationProbe.header(file)
  assert.ok(header.toString("hex", 0, 4) === "7f454c46" && header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === 62 && header.toString("hex", 8, 11) === "414902", "Invalid AppImage runtime")
  const bytes = Buffer.from(await Bun.file(file).slice(0, Math.min(info.size, 16 * 1024 ** 2)).arrayBuffer())
  let offset = -1, valid = false
  while ((offset = bytes.indexOf("hsqs", offset + 1, "ascii")) >= 0) {
    if (offset + 96 > bytes.length) break
    const block = bytes.readUInt32LE(offset + 12), used = bytes.readBigUInt64LE(offset + 40)
    if (bytes.readUInt16LE(offset + 28) === 4 && bytes.readUInt16LE(offset + 30) === 0 && block >= 4096 && block <= 1024 ** 2 &&
      !(block & (block - 1)) && used >= 96n && used + BigInt(offset) <= BigInt(info.size)) { valid = true; break }
  }
  assert.ok(valid, "Invalid AppImage SquashFS payload")
}

/** Самостоятельный процесс: не импортирует main SDK/окна и не работает из заменяемого .app. */
export async function runUnixUpdateHelper(jobFile: string) {
  assert.ok(process.platform === "linux" && process.arch === "x64" || process.platform === "darwin" && process.arch === "arm64", "Native supported Unix helper required")
  const profile = await realpath(getDefaultLauncherDataRoot())
  const directory = path.dirname(path.resolve(jobFile)), nonce = path.basename(directory)
  assert.match(nonce, /^[a-f0-9]{32}$/)
  assert.equal(directory, path.join(profile, "system-cache/unix-update-helper", nonce), "Helper job is outside private profile cache")
  await privateDirectory(directory)
  assert.equal(path.resolve(jobFile), path.join(directory, "job.json"), "Invalid helper job filename")
  assert.equal(await realpath(process.execPath), path.join(directory, "runtime"), "Helper runtime is inside an uncontrolled installation")
  const document = await json(jobFile)
  const job = authenticateUnixHelperJob(document, { profile, parentPid: process.ppid,
    platform: process.platform === "darwin" ? "macos" : "linux", arch: process.arch })
  assert.equal(job.nonce, nonce, "Helper nonce/path mismatch")
  const data = readDataLocation(launcherLocationConfig, getDefaultLauncherDataRoot()).root
  // Исчезновение AppImage mount после выхода A так же опасно, как замена каталога .app.
  await assertUnixUpdateStorageOutsideInstallation([job.installation.target, ...(job.mount.APPDIR ? [job.mount.APPDIR] : [])], profile, data)
  const release = acquireUnixFileLock(path.join(directory, "helper.lock"))
  assert.ok(release, "update-in-progress")
  let releaseApply: (() => void) | null = null
  try {
    const files = unixHelperPaths(profile, nonce)
    releaseApply = acquireUnixFileLock(files.lock)
    assert.ok(releaseApply, "update-in-progress")
    assert.equal((await readUnixHelperJson(files.active, 4096)).nonce, nonce, "Active update nonce mismatch")
    return await runAuthenticatedUnixHelper(job, directory)
  } finally { releaseApply?.(); release() }
}

async function runAuthenticatedUnixHelper(job: ReturnType<typeof authenticateUnixHelperJob>, directory: string) {
  const { nonce, profile } = job
  const { installation, update } = job
  if (["deb", "rpm", "pacman"].includes(installation.kind)) return runUnixPackageHelper(job, directory)
  const plan: UnixReplacementPlan = { target: installation.target, nonce, kind: installation.kind === "appimage" ? "file" : "directory" }
  const files = unixTransactionPaths(plan), baselineFile = path.join(directory, "baseline.json")
  const snapshot = path.join(directory, "profile-backup")
  const healthRoot = path.join(profile, "system-cache/unix-update-health")
  const database = path.join(readDataLocation(launcherLocationConfig, getDefaultLauncherDataRoot()).root, "data.db")
  const resultFile = path.join(directory, "result.json")
  const cancel = new AbortController()
  const cancellation = setInterval(() => { void exists(path.join(directory, "cancel")).then(value => { if (value) cancel.abort(new Error("update-cancelled")) }, () => cancel.abort(new Error("update-cancelled"))) }, 100)
  cancellation.unref()
  let parentExited = false, createdWork = false, baseline: { old: string; next: string }
  const stopAll = async () => {
    for (const group of await findUnixUpdateGroups(nonce)) await stopUnixUpdateGroup(group)
    assert.equal((await findUnixUpdateGroups(nonce)).length, 0, "Updated processes still use the payload; manual recovery is required")
  }
  const verifyOld = async (file = plan.target) => {
    assert.equal(await digestTree(file, plan.kind === "directory"), baseline.old, "Previous application payload changed")
    if (plan.kind === "file") await appImage(file)
    else await verifyUnixUpdatePayload(file, job.old)
  }
  const verifyNew = async (file: string) => {
    assert.equal(await digestTree(file, plan.kind === "directory"), baseline.next, "Prepared application payload changed")
    if (plan.kind === "file") await appImage(file)
    else await verifyUnixUpdatePayload(file, update.manifest)
  }
  const ready = () => writeJson(path.join(directory, "ready.json"), { schemaVersion: 1, nonce, pid: process.pid })
  try {
    const detected = await detectUnixInstallation({ platform: job.old.platform, arch: job.old.arch, executable: job.executable, home: os.homedir(), environment: job.mount, identity: job.old })
    assert.deepEqual(detected, installation, "Installed update strategy changed before handoff")
    const artifact = selectUnixUpdateArtifact(installation, update.manifest)
    await verifyUnixUpdateFile(job.source, artifact)
    const old = await digestTree(plan.target, plan.kind === "directory")
    if (plan.kind === "directory") await verifyUnixUpdatePayload(plan.target, job.old)
    else await appImage(plan.target)
    await assertUpdateFreeSpace(path.dirname(plan.target), artifact.downloadSize + (plan.kind === "directory" ? update.manifest.artifact.tarSize : (await lstat(plan.target)).size) + 16 * 1024 ** 2)
    await mkdir(files.work, { mode: 0o700 }); createdWork = true
    if (plan.kind === "directory") await probeUnixUpdateExchange(files.work)
    if (plan.kind === "file") {
      await copyFile(job.source, files.prepared, constants.COPYFILE_EXCL); await chmod(files.prepared, 0o755)
      await verifyUnixUpdateFile(files.prepared, artifact); await appImage(files.prepared)
      const handle = await open(files.prepared, "r+")
      try { await handle.sync() } finally { await handle.close() }
    } else {
      const bundle = job.old.platform === "macos" ? `Xneon Launcher${update.manifest.channel === "stable" ? "" : "-canary"}.app`
        : `XneonLauncher${update.manifest.channel === "stable" ? "" : "-canary"}`
      const extracted = await extractUnixUpdateArchive(job.source, path.join(files.work, "extracted"), bundle, update.manifest.artifact, cancel.signal)
      await verifyUnixUpdatePayload(extracted, update.manifest)
      // Переносим только известный локальный TAR-policy marker, а не произвольные файлы старого app.
      const marker = path.join(plan.target, "Resources/update-installation.json")
      if (installation.platform === "linux" && await exists(marker)) {
        const value = await json(marker, 4096)
        assert.ok(value.schemaVersion === 1 && value.identifier === appIdentifier && value.format === "tar-xz", "Invalid local archive update policy")
        const handle = await open(path.join(extracted, "Resources/update-installation.json"), "wx", 0o600)
        try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, identifier: appIdentifier, format: "tar-xz" })) } finally { await handle.close() }
      }
      await rename(extracted, files.prepared)
    }
    baseline = { old, next: await digestTree(files.prepared, plan.kind === "directory") }
    await writeJson(baselineFile, baseline)
    const result = await applyUnixUpdateTransaction(plan, {
      ready,
      waitForParentExit: async () => {
        await waitForUnixParentExit(job.parentPid, cancel.signal); parentExited = true
        await mkdir(snapshot, { mode: 0o700 }); await backupUnixUpdateDatabase(database, snapshot)
      },
      verifyCurrent: () => verifyOld(), verifyPrepared: () => verifyNew(files.prepared),
      launch: () => spawnUnixUpdateProcess(installation, nonce),
      waitHealthy: child => waitForUnixUpdateHealth({
        readHealthy: async () => !!await readUnixUpdateHealth(healthRoot, nonce, update.manifest, pid => ownsUnixUpdateProcess(pid, child.pid)),
        isAlive: async () => (await findUnixUpdateGroups(nonce)).includes(child.pid),
      }, cancel.signal),
      stop: stopAll,
    }, cancel.signal)
    await writeJson(resultFile, { ...result, nonce, version: update.manifest.version, hash: update.manifest.hash })
    return result
  } catch (error) {
    // Автоматического отката нет. Неудача фиксируется как failed/cancelled, новая версия не объявляется успешной.
    await writeJson(resultFile, { nonce, status: cancel.signal.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : "update-failed" })
    if (createdWork && !parentExited && !await exists(files.backup)) await rm(files.work, { recursive: true, force: true })
    throw error
  } finally { clearInterval(cancellation) }
}