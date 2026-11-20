import assert from "node:assert/strict"
import { appIdentifier } from "./app-identity"
import { authenticateUpdateDocument, readUpdateSignature } from "./authenticated-update-document"
import { compareReleaseVersions } from "./verified-update-manifest"

export type UnixUpdateTarget = { platform: "linux"; arch: "x64"; channel: "stable" | "canary" }
  | { platform: "macos"; arch: "arm64"; channel: "stable" | "canary" }
export type LinuxDistribution = "appimage" | "deb" | "rpm" | "pacman" | "tar-xz"
export type UnixUpdateFile = { file: string; format: LinuxDistribution | "electrobun-tar-zstd"; downloadSize: number; downloadSha256: string }
export type UnixUpdateManifest = UnixUpdateTarget & {
  schemaVersion: 2; identifier: string; version: string; hash: string
  artifact: UnixUpdateFile & { format: "electrobun-tar-zstd"; tarSize: number; tarSha256: string }
  distributions: Partial<Record<LinuxDistribution, UnixUpdateFile>>
}
export const UNIX_UPDATE_MAX_BYTES = 2 * 1024 ** 3
const distributionSuffix = { appimage: "x86_64.AppImage", deb: "amd64.deb", rpm: "x86_64.rpm", pacman: "x86_64.pacman", "tar-xz": "x64.tar.xz" } as const

export function unixDistributionName(version: string, format: LinuxDistribution) {
  return `xneon-launcher-${version}-${distributionSuffix[format]}`
}

function fileMetadata(value: any, file: string, format: UnixUpdateFile["format"]): UnixUpdateFile {
  assert.ok(value && value.file === file && value.format === format, "Invalid update artifact format or filename")
  assert.ok(Number.isSafeInteger(value.downloadSize) && value.downloadSize > 0 && value.downloadSize <= UNIX_UPDATE_MAX_BYTES, "Invalid update download size")
  assert.ok(typeof value.downloadSha256 === "string" && /^[a-f0-9]{64}$/.test(value.downloadSha256), "Invalid update SHA-256")
  return { file, format, downloadSize: value.downloadSize, downloadSha256: value.downloadSha256 }
}

/** Отдельный Unix v3 feed: уже выпущенные Windows-клиенты сохраняют прежний v2 контракт. */
export function verifySignedUnixUpdateManifest(bytes: Buffer, envelopeBytes: Buffer,
  trustedKeys: Readonly<Record<string, string>>, expected: UnixUpdateTarget): UnixUpdateManifest {
  const { signature, publicKey } = readUpdateSignature(envelopeBytes, trustedKeys)
  const value = authenticateUpdateDocument(bytes, signature, publicKey)
  assert.ok(expected.platform === "linux" && expected.arch === "x64" || expected.platform === "macos" && expected.arch === "arm64", "Unsupported update target")
  assert.ok(expected.channel === "stable" || expected.channel === "canary", "Invalid update channel")
  assert.ok(value.schemaVersion === 2 && value.identifier === appIdentifier && value.platform === expected.platform &&
    value.arch === expected.arch && value.channel === expected.channel, "Update manifest does not match the installed package")
  compareReleaseVersions(value.version, "0.0.0")
  const prerelease = /-(?:pre|beta)[1-9]\d*$/.test(value.version)
  assert.equal(prerelease, expected.channel === "canary", "Update version does not match the selected channel")
  assert.ok(typeof value.hash === "string" && /^[a-z0-9]{1,64}$/.test(value.hash), "Invalid update build hash")
  const suffix = expected.channel === "stable" ? "" : "-canary"
  const name = `${expected.channel}-${expected.platform}-${expected.arch}-XneonLauncher${suffix}${expected.platform === "macos" ? ".app" : ""}.tar.zst`
  const transport = fileMetadata(value.artifact, name, "electrobun-tar-zstd")
  assert.ok(Number.isSafeInteger(value.artifact.tarSize) && value.artifact.tarSize > 0 && value.artifact.tarSize <= UNIX_UPDATE_MAX_BYTES, "Invalid update tar size")
  assert.ok(typeof value.artifact.tarSha256 === "string" && /^[a-f0-9]{64}$/.test(value.artifact.tarSha256), "Invalid update tar SHA-256")
  assert.ok(value.distributions && typeof value.distributions === "object" && !Array.isArray(value.distributions), "Invalid update distributions")
  const distributions: UnixUpdateManifest["distributions"] = {}
  for (const [format, file] of Object.entries(value.distributions)) {
    assert.ok(expected.platform === "linux" && Object.hasOwn(distributionSuffix, format), "Unsupported update distribution")
    const kind = format as LinuxDistribution
    distributions[kind] = fileMetadata(file, unixDistributionName(value.version, kind), kind)
  }
  return { ...expected, schemaVersion: 2, identifier: appIdentifier, version: value.version, hash: value.hash,
    artifact: { ...transport, format: "electrobun-tar-zstd", tarSize: value.artifact.tarSize, tarSha256: value.artifact.tarSha256 }, distributions }
}
