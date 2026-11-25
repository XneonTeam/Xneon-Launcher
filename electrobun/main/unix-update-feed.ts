import assert from "node:assert/strict"
import { expectedUpdateBaseUrl } from "./repository-identity"
import { updatePublicKeys } from "./update-public-keys"
import { updateFeedGet, updateFeedReadBounded } from "./verified-update-feed"
import { compareReleaseVersions, manifestFileName, verifySignedUnixUpdateManifest, type UnixUpdateManifest, type UnixUpdateTarget } from "./update-manifest"

export type VerifiedUnixUpdate = { manifest: UnixUpdateManifest; manifestBytes: Buffer; signatureBytes: Buffer; baseUrl: string }
export type UnixFeedRequest = (url: string, signal: AbortSignal, allowMissing?: boolean) => Promise<Response | null>
export function unixManifestUrls(target: UnixUpdateTarget) {
  const base = expectedUpdateBaseUrl(target.channel)
  const name = manifestFileName(target)
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

export function isTrustedUnixUpdateBase(base: string) {
  try {
    const url = new URL(base)
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false
    return base === expectedUpdateBaseUrl("stable") || base === expectedUpdateBaseUrl("canary")
  } catch { return false }
}
