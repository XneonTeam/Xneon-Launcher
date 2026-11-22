import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { chmod, copyFile, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { acquireUnixFileLock } from "../platform/unix-file-lock"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"
import { authenticateUnixHelperJob, type UnixHelperJobDocument } from "./unix-update-job"

export function unixHelperPaths(profile: string, nonce: string) {
  assert.match(nonce, /^[a-f0-9]{32}$/)
  const root = path.join(profile, "system-cache/unix-update-helper"), directory = path.join(root, nonce)
  return { root, directory, active: path.join(root, "active.json"), lock: path.join(root, "apply.lock"),
    runtime: path.join(directory, "runtime"), helper: path.join(directory, "helper.cjs"), job: path.join(directory, "job.json"),
    ready: path.join(directory, "ready.json"), cancel: path.join(directory, "cancel"), result: path.join(directory, "result.json") }
}
type Files = ReturnType<typeof unixHelperPaths>
export async function privateUnixHelperDirectory(directory: string) {
  const info = await lstat(directory)
  assert.ok(info.isDirectory() && await realpath(directory) === directory, "Unsafe update helper directory")
  if (process.platform !== "win32") assert.ok(info.uid === process.getuid!() && !(info.mode & 0o077), "Update helper directory is not private")
}
export async function readUnixHelperJson(file: string, maximum = 128 * 1024): Promise<any> {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.size > 0 && info.size <= maximum, "Invalid update helper metadata")
  if (process.platform !== "win32") assert.ok(info.uid === process.getuid!() && !(info.mode & 0o077), "Update helper metadata is not private")
  return JSON.parse(await readFile(file, "utf8"))
}
export async function writeUnixHelperJson(file: string, value: unknown, exclusive = false) {
  const temporary = exclusive ? file : file + `.${randomBytes(8).toString("hex")}.tmp`
  try {
    const handle = await open(temporary, "wx", 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    if (!exclusive) await rename(temporary, file)
    await syncUnixUpdateDirectory(path.dirname(file))
  } finally { if (!exclusive) await rm(temporary, { force: true }) }
}
async function helperRoot(profile: string, nonce: string) {
  assert.equal(await realpath(profile), profile, "Update profile is not canonical")
  const files = unixHelperPaths(profile, nonce)
  await mkdir(path.dirname(files.root), { recursive: true, mode: 0o700 })
  assert.equal(await realpath(path.dirname(files.root)), path.dirname(files.root), "Unsafe update cache path")
  await mkdir(files.root, { recursive: true, mode: 0o700 })
  await privateUnixHelperDirectory(files.root)
  return files
}

/** Низкоуровневое копирование: production caller предварительно аутентифицирует job. Не является IPC. */
export async function prepareUnixHelperFiles(profile: string, nonce: string, runtime: string, helper: string, document: unknown) {
  const files = await helperRoot(profile, nonce)
  await mkdir(files.directory, { mode: 0o700 })
  await privateUnixHelperDirectory(files.directory)
  for (const [source, destination] of [[runtime, files.runtime], [helper, files.helper]]) {
    assert.ok((await lstat(source)).isFile(), "Unsafe update helper source")
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    await chmod(destination, 0o700)
    const file = await open(destination, "r+")
    try { await file.sync() } finally { await file.close() }
  }
  await writeUnixHelperJson(files.job, document, true)
  await syncUnixUpdateDirectory(files.root)
  return files
}

export async function waitForUnixHelperReady(files: Files, pid: number, alive: () => boolean, signal?: AbortSignal) {
  const deadline = performance.now() + 300_000
  while (performance.now() < deadline) {
    signal?.throwIfAborted()
    assert.ok(alive(), "update-helper-exited")
    const record = await readUnixHelperJson(files.ready, 4096).catch(error => { if (error.code !== "ENOENT") throw error; return null })
    if (record) {
      assert.ok(record.schemaVersion === 1 && record.nonce === path.basename(files.directory) && record.pid === pid, "Invalid update helper readiness")
      signal?.throwIfAborted()
      assert.ok(alive(), "update-helper-exited")
      return
    }
    await Bun.sleep(100)
  }
  throw new Error("update-helper-timeout")
}

export async function readActiveUnixUpdate(profile: string) {
  const files = unixHelperPaths(profile, "0".repeat(32))
  let active: any
  try {
    await privateUnixHelperDirectory(files.root)
    active = await readUnixHelperJson(files.active, 4096)
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
  assert.ok(active.schemaVersion === 1 && typeof active.nonce === "string" && /^[a-f0-9]{32}$/.test(active.nonce), "Invalid active update")
  const own = unixHelperPaths(profile, active.nonce)
  // После найденного active отсутствие его job-каталога — повреждение, не разрешение открыть БД.
  await privateUnixHelperDirectory(own.directory)
  return own
}
export async function clearActiveUnixUpdate(files: Files) {
  const record = await readUnixHelperJson(files.active, 4096)
  assert.equal(record.nonce, path.basename(files.directory), "Active update changed")
  await rm(files.active)
  await syncUnixUpdateDirectory(files.root)
}

export async function launchUnixUpdateHelper(files: Files, signal?: AbortSignal) {
  assert.ok(process.platform === "linux" || process.platform === "darwin", "Native Unix helper host required")
  await privateUnixHelperDirectory(files.directory)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(?:LD_|DYLD_|ELECTROBUN_)/.test(key) || ["APPIMAGE", "APPDIR", "NODE_OPTIONS", "BUN_OPTIONS", "BUN_INSPECT", "XNLC_UNIX_UPDATE_NONCE"].includes(key)) delete env[key]
  const log = await open(path.join(files.directory, "helper.log"), "a", 0o600)
  const child = spawn(files.runtime, [files.helper, files.job], { cwd: files.directory, env, detached: true, stdio: ["ignore", log.fd, log.fd] })
  let exited = false
  const exit = new Promise<void>(resolve => { child.once("exit", () => { exited = true; resolve() }); child.once("error", () => { exited = true; resolve() }) })
  const cancel = async () => {
    await writeUnixHelperJson(files.cancel, { cancelled: true })
    await Promise.race([exit, Bun.sleep(10_000)])
    if (!exited) { child.kill("SIGTERM"); await Promise.race([exit, Bun.sleep(3000)]) }
    assert.ok(exited, "update-helper-cancellation-failed")
  }
  try {
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
    assert.ok(child.pid && child.pid > 1, "Update helper did not start")
    await waitForUnixHelperReady(files, child.pid, () => !exited, signal)
    child.unref()
    return { files, cancel }
  } catch (error) { if (!exited) await cancel(); throw error }
  finally { await log.close() }
}

export async function prepareUnixUpdateHandoff(document: UnixHelperJobDocument, helper: string, signal?: AbortSignal) {
  assert.ok(process.platform === "linux" && process.arch === "x64" || process.platform === "darwin" && process.arch === "arm64", "Unsupported native update host")
  authenticateUnixHelperJob(document, { profile: document.profile, parentPid: process.pid, platform: process.platform === "darwin" ? "macos" : "linux", arch: process.arch })
  const files = await helperRoot(document.profile, document.nonce)
  const release = acquireUnixFileLock(files.lock)
  assert.ok(release, "update-in-progress")
  try {
    assert.ok(!await readActiveUnixUpdate(document.profile), "update-recovery-required")
    await prepareUnixHelperFiles(document.profile, document.nonce, await realpath(process.execPath), helper, document)
    await writeUnixHelperJson(files.active, { schemaVersion: 1, nonce: document.nonce }, true)
  } finally { release() }
  try {
    const handoff = await launchUnixUpdateHelper(files, signal)
    return { files, cancel: async () => { await handoff.cancel(); await clearActiveUnixUpdate(files) } }
  }
  catch (error) {
    // Родитель ещё жив и не разрешал swap: cancelled/failed handoff можно безопасно снять.
    if (!(error instanceof Error && error.message === "update-helper-cancellation-failed")) await clearActiveUnixUpdate(files)
    throw error
  }
}
