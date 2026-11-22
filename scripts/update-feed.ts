import assert from "node:assert/strict"
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { appIdentifier } from "../electrobun/main/app-identity"
import { updatePublicKeys } from "../electrobun/main/update-public-keys"
import { inspectUnixUpdateTar, decompressUnixUpdateArchive } from "../electrobun/main/unix-update-archive"
import {
  UPDATE_MAX_BYTES, UPDATE_INSTALLER_MAX_BYTES, compatibilityManifestFileName, manifestFileName, nativeArchiveName,
  nativeBundleRoot, unixDistributionName, unixDistributions, updateInstallerName, verifySignedUpdateManifest,
  type LinuxDistribution, type UpdateFile, type UpdateManifest, type UpdateTarget,
} from "../electrobun/main/update-manifest"
import { validateNativeExecutable } from "./electrobun-artifacts"

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const read = (file: string) => readFile(file)

async function bounded(file: string, maximum = UPDATE_MAX_BYTES) {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.size > 0 && info.size <= maximum, "Invalid update feed file/size: " + path.basename(file))
  const bytes = await read(file)
  assert.equal(bytes.length, info.size, "Update feed input changed while reading")
  return bytes
}

async function checkNativeArchive(compressed: Buffer, manifest: UpdateManifest) {
  assert.equal(compressed.length, manifest.artifact.downloadSize)
  assert.equal(sha(compressed), manifest.artifact.downloadSha256)
  // Unix updater распаковывает архив в память. Hutch 0.30 пишет потоковый кадр
  // без Content Size, поэтому подписанный tarSize проверяется по факту распаковки,
  // а выход ограничен этим размером. Windows-путь не меняется.
  const tar = manifest.platform === "win"
    ? Buffer.from(Bun.zstdDecompressSync(compressed))
    : await decompressUnixUpdateArchive(compressed, manifest.artifact.tarSize)
  assert.equal(tar.length, manifest.artifact.tarSize)
  assert.equal(sha(tar), manifest.artifact.tarSha256)
  const root = nativeBundleRoot(manifest)
  const entries = inspectUnixUpdateTar(tar, root)
  const resources = manifest.platform === "macos" ? `${root}/Contents/Resources` : `${root}/Resources`
  const bin = manifest.platform === "macos" ? `${root}/Contents/MacOS` : `${root}/bin`
  const contents = (name: string) => {
    const entry = entries.find(item => item.name === name)
    assert.ok(entry?.type === "file", "Missing native updater payload entry: " + name)
    return { entry, bytes: tar.subarray(entry.offset, entry.offset + entry.size) }
  }
  const local = JSON.parse(contents(`${resources}/version.json`).bytes.toString("utf8"))
  for (const key of ["identifier", "version", "hash", "channel"] as const) {
    assert.equal(local[key], manifest[key], "Native feed identity mismatch: " + key)
  }
  for (const executable of ["bun", "launcher"]) {
    const name = manifest.platform === "win" ? executable + ".exe" : executable
    const file = contents(`${bin}/${name}`)
    // Windows не хранит POSIX execute bit; на Unix он обязателен.
    if (manifest.platform !== "win") assert.ok(file.entry.mode & 0o111, "Native updater executable has no execute bit")
    validateNativeExecutable(file.bytes, manifest.platform, manifest.arch)
  }
  // Helper собирается только для Unix-сборки; Windows payload его не содержит.
  if (manifest.platform !== "win") {
    assert.ok(contents(`${resources}/app/bun/workers/unix-update-helper.js`).bytes.length > 0, "Missing bundled Unix helper")
  }
  if (manifest.platform === "macos") {
    assert.match(contents(`${root}/Contents/Info.plist`).bytes.toString("utf8"), /<key>CFBundleIdentifier<\/key>\s*<string>org\.xneon\.launcher<\/string>/)
  }
}

function checkDistribution(bytes: Buffer, format: LinuxDistribution) {
  if (format === "deb") assert.equal(bytes.toString("ascii", 0, 21), "!<arch>\ndebian-binary")
  else if (format === "rpm") assert.equal(bytes.readUInt32BE(0), 0xedabeedb)
  else if (format === "pacman") assert.equal(bytes.readUInt32BE(0), 0x28b52ffd)
  else if (format === "tar-xz") assert.equal(bytes.toString("hex", 0, 6), "fd377a585a00")
  else { validateNativeExecutable(bytes, "linux", "x64"); assert.equal(bytes.toString("hex", 8, 11), "414902") }
}

