import type { KeyObject } from "node:crypto"
import { readUpdateSignature } from "./authenticated-update-document"
import { compareReleaseVersions, isPrereleaseVersion, verifyUpdateManifest, type UpdateChannel, type UpdateManifest } from "./update-manifest"

export { compareReleaseVersions }

/**
 * Платформенная политика Windows поверх общего Manifest v1. Формат документа и
 * подпись те же, что у Unix; различаются только правила установки и сравнения.
 */
export function verifyWindowsUpdateManifest(
  bytes: Buffer,
  signature: Buffer,
  publicKey: KeyObject,
  currentVersion: string,
  installedChannel: UpdateChannel,
  releasePreference: UpdateChannel,
): UpdateManifest & { platform: "win"; arch: "x64" } {
  const manifest = verifyUpdateManifest(bytes, signature, publicKey, { channel: installedChannel, platform: "win", arch: "x64" })
  if (compareReleaseVersions(manifest.version, currentVersion) <= 0) {
    throw new Error("Update version must be newer than the installed version")
  }
  if (releasePreference === "stable" && isPrereleaseVersion(manifest.version)) throw new Error("Stable updates require a stable version")
  return manifest as UpdateManifest & { platform: "win"; arch: "x64" }
}

export function verifySignedWindowsUpdateManifest(
  bytes: Buffer,
  envelopeBytes: Buffer,
  trustedKeys: Readonly<Record<string, string>>,
  currentVersion: string,
  installedChannel: UpdateChannel,
  releasePreference: UpdateChannel,
) {
  const { signature, publicKey } = readUpdateSignature(envelopeBytes, trustedKeys)
  return verifyWindowsUpdateManifest(bytes, signature, publicKey, currentVersion, installedChannel, releasePreference)
}