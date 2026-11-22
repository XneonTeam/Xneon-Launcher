import assert from "node:assert/strict"
import type { KeyObject } from "node:crypto"
import { appIdentifier } from "./app-identity"
import { authenticateUpdateDocument, readUpdateSignature } from "./authenticated-update-document"

/**
 * Единый Manifest v1 для Windows, Linux и macOS.
 *
 * Формат документа один: `schemaVersion` всегда 1, состав полей одинаков, подпись —
 * Ed25519 по исходным bytes. Платформенные updater-ы остаются разными: этот модуль
 * описывает только документ, общую структурную проверку и правила имён.
 */

export type UpdateChannel = "stable" | "canary"
export type UpdatePlatform = "win" | "linux" | "macos"
export type UpdateArch = "x64" | "arm64"
export type LinuxDistribution = "appimage" | "deb" | "rpm" | "pacman" | "tar-xz"

export type UpdateTarget = { channel: UpdateChannel; platform: UpdatePlatform; arch: UpdateArch }
/** Архитектуры закреплены за платформами: у Unix нет Windows-набора arch. */
export type UnixUpdateTarget =
  | { channel: UpdateChannel; platform: "linux"; arch: "x64" }
  | { channel: UpdateChannel; platform: "macos"; arch: "arm64" }

export type UpdateFile = { file: string; downloadSize: number; downloadSha256: string }
export type UpdateArtifact = UpdateFile & { tarSize: number; tarSha256: string }
export type UpdateInstaller = { file: string; size: number; sha256: string }
export type UpdateManifest = UpdateTarget & {
  schemaVersion: 1
  identifier: string
  version: string
  hash: string
  artifact: UpdateArtifact
  installer?: UpdateInstaller
  distributions?: Partial<Record<LinuxDistribution, UpdateFile>>
}
export type UnixUpdateFile = UpdateFile
export type UnixUpdateManifest = UnixUpdateTarget & {
  schemaVersion: 1
  identifier: string
  version: string
  hash: string
  artifact: UpdateArtifact
  distributions: Partial<Record<LinuxDistribution, UpdateFile>>
}

/** Совпадает с прежним лимитом Windows/Unix transport. */
export const UPDATE_MAX_BYTES = 2 * 1024 ** 3
export const UPDATE_INSTALLER_MAX_BYTES = 512 * 1024 ** 2

const distributionSuffix = { appimage: "x86_64.AppImage", deb: "amd64.deb", rpm: "x86_64.rpm", pacman: "x86_64.pacman", "tar-xz": "x64.tar.xz" } as const
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-(pre|beta)([1-9]\d{0,8}))?$/

export const unixDistributions = Object.keys(distributionSuffix) as LinuxDistribution[]

export function unixDistributionName(version: string, format: LinuxDistribution) {
  return `xneon-launcher-${version}-${distributionSuffix[format]}`
}

/** Канонический подписанный манифест; его читает Unix updater. */
export function manifestFileName(target: UpdateTarget) {
  return `${target.channel}-${target.platform}-${target.arch}-update.json`
}

/** Байт-идентичная копия для выпущенных Windows-клиентов и Electrobun SDK. */
export function compatibilityManifestFileName(target: UpdateTarget) {
  return `${target.channel}-${target.platform}-${target.arch}-update-v2.json`
}

/** Имя native tar-архива, которое публикует Electrobun/Hutch. */
export function nativeArchiveName(target: UpdateTarget) {
  const suffix = target.channel === "stable" ? "" : "-canary"
  return `${target.channel}-${target.platform}-${target.arch}-XneonLauncher${suffix}${target.platform === "macos" ? ".app" : ""}.tar.zst`
}

/** Корень bundle внутри tar: у macOS display name с пробелом и .app. */
export function nativeBundleRoot(target: UpdateTarget) {
  const suffix = target.channel === "stable" ? "" : "-canary"
  return target.platform === "macos" ? `Xneon Launcher${suffix}.app` : `XneonLauncher${suffix}`
}

export function updateInstallerName(version: string) {
  return `xneon-launcher-${version}-win-x64.exe`
}

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

export function isPrereleaseVersion(version: unknown) {
  releaseVersion(version)
  return /-(?:pre|beta)\d+$/.test(version as string)
}

function assertTarget(target: UpdateTarget) {
  assert.ok((target.platform === "win" && target.arch === "x64") ||
    (target.platform === "linux" && target.arch === "x64") ||
    (target.platform === "macos" && target.arch === "arm64"), "Unsupported update target")
  assert.ok(target.channel === "stable" || target.channel === "canary", "Invalid update channel")
}

function downloadMetadata(value: any, file: string): UpdateFile {
  assert.ok(value && value.file === file, "Invalid update artifact filename")
  assert.ok(Number.isSafeInteger(value.downloadSize) && value.downloadSize > 0 && value.downloadSize <= UPDATE_MAX_BYTES, "Invalid update download size")
  assert.ok(typeof value.downloadSha256 === "string" && /^[a-f0-9]{64}$/.test(value.downloadSha256), "Invalid update SHA-256")
  return { file, downloadSize: value.downloadSize, downloadSha256: value.downloadSha256 }
}