/**
 * Собирает единый v1 из native Electrobun payload. Native `-update.json` и
 * `-update-v2.json` не изменяются: подписывается новый расширенный документ.
 */
export async function generateUpdateFeed(native: string, distributions: string | undefined, target: UpdateTarget, version: string): Promise<UpdateManifest> {
  const archive = nativeArchiveName(target)
  const current = JSON.parse((await bounded(path.join(native, compatibilityManifestFileName(target)), 64 * 1024)).toString("utf8"))
  for (const [key, expected] of Object.entries({ schemaVersion: 1, identifier: appIdentifier, ...target, version })) {
    assert.equal(current[key], expected, "Native update identity mismatch: " + key)
  }
  assert.match(current.hash, /^[a-z0-9]{1,64}$/)
  assert.equal(current.artifact?.file, archive)
  assert.ok(Number.isSafeInteger(current.artifact.tarSize) && current.artifact.tarSize > 0 && current.artifact.tarSize <= UPDATE_MAX_BYTES)
  assert.match(current.artifact.tarSha256, /^[a-f0-9]{64}$/)

  const bytes = await bounded(path.join(native, archive))
  const manifest: UpdateManifest = {
    schemaVersion: 1, identifier: appIdentifier, ...target, version, hash: current.hash,
    artifact: { file: archive, downloadSize: bytes.length, downloadSha256: sha(bytes), tarSize: current.artifact.tarSize, tarSha256: current.artifact.tarSha256 },
  }
  await checkNativeArchive(bytes, manifest)

  if (target.platform === "linux") {
    assert.ok(distributions, "Linux feed requires all native distribution formats")
    manifest.distributions = {}
    for (const format of unixDistributions) {
      const file = unixDistributionName(version, format), data = await bounded(path.join(distributions, file))
      checkDistribution(data, format)
      manifest.distributions[format] = { file, downloadSize: data.length, downloadSha256: sha(data) }
    }
  } else {
    assert.ok(!distributions, "Only Linux feeds include distribution packages")
  }

  if (target.platform === "win") {
    // NSIS-установщик того же канала: смена канала в приложении ставит его поверх.
    const name = updateInstallerName(version), file = path.join(native, name)
    try {
      const info = await stat(file)
      assert.ok(info.isFile() && info.size > 1024 ** 2 && info.size <= UPDATE_INSTALLER_MAX_BYTES, "Invalid installer size")
      manifest.installer = { file: name, size: info.size, sha256: sha(await read(file)) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return manifest
}

/** Имена, которые обязаны появиться в подписанном каталоге одного target. */
export function updateFeedFiles(manifest: UpdateManifest, target: UpdateTarget) {
  const names = [manifestFileName(target), compatibilityManifestFileName(target)]
  return [...names, ...names.map(name => name + ".sig"), manifest.artifact.file,
    ...Object.values(manifest.distributions ?? {}).map(file => file.file),
    ...(manifest.installer ? [manifest.installer.file] : [])].sort()
}

export async function signUpdateFeed(native: string, distributions: string | undefined, output: string, target: UpdateTarget, version: string,
  keyId: string, privateKey: KeyObject | string, keys: Readonly<Record<string, string>> = updatePublicKeys) {
  assert.ok(path.resolve(output) !== path.resolve(native) && (!distributions || path.resolve(output) !== path.resolve(distributions)), "Use a new signed update output directory")
  assert.ok(Object.hasOwn(keys, keyId), "Unknown update signing key")
  const key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey
  assert.equal(key.asymmetricKeyType, "ed25519", "Invalid update key type")
  assert.equal(createPublicKey(key).export({ format: "pem", type: "spki" }).toString(),
    createPublicKey(keys[keyId]).export({ format: "pem", type: "spki" }).toString(), "Update signing key does not match pinned trust")

  const manifest = await generateUpdateFeed(native, distributions, target, version)
  const bytes = Buffer.from(JSON.stringify(manifest))
  const envelope = Buffer.from(JSON.stringify({ keyId, signature: sign(null, bytes, key).toString("base64") }))
  verifySignedUpdateManifest(bytes, envelope, keys, target)

  await mkdir(output)
  const canonicalName = manifestFileName(target), compatibilityName = compatibilityManifestFileName(target)
  // Оба имени содержат байт-идентичный документ: Windows-клиенты читают v2, Unix — канонический.
  for (const name of [canonicalName, compatibilityName]) {
    await writeFile(path.join(output, name), bytes, { flag: "wx" })
    await writeFile(path.join(output, name + ".sig"), envelope, { flag: "wx" })
  }
  const sources: Array<[string, string]> = [[native, manifest.artifact.file]]
  for (const file of Object.values(manifest.distributions ?? {})) sources.push([distributions!, file.file])
  if (manifest.installer) sources.push([native, manifest.installer.file])
  for (const [root, file] of sources) await copyFile(path.join(root, file), path.join(output, file), constants.COPYFILE_EXCL)
  await verifyUpdateFeed(output, target, version, keys)
  return manifest
}

export type VerifiedUpdateFeed = { manifest: UpdateManifest; files: string[] }

/** Проверяет подпись, оба имени манифеста и transport bytes всех файлов target. */
export async function verifyUpdateFeed(directory: string, target: UpdateTarget, version: string,
  keys: Readonly<Record<string, string>> = updatePublicKeys,
  options: { strictListing?: boolean } = {}): Promise<VerifiedUpdateFeed> {
  const canonicalName = manifestFileName(target), compatibilityName = compatibilityManifestFileName(target)
  const [canonical, canonicalSignature, compatibility, compatibilitySignature] = await Promise.all(
    [canonicalName, canonicalName + ".sig", compatibilityName, compatibilityName + ".sig"]
      .map(name => bounded(path.join(directory, name), name.endsWith(".sig") ? 2048 : 64 * 1024)),
  )
  assert.ok(canonical.equals(compatibility), "Update manifest copies must be byte-identical")
  assert.ok(canonicalSignature.equals(compatibilitySignature), "Update signature copies must be byte-identical")
  const manifest = verifySignedUpdateManifest(canonical, canonicalSignature, keys, target)
  assert.equal(manifest.version, version, "Unexpected signed update version")
  if (target.platform === "linux") {
    assert.deepEqual(Object.keys(manifest.distributions ?? {}).sort(), [...unixDistributions].sort(), "Incomplete signed Linux distributions")
  } else assert.ok(!manifest.distributions, "Unexpected update distributions")
  if (target.platform === "win") assert.ok(manifest.installer, "Signed manifest must describe the installer")
  else assert.ok(!manifest.installer, "Unexpected update installer")

  const artifact = manifest.artifact
  const compressed = await bounded(path.join(directory, artifact.file))
  assert.ok(compressed.length === artifact.downloadSize && sha(compressed) === artifact.downloadSha256, "Update feed transport integrity mismatch")
  await checkNativeArchive(compressed, manifest)
  for (const [format, file] of Object.entries(manifest.distributions ?? {}) as Array<[LinuxDistribution, UpdateFile]>) {
    const bytes = await bounded(path.join(directory, file.file))
    assert.ok(bytes.length === file.downloadSize && sha(bytes) === file.downloadSha256, "Update distribution transport integrity mismatch")
    checkDistribution(bytes, format)
  }
  if (manifest.installer) {
    const file = path.join(directory, manifest.installer.file)
    const bytes = await bounded(file, UPDATE_INSTALLER_MAX_BYTES)
    assert.ok(bytes.length === manifest.installer.size && sha(bytes) === manifest.installer.sha256, "Installer transport integrity mismatch")
  }
  const files = updateFeedFiles(manifest, target)
  const present = (await readdir(directory)).sort()
  // SHA256SUMS.txt пишет общий publication-verifier; при первой проверке его ещё нет.
  const expectedFiles = [...files, ...(present.includes("SHA256SUMS.txt") ? ["SHA256SUMS.txt"] : [])].sort()
  // Несколько target в одном каталоге: итоговый allowlist сверяет
  // `verifySignedUpdateFeed` объединением целей. Здесь достаточно убедиться,
  // что файлы этой цели на месте и совпадают с подписью.
  if (options.strictListing !== false) assert.deepEqual(present, expectedFiles, "Unexpected signed update feed files")
  return { manifest, files }
}