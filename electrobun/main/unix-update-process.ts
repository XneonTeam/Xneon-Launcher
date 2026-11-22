import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import type { UnixInstallation } from "./unix-update-installation"

const execute = promisify(execFile)
export function unixUpdateLaunchSpec(installation: UnixInstallation, nonce: string, inherited: Readonly<Record<string, string | undefined>> = process.env) {
  assert.ok(/^[a-f0-9]{32}$/.test(nonce), "Invalid update launch nonce")
  const target = installation.target
  assert.ok(path.posix.isAbsolute(target) && path.posix.normalize(target) === target && !/[\u0000-\u001f\\]/.test(target), "Invalid update restart path")
  assert.ok(installation.platform === "macos" ? installation.kind === "app-bundle" : installation.kind !== "app-bundle" && installation.kind !== "manual", "Unsupported update restart strategy")
  const file = installation.kind === "appimage" ? target
    : path.posix.join(target, installation.platform === "macos" ? "Contents/MacOS/launcher" : "bin/launcher")
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined || /^(?:LD_|DYLD_|ELECTROBUN_)/.test(key) ||
      ["APPIMAGE", "APPDIR", "OWD", "NODE_OPTIONS", "BUN_OPTIONS", "BUN_INSPECT", "BASH_ENV", "ENV", "XNLC_UNIX_UPDATE_NONCE"].includes(key)) continue
    env[key] = value
  }
  env.XNLC_UNIX_UPDATE_NONCE = nonce
  return { file, args: [] as string[], cwd: path.posix.dirname(file), env }
}

export async function spawnUnixUpdateProcess(installation: UnixInstallation, nonce: string, inherited?: NodeJS.ProcessEnv, logFd?: number) {
  assert.ok(process.platform === "linux" || process.platform === "darwin", "Native Unix process host required")
  const spec = unixUpdateLaunchSpec(installation, nonce, inherited)
  const child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"] })
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
  assert.ok(child.pid && child.pid > 1, "Updated process did not start")
  child.unref()
  return { pid: child.pid }
}

export async function unixProcessGroup(pid: number): Promise<number | null> {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, "Invalid update process ID")
  try {
    const result = await execute("/bin/ps", ["-p", String(pid), "-o", "pgid="], { encoding: "utf8", timeout: 3000, maxBuffer: 4096 })
    const value = result.stdout.trim()
    return /^\d+$/.test(value) && Number(value) > 1 ? Number(value) : null
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null
    throw new Error("Cannot inspect update process group")
  }
}
export async function ownsUnixUpdateProcess(pid: number, launchGroup: number, group = unixProcessGroup) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(launchGroup) || launchGroup <= 1) return false
  return await group(pid) === launchGroup
}

export function unixUpdateOwnedGroups(output: string, nonce: string) {
  assert.ok(/^[a-f0-9]{32}$/.test(nonce), "Invalid update ownership nonce")
  const groups = new Set<number>()
  const token = new RegExp(`(?:^|\\s)XNLC_UNIX_UPDATE_NONCE=${nonce}(?:\\s|$)`)
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (match && Number(match[1]) > 1 && token.test(match[2])) groups.add(Number(match[1]))
  }
  return [...groups]
}
export async function findUnixUpdateGroups(nonce: string) {
  assert.ok(process.getuid && (process.platform === "linux" || process.platform === "darwin"), "Native Unix process host required")
  try {
    const result = await execute("/bin/ps", ["eww", "-U", String(process.getuid()), "-o", "pgid=,command="], { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 ** 2 })
    // Сырые process environments не журналируются и не возвращаются наружу.
    return unixUpdateOwnedGroups(result.stdout, nonce)
  } catch { throw new Error("Cannot inspect owned update processes") }
}

function alive(pid: number, group = false) {
  try { process.kill(group ? -pid : pid, 0); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error }
}
export async function waitForUnixParentExit(pid: number, signal?: AbortSignal, timeout = 60_000) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, "Invalid update parent process")
  const deadline = Date.now() + timeout
  while (alive(pid)) {
    signal?.throwIfAborted()
    assert.ok(Date.now() < deadline, "Update parent did not exit")
    await Bun.sleep(100)
  }
  signal?.throwIfAborted()
}
export async function stopUnixUpdateGroup(group: number) {
  assert.ok(Number.isSafeInteger(group) && group > 1 && group !== process.pid, "Invalid update process group")
  const signal = (value: "SIGTERM" | "SIGKILL") => {
    try { process.kill(-group, value) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
  }
  if (!alive(group, true)) return
  signal("SIGTERM")
  for (let i = 0; i < 100 && alive(group, true); i++) await Bun.sleep(100)
  if (alive(group, true)) signal("SIGKILL")
  for (let i = 0; i < 30 && alive(group, true); i++) await Bun.sleep(100)
  assert.ok(!alive(group, true), "Updated process group remains alive; manual recovery is required")
}