function artifactMetadata(value: any, target: UpdateTarget): UpdateArtifact {
  const expected = nativeArchiveName(target)
  // Windows исторически принимает любое имя канала/платформы; Unix закреплён на точном.
  const nameOk = target.platform === "win"
    ? typeof value?.file === "string" && new RegExp(`^${target.channel}-win-x64-[a-zA-Z0-9_-]{1,120}\\.tar\\.zst$`).test(value.file)
    : value?.file === expected
  const tarOk = Number.isSafeInteger(value?.tarSize) && value.tarSize > 0 && value.tarSize <= UPDATE_MAX_BYTES &&
    typeof value?.tarSha256 === "string" && /^[a-f0-9]{64}$/.test(value.tarSha256)
  assert.ok(nameOk && tarOk, "Invalid update artifact metadata")
  return { file: value.file, downloadSize: 0, downloadSha256: "", tarSize: value.tarSize, tarSha256: value.tarSha256 }
}

/**
 * Структурная проверка подписанного v1 без платформенной политики версий.
 * Возвращает только доверенные поля: всё остальное в документе игнорируется.
 */
export function verifyUpdateManifest(bytes: Buffer, signature: Buffer, publicKey: KeyObject, expected: UpdateTarget): UpdateManifest {
  assertTarget(expected)
  const value = authenticateUpdateDocument(bytes, signature, publicKey)
  assert.ok(value.schemaVersion === 1 && value.identifier === appIdentifier &&
    value.platform === expected.platform && value.arch === expected.arch && value.channel === expected.channel,
    "Update manifest does not match the installed package")
  compareReleaseVersions(value.version, "0.0.0")
  assert.ok(typeof value.hash === "string" && /^[a-z0-9]{1,64}$/.test(value.hash), "Invalid update build hash")

  const artifact = artifactMetadata(value.artifact, expected)
  const transport = downloadMetadata(value.artifact, value.artifact?.file)
  artifact.downloadSize = transport.downloadSize
  artifact.downloadSha256 = transport.downloadSha256

  let installer: UpdateInstaller | undefined
  if (value.installer !== undefined) {
    const file = updateInstallerName(value.version)
    assert.ok(expected.platform === "win" && value.installer?.file === file && Number.isSafeInteger(value.installer.size) &&
      value.installer.size > 0 && value.installer.size <= UPDATE_INSTALLER_MAX_BYTES &&
      typeof value.installer.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.installer.sha256), "Invalid update installer metadata")
    installer = { file, size: value.installer.size, sha256: value.installer.sha256 }
  }

  let distributions: Partial<Record<LinuxDistribution, UpdateFile>> | undefined
  if (value.distributions !== undefined) {
    assert.ok(value.distributions && typeof value.distributions === "object" && !Array.isArray(value.distributions), "Invalid update distributions")
    distributions = {}
    for (const [format, file] of Object.entries(value.distributions)) {
      assert.ok(expected.platform === "linux" && Object.hasOwn(distributionSuffix, format), "Unsupported update distribution")
      const kind = format as LinuxDistribution
      distributions[kind] = downloadMetadata(file, unixDistributionName(value.version, kind))
    }
  }

  return {
    schemaVersion: 1, identifier: appIdentifier, channel: expected.channel, platform: expected.platform, arch: expected.arch,
    version: value.version, hash: value.hash, artifact, ...(installer ? { installer } : {}),
    ...(distributions ? { distributions } : {}),
  } as UpdateManifest
}

export function verifySignedUpdateManifest(bytes: Buffer, envelopeBytes: Buffer,
  trustedKeys: Readonly<Record<string, string>>, expected: UpdateTarget): UpdateManifest {
  const { signature, publicKey } = readUpdateSignature(envelopeBytes, trustedKeys)
  return verifyUpdateManifest(bytes, signature, publicKey, expected)
}

/** Политика Unix-канала: prerelease-версия допустима только в canary. */
export function verifyUnixUpdateManifest(bytes: Buffer, signature: Buffer, publicKey: KeyObject, expected: UnixUpdateTarget): UnixUpdateManifest {
  const manifest = verifyUpdateManifest(bytes, signature, publicKey, expected)
  assert.equal(isPrereleaseVersion(manifest.version), expected.channel === "canary", "Update version does not match the selected channel")
  const common = {
    schemaVersion: 1 as const, identifier: manifest.identifier, channel: expected.channel,
    version: manifest.version, hash: manifest.hash, artifact: manifest.artifact, distributions: manifest.distributions ?? {},
  }
  return expected.platform === "linux"
    ? { ...common, platform: "linux", arch: "x64" }
    : { ...common, platform: "macos", arch: "arm64" }
}

export function verifySignedUnixUpdateManifest(bytes: Buffer, envelopeBytes: Buffer,
  trustedKeys: Readonly<Record<string, string>>, expected: UnixUpdateTarget): UnixUpdateManifest {
  const { signature, publicKey } = readUpdateSignature(envelopeBytes, trustedKeys)
  return verifyUnixUpdateManifest(bytes, signature, publicKey, expected)
}