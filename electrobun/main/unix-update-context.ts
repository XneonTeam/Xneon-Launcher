import assert from "node:assert/strict"
import { lstat, mkdir, readFile, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import packageJson from "../../package.json"
import { appIdentifier } from "./app-identity"
import { getDefaultLauncherDataRoot } from "./profile-path"
import { UnixUpdateStateStore, type PendingUnixUpdate } from "./unix-update-state"
import { detectUnixInstallation } from "./unix-update-installation"
import type { UnixHealthIdentity } from "./unix-update-health"
import type { UnixUpdateContext } from "./unix-update-controller"
import type { UnixHelperJobDocument } from "./unix-update-job"

export function unixNativeTarget() {
  assert.ok(process.platform === "linux" && process.arch === "x64" || process.platform === "darwin" && process.arch === "arm64", "unsupported-package")
  return { platform: process.platform === "darwin" ? "macos" as const : "linux" as const, arch: process.arch as "x64" | "arm64" }
}
export async function unixUpdateProfile() {
  await mkdir(getDefaultLauncherDataRoot(), { recursive: true, mode: 0o700 })
  return realpath(getDefaultLauncherDataRoot())
}
let store: UnixUpdateStateStore | undefined
export async function unixUpdateStore() {
  return store ??= new UnixUpdateStateStore(path.join(await unixUpdateProfile(), "system-cache/unix-updates"), unixNativeTarget())
}
export async function readUnixLocalIdentity(): Promise<UnixHealthIdentity> {
  const target = unixNativeTarget(), executable = await realpath(process.execPath)
  const file = path.resolve(path.dirname(executable), "../Resources/version.json"), info = await lstat(file)
  assert.ok(info.isFile() && info.size > 0 && info.size <= 64 * 1024, "unsupported-package")
  const local = JSON.parse(await readFile(file, "utf8"))
  assert.ok(local.identifier === appIdentifier && local.version === packageJson.version && typeof local.hash === "string" && /^[a-z0-9]{1,64}$/.test(local.hash) &&
    (local.channel === "stable" || local.channel === "canary"), "unsupported-package")
  return { identifier: appIdentifier, ...target, version: local.version, hash: local.hash, channel: local.channel }
}
export async function readUnixUpdateContext(): Promise<UnixUpdateContext> {
  const local = await readUnixLocalIdentity()
  const installation = await detectUnixInstallation({ ...local, executable: process.execPath, home: os.homedir(), environment: process.env, identity: local })
  return { local, installation }
}
export async function unixUpdateJob(context: UnixUpdateContext, pending: PendingUnixUpdate): Promise<UnixHelperJobDocument> {
  const mount: UnixHelperJobDocument["mount"] = {}
  if (context.installation.kind === "appimage") {
    mount.APPIMAGE = context.installation.target
    mount.APPDIR = await realpath(process.env.APPDIR!)
  }
  if (process.env.XDG_DATA_HOME) mount.XDG_DATA_HOME = await realpath(process.env.XDG_DATA_HOME)
  return { schemaVersion: 1, nonce: randomBytes(16).toString("hex"), parentPid: process.pid, profile: await unixUpdateProfile(),
    old: context.local, installation: context.installation, executable: await realpath(process.execPath), mount,
    source: pending.path, manifest: pending.update.manifestBytes.toString("base64"), signature: pending.update.signatureBytes.toString("base64"),
    selectedChannel: pending.update.manifest.channel, allowChannelSwitch: pending.update.manifest.channel !== context.local.channel }
}
