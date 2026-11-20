import assert from "node:assert/strict"
import { expectedUpdateBaseUrl, updatePublicKeys } from "./update-public-keys"
import { updateFeedGet, updateFeedReadBounded } from "./verified-update-feed"
import { compareReleaseVersions } from "./verified-update-manifest"
import { verifySignedUnixUpdateManifest, type UnixUpdateManifest, type UnixUpdateTarget } from "./unix-update-manifest"

export type VerifiedUnixUpdate = { manifest: UnixUpdateManifest; manifestBytes: Buffer; signatureBytes: Buffer; baseUrl: string }
export type UnixFeedRequest = (url: string, signal: AbortSignal, allowMissing?: boolean) => Promise<Response | null>
export function unixManifestUrls(target: UnixUpdateTarget) {
  const base = expectedUpdateBaseUrl(target.channel)
  const name = `${target.channel}-${target.platform}-${target.arch}-update-v3.json`
  return { base, manifestUrl: `${base}/${name}`, signatureUrl: `${base}/${name}.sig` }
}

export async function resolveVerifiedUnixUpdate(local: { version: string; hash: string; channel: "stable" | "canary" },
  target: UnixUpdateTarget, options: { request?: UnixFeedRequest; keys?: Readonly<Record<string, string>>; allowChannelSwitch?: boolean; signal?: AbortSignal } = {}): Promise<VerifiedUnixUpdate | null> {
  const switching = local.channel !== target.channel
  assert.ok(!switching || options.allowChannelSwitch === true, "Explicit channel switch is required")
  const keys = options.keys ?? updatePublicKeys
  assert.ok(Object.keys(keys).length, "Trusted update signing keys are not configured")
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000)
  signal.throwIfAborted()
  const request = options.request ?? updateFeedGet
  const urls = unixManifestUrls(target)
  const response = await request(urls.manifestUrl, signal, true)
  if (!response) return null
  assert.ok(response.ok, "Update manifest request failed")
  const manifestBytes = await updateFeedReadBounded(response, 64 * 1024)
  const signature = await request(urls.signatureUrl, signal)
  assert.ok(signature?.ok, "Update signature is missing")
  const signatureBytes = await updateFeedReadBounded(signature, 1024)
  const manifest = verifySignedUnixUpdateManifest(manifestBytes, signatureBytes, keys, target)
  signal.throwIfAborted()
  if (!switching && compareReleaseVersions(manifest.version, local.version) <= 0) return null
  assert.notEqual(manifest.hash, local.hash, "Update build hash is reused")
  return { manifest, manifestBytes, signatureBytes, baseUrl: urls.base }
}

export function unixHistoricalManifestUrls(local: { version: string; channel: "stable" | "canary" }, target: UnixUpdateTarget) {
  compareReleaseVersions(local.version, "0.0.0")
  assert.equal(target.channel, local.channel, "Historical channel mismatch")
  const { base } = unixManifestUrls(target)
  const position = base.lastIndexOf("/releases/")
  assert.ok(position > 0, "Historical update repository is not configured")
  const historical = base.slice(0, position) + "/releases/download/v" + local.version
  const name = `${local.channel}-${target.platform}-${target.arch}-update-v3.json`
  return { base: historical, manifestUrl: `${historical}/${name}`, signatureUrl: `${historical}/${name}.sig` }
}

export function isTrustedUnixUpdateBase(base: string) {
  try {
    const url = new URL(base)
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false
    if (base === expectedUpdateBaseUrl("stable") || base === expectedUpdateBaseUrl("canary")) return true
    const current = expectedUpdateBaseUrl("stable"), position = current.lastIndexOf("/releases/")
    if (position <= 0) return false
    const prefix = current.slice(0, position) + "/releases/download/v"
    if (!base.startsWith(prefix)) return false
    compareReleaseVersions(base.slice(prefix.length), "0.0.0")
    return true
  } catch { return false }
}

/** Для отката системного пакета нужна точная подписанная A, а не текущий latest B. */
export async function resolvePreviousUnixUpdate(local: { version: string; hash: string; channel: "stable" | "canary" }, target: UnixUpdateTarget,
  options: { request?: UnixFeedRequest; keys?: Readonly<Record<string, string>>; signal?: AbortSignal } = {}): Promise<VerifiedUnixUpdate> {
  const urls = unixHistoricalManifestUrls(local, target), request = options.request ?? updateFeedGet
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000)
  signal.throwIfAborted()
  const response = await request(urls.manifestUrl, signal, true)
  assert.ok(response?.ok, "Previous signed package update feed is unavailable")
  const manifestBytes = await updateFeedReadBounded(response, 64 * 1024)
  const signature = await request(urls.signatureUrl, signal)
  assert.ok(signature?.ok, "Previous update signature is missing")
  const signatureBytes = await updateFeedReadBounded(signature, 1024)
  const manifest = verifySignedUnixUpdateManifest(manifestBytes, signatureBytes, options.keys ?? updatePublicKeys, target)
  assert.ok(manifest.version === local.version && manifest.hash === local.hash, "Historical update differs from installed build")
  return { manifest, manifestBytes, signatureBytes, baseUrl: urls.base }
}
