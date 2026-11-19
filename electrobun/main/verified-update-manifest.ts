import { createPublicKey, verify, type KeyObject } from "node:crypto"
import { appIdentifier } from "./app-identity"

const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-(pre|beta)([1-9]\d{0,8}))?$/

type UpdateChannel = "stable" | "canary"

function releaseVersion(value: unknown): number[] {
  const match = typeof value === "string" ? versionPattern.exec(value) : null
  if (!match || match[0] !== value) throw new Error("Invalid update version")
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? (match[4] === "beta" ? 0 : 1) : Infinity, Number(match[5] ?? 0)]
}

export function compareReleaseVersions(a: unknown, b: unknown): number {
  const left = releaseVersion(a)
  const right = releaseVersion(b)
  const i = left.findIndex((part, index) => part !== right[index])
  return i < 0 ? 0 : left[i] > right[i] ? 1 : -1
}

export function verifyWindowsUpdateManifest(
  bytes: Buffer,
  signature: Buffer,
  publicKey: KeyObject,
  currentVersion: string,
  installedChannel: UpdateChannel,
  releasePreference: UpdateChannel,
) {
  if (bytes.length > MAX_MANIFEST_BYTES || signature.length !== 64 ||
      publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, bytes, publicKey, signature)) {
    throw new Error("Invalid update manifest signature")
  }

  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  if (manifest?.schemaVersion !== 1 || manifest.identifier !== appIdentifier ||
      manifest.platform !== "win" || manifest.arch !== "x64" || manifest.channel !== installedChannel) {
    throw new Error("Update manifest does not match the installed package")
  }

  const next = releaseVersion(manifest.version)
  if (compareReleaseVersions(manifest.version, currentVersion) <= 0) {
    throw new Error("Update version must be newer than the installed version")
  }
  if (releasePreference === "stable" && next[3] !== Infinity) throw new Error("Stable updates require a stable version")

  const artifact = manifest.artifact
  if (typeof manifest.hash !== "string" || !/^[a-z0-9]{1,64}$/.test(manifest.hash) ||
      !artifact || typeof artifact.file !== "string" ||
      !new RegExp(`^${installedChannel}-win-x64-[a-zA-Z0-9_-]{1,120}\\.tar\\.zst$`).test(artifact.file) ||
      typeof artifact.tarSha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.tarSha256) ||
      !Number.isSafeInteger(artifact.tarSize) || artifact.tarSize <= 0 || artifact.tarSize > MAX_ARCHIVE_BYTES) {
    throw new Error("Invalid update artifact metadata")
  }

  if (typeof artifact.downloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.downloadSha256) ||
      !Number.isSafeInteger(artifact.downloadSize) || artifact.downloadSize <= 0 || artifact.downloadSize > MAX_ARCHIVE_BYTES) {
    throw new Error("Invalid compressed update artifact metadata")
  }

  return {
    schemaVersion: 1,
    identifier: appIdentifier,
    channel: installedChannel,
    version: manifest.version as string,
    hash: manifest.hash as string,
    platform: "win",
    arch: "x64",
    artifact: { file: artifact.file as string, tarSha256: artifact.tarSha256 as string, tarSize: artifact.tarSize as number, downloadSha256: artifact.downloadSha256 as string, downloadSize: artifact.downloadSize as number },
  } as const
}

export function verifySignedWindowsUpdateManifest(
  bytes: Buffer,
  envelopeBytes: Buffer,
  trustedKeys: Readonly<Record<string, string>>,
  currentVersion: string,
  installedChannel: UpdateChannel,
  releasePreference: UpdateChannel,
) {
  if (envelopeBytes.length > 1024) throw new Error("Update signature envelope is oversized")
  const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelopeBytes))
  if (typeof envelope?.keyId !== "string" || !Object.hasOwn(trustedKeys, envelope.keyId) ||
      typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) {
    throw new Error("Unknown update signing key or invalid signature envelope")
  }
  return verifyWindowsUpdateManifest(bytes, Buffer.from(envelope.signature, "base64"),
    createPublicKey(trustedKeys[envelope.keyId]), currentVersion, installedChannel, releasePreference)
}
