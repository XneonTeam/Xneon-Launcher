import assert from "node:assert/strict"
import path from "node:path"
import { appIdentifier } from "./app-identity"
import { compareReleaseVersions, verifySignedUnixUpdateManifest, type UnixUpdateTarget } from "./update-manifest"
import { expectedUpdateBaseUrl, updatePublicKeys } from "./update-public-keys"
import { selectUnixUpdateArtifact, type UnixInstallation } from "./unix-update-installation"
import type { VerifiedUnixUpdate } from "./unix-update-feed"
import type { UnixHealthIdentity } from "./unix-update-health"

export type UnixHelperJobDocument = {
  schemaVersion: 1; nonce: string; parentPid: number; profile: string; selectedChannel: "stable" | "canary"
  old: UnixHealthIdentity; installation: UnixInstallation; executable: string
  mount: { APPIMAGE?: string; APPDIR?: string; XDG_DATA_HOME?: string }
  source: string; manifest: string; signature: string; allowChannelSwitch: boolean
}
type Context = { profile: string; parentPid: number; platform: "linux" | "macos"; arch: "x64" | "arm64" }
const p = path.posix
function absolute(value: unknown): asserts value is string {
  assert.ok(typeof value === "string" && value.length <= 4096 && p.isAbsolute(value) && p.normalize(value) === value && !/[\u0000-\u001f\\]/.test(value), "Invalid update helper path")
}
function base64(value: unknown, maximum: number) {
  assert.ok(typeof value === "string" && value.length > 0 && value.length <= maximum, "Invalid update helper metadata")
  const bytes = Buffer.from(value, "base64")
  assert.equal(bytes.toString("base64"), value, "Invalid update helper base64")
  return bytes
}

/** Job не задаёт команды или ключи. Программы выбирает helper, keys вшиты в его бандл. */
export function authenticateUnixHelperJob(input: unknown, context: Context, keys: Readonly<Record<string, string>> = updatePublicKeys) {
  const value = input as UnixHelperJobDocument
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid update helper job")
  const allowed = new Set(["schemaVersion", "nonce", "parentPid", "profile", "selectedChannel", "old", "installation", "executable", "mount", "source", "manifest", "signature", "allowChannelSwitch"])
  assert.ok(Object.keys(value).every(key => allowed.has(key)), "Unexpected update helper job field")
  assert.ok(value.schemaVersion === 1 && /^[a-f0-9]{32}$/.test(value.nonce), "Invalid update helper nonce")
  assert.ok(Number.isSafeInteger(value.parentPid) && value.parentPid > 1 && value.parentPid === context.parentPid, "Update helper parent mismatch")
  absolute(value.profile); absolute(context.profile)
  assert.ok(value.profile !== "/" && value.profile === context.profile, "Update helper profile mismatch")
  assert.ok(context.platform === "linux" && context.arch === "x64" || context.platform === "macos" && context.arch === "arm64", "Unsupported update helper target")
  assert.ok(value.selectedChannel === "stable" || value.selectedChannel === "canary", "Invalid update helper channel")
  const manifestBytes = base64(value.manifest, 90_000), signatureBytes = base64(value.signature, 2048)
  const manifest = verifySignedUnixUpdateManifest(manifestBytes, signatureBytes, keys,
    { platform: context.platform, arch: context.arch, channel: value.selectedChannel } as UnixUpdateTarget)
  const old = value.old
  assert.ok(old && old.identifier === appIdentifier && old.platform === context.platform && old.arch === context.arch &&
    (old.channel === "stable" || old.channel === "canary") && typeof old.hash === "string" && /^[a-z0-9]{1,64}$/.test(old.hash), "Invalid previous update identity")
  compareReleaseVersions(old.version, "0.0.0")
  assert.equal(/-(?:pre|beta)[1-9]\d*$/.test(old.version), old.channel === "canary", "Previous update channel/version mismatch")
  assert.notEqual(old.hash, manifest.hash, "Update build hash is reused")
  const switching = old.channel !== manifest.channel
  assert.equal(value.allowChannelSwitch, switching, "Explicit channel-switch intent mismatch")
  if (!switching) assert.ok(compareReleaseVersions(manifest.version, old.version) > 0, "Update must be newer than installed build")
  const installation = value.installation
  assert.ok(installation && installation.platform === context.platform && (context.platform === "macos" ? installation.kind === "app-bundle"
    : ["appimage", "directory", "deb", "rpm", "pacman"].includes(installation.kind)), "Invalid update installation strategy")
  absolute(installation.target); absolute(value.executable); absolute(value.source)
  assert.ok(p.dirname(value.source) === p.join(context.profile, "system-cache/unix-updates") && /^payload-[a-f0-9]{32}$/.test(p.basename(value.source)), "Update helper source is outside private cache")
  assert.ok(value.mount && typeof value.mount === "object" && !Array.isArray(value.mount) &&
    Object.keys(value.mount).every(key => ["APPIMAGE", "APPDIR", "XDG_DATA_HOME"].includes(key)), "Invalid update mount context")
  for (const entry of Object.values(value.mount)) absolute(entry)
  if (installation.kind === "appimage") {
    assert.equal(value.mount.APPIMAGE, installation.target, "AppImage path mismatch")
    absolute(value.mount.APPDIR)
    assert.equal(value.executable, p.join(value.mount.APPDIR, "opt/xneon-launcher/bin/bun"), "AppImage executable mismatch")
  } else {
    assert.ok(!value.mount.APPIMAGE && !value.mount.APPDIR, "Unexpected AppImage mount context")
    assert.equal(value.executable, p.join(installation.target, context.platform === "macos" ? "Contents/MacOS/bun" : "bin/bun"), "Update helper executable mismatch")
  }
  selectUnixUpdateArtifact(installation, manifest)
  const update: VerifiedUnixUpdate = { manifest, manifestBytes, signatureBytes, baseUrl: expectedUpdateBaseUrl(manifest.channel) }
  return { schemaVersion: 1 as const, nonce: value.nonce, parentPid: value.parentPid, profile: value.profile,
    selectedChannel: value.selectedChannel, old: { identifier: old.identifier, platform: old.platform, arch: old.arch, channel: old.channel, version: old.version, hash: old.hash },
    installation: { kind: installation.kind, platform: installation.platform, target: installation.target }, executable: value.executable,
    mount: { ...value.mount }, source: value.source, allowChannelSwitch: switching, update }
}
