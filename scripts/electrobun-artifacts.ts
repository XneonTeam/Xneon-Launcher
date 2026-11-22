import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import packageJson from "../package.json"
import { appIdentifier } from "../electrobun/main/app-identity"
import { APP_NAME } from "../lib/app-meta"
import { expectedUpdateBaseUrl, updatePublicKeys } from "../electrobun/main/update-public-keys"
import { listArchiveEntries, readArchiveEntry } from "../packages/xnlc-archives/src/index"
import { validateBundleCredentials, windowsInstaller, windowsX64 } from "./windows-candidate-validation"
import { checksumText } from "./artifact-checksums"
import { nativeTarExecutable } from "./native-tar"

type Options = {
  platform: "win" | "macos" | "linux"
  arch: "x64" | "arm64"
  channel: "stable" | "canary"
  version?: string
  nsis?: boolean
  requireChecksums?: boolean
}

function identity(options: Options) {
  assert.ok(["win", "macos", "linux"].includes(options.platform), "Invalid artifact platform")
  assert.ok(["x64", "arm64"].includes(options.arch), "Invalid artifact architecture")
  assert.ok(["stable", "canary"].includes(options.channel), "Invalid artifact channel")
  assert.ok(!options.nsis || options.platform === "win" && options.arch === "x64", "NSIS requires Windows x64")
  const version = options.version ?? packageJson.version
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "Invalid artifact version")
  const suffix = options.channel === "stable" ? "" : "-" + options.channel
  const app = "XneonLauncher" + suffix
  const prefix = `${options.channel}-${options.platform}-${options.arch}`
  const installerPrefix = options.channel === "stable" ? `${options.platform}-${options.arch}` : prefix
  const installer = options.platform === "win" ? `${installerPrefix}-XneonLauncher-Setup${suffix}.zip`
    : options.platform === "macos" ? `${installerPrefix}-${app}.dmg` : `${installerPrefix}-${app}-Setup.tar.gz`
  return { version, app, prefix, installer, archive: `${prefix}-${app}${options.platform === "macos" ? ".app" : ""}.tar.zst`, nsis: `xneon-launcher-${version}-win-x64.exe` }
}

/** Имена штатного Hutch 0.30 / Electrobun 2.0; содержимое не переупаковывается. */
export function nativeArtifactNames(options: Options): string[] {
  const value = identity(options)
  return [`${value.prefix}-update.json`, `${value.prefix}-update-v2.json`, value.archive, value.installer, ...(options.nsis ? [value.nsis] : [])]
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const forbidden = /(?:^|\/)(?:\.env(?:[./]|$)|\.npmrc(?:\/|$)|\.DS_Store(?:\/|$)|node_modules(?:\/|$)|electron(?:\.exe|\/|$)|app\.asar(?:\.unpacked)?(?:\/|$)|credentials(?:\.generated)?\.(?:ts|json)(?:$|\/))|\.(?:db(?:-wal|-shm)?|sqlite3?|pdb|map|log|tmp|bak)$/i

export function validateNativeExecutable(bytes: Buffer, platform: Options["platform"], arch: Options["arch"]): void {
  if (platform === "win") { assert.equal(arch, "x64"); windowsX64(bytes); return }
  assert.ok(bytes.length >= 32, "Truncated native executable")
  if (platform === "macos") {
    assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, "Expected a 64-bit Mach-O executable")
    assert.equal(bytes.readUInt32LE(4), arch === "arm64" ? 0x0100000c : 0x01000007, "Unexpected Mach-O architecture")
  } else {
    assert.equal(bytes.subarray(0, 4).toString("hex"), "7f454c46", "Expected an ELF executable")
    assert.equal(bytes[4], 2, "Expected ELF64")
    assert.equal(bytes[5], 1, "Expected little-endian ELF")
    assert.equal(bytes.readUInt16LE(18), arch === "arm64" ? 183 : 62, "Unexpected ELF architecture")
  }
}

/** Проверяет native payload, установщик и transport hashes без смены имён/формата. */
export async function inspectElectrobunRelease(directory: string, options: Options) {
  const value = identity(options)
  const limit = options.platform === "win" ? 512 * 1024 ** 2 : 2 * 1024 ** 3
  const names = await readdir(directory)
  const patches = names.filter(name => new RegExp(`^${value.prefix}-[a-z0-9]+\\.patch$`).test(name))
  const files = [...nativeArtifactNames(options), ...patches].sort()
  const hasChecksums = names.includes("SHA256SUMS.txt")
  const sdkChecksum = `${value.prefix}-checksum.json`
  const hasSdkChecksum = names.includes(sdkChecksum)
  assert.ok(!options.requireChecksums || hasChecksums, "Missing transport checksums")
  assert.deepEqual(names.sort(), [...files, ...(hasChecksums ? ["SHA256SUMS.txt"] : []), ...(hasSdkChecksum ? [sdkChecksum] : [])].sort(), "Unexpected or missing native artifacts")
  for (const name of [...files, ...(hasChecksums ? ["SHA256SUMS.txt"] : [])]) {
    const info = await lstat(path.join(directory, name))
    const metadata = /\.json$|^SHA256SUMS\.txt$/.test(name)
    const maximum = metadata ? 512 * 1024 : limit
    // Прежний Windows sanity threshold сохранён; native delta может быть маленькой.
    const minimum = options.platform === "win" && !metadata && !name.endsWith(".patch") ? 1024 ** 2 : 0
    assert.ok(info.isFile() && info.size > minimum && info.size < maximum, "Invalid artifact file/size: " + name)
  }
  if (hasChecksums) assert.equal(await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8"), await checksumText(directory, files), "Transport checksum mismatch")
  const read = (name: string) => readFile(path.join(directory, name))
  const manifests = await Promise.all(["-update.json", "-update-v2.json"].map(async suffix => JSON.parse((await read(value.prefix + suffix)).toString())))
  for (const manifest of manifests) {
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.identifier, appIdentifier)
    assert.equal(manifest.version, value.version)
    assert.equal(manifest.channel, options.channel)
    assert.equal(manifest.platform, options.platform)
    assert.equal(manifest.arch, options.arch)
    assert.equal(manifest.artifact?.file, value.archive)
    assert.match(manifest.hash, /^[a-z0-9]+$/)
  }
  const [legacy, current] = manifests
  if (hasSdkChecksum) {
    const checksum = JSON.parse((await read(sdkChecksum)).toString())
    assert.deepEqual(checksum, { hash: current.hash, tarSha256: current.artifact.tarSha256, tarSize: current.artifact.tarSize }, "Hutch checksum differs from compatible v2 metadata")
  }
  assert.equal(legacy.hash, current.hash)
  assert.ok(Number.isSafeInteger(current.artifact.tarSize) && current.artifact.tarSize > 0 && current.artifact.tarSize <= limit, "Invalid native tar size")
  assert.match(current.artifact.tarSha256, /^[a-f0-9]{64}$/)
  const compressed = await read(value.archive)
  const raw = Buffer.from(Bun.zstdDecompressSync(compressed))
  assert.equal(raw.length, current.artifact.tarSize, "Native tar size integrity mismatch")
  assert.equal(sha256(raw), current.artifact.tarSha256, "Native tar SHA-256 integrity mismatch")
  await mkdir(path.resolve(".tmp"), { recursive: true })
  const scratch = await mkdtemp(path.resolve(".tmp/electrobun-artifacts-"))
  const tarFile = path.join(scratch, "application.tar")
  const tar = (file: string, entry?: string) => {
    const result = spawnSync(nativeTarExecutable(), entry ? ["-xOf", file, entry] : ["-tf", file], { maxBuffer: limit })
    assert.equal(result.status, 0, "Native archive inspection failed: " + (result.stderr?.toString() ?? ""))
    return Buffer.from(result.stdout)
  }
  try {
    await writeFile(tarFile, raw)
    const members = tar(tarFile).toString().trim().split(/\r?\n/)
    assert.equal(new Set(members).size, members.length, "Duplicate native archive entries")
    // macOS сохраняет display name с пробелом в .app; имя tar.zst SDK нормализует.
    const bundle = options.platform === "macos" ? APP_NAME + (options.channel === "stable" ? "" : "-" + options.channel) + ".app" : value.app
    for (const entry of members) assert.ok((entry === bundle || entry.startsWith(bundle + "/")) && !/(?:^|\/)\.\.(?:\/|$)|[\\:\u0000-\u001f]/.test(entry) && !forbidden.test(entry), "Forbidden native bundle entry: " + entry)
    const resources = bundle + (options.platform === "macos" ? "/Contents/Resources/" : "/Resources/")
    const bin = bundle + (options.platform === "macos" ? "/Contents/MacOS/" : "/bin/")
    const local = JSON.parse(tar(tarFile, resources + "version.json").toString())
    assert.equal(local.displayName, APP_NAME)
    for (const key of ["identifier", "version", "channel", "hash"]) assert.equal(local[key], current[key], "Unexpected bundled " + key)
    assert.equal(local.baseUrl, options.platform === "win" ? expectedUpdateBaseUrl(options.channel as "stable" | "canary") : "", "Unexpected native update feed")
    for (const executable of ["launcher", "bun"]) validateNativeExecutable(tar(tarFile, bin + executable + (options.platform === "win" ? ".exe" : "")), options.platform, options.arch)
    // 2.0.7 ищет updater в native core рядом с launcher (updaterNative.ts: exeDir), без библиотеки обновление не стартует.
    const core = options.platform === "win" ? "ElectrobunCore.dll" : "libElectrobunCore." + (options.platform === "macos" ? "dylib" : "so")
    validateNativeExecutable(tar(tarFile, bin + core), options.platform, options.arch)
    const main = tar(tarFile, resources + "app/bun/index.js").toString()
    validateBundleCredentials(main)
    if (options.platform === "win") {
      const keys = Object.entries(updatePublicKeys)
      assert.ok(keys.length && keys.every(([id, pem]) => main.includes(id) && main.includes(pem.split("\n")[1])), "Trusted update keys missing from bundle")
      assert.ok(main.includes("MAINER4IK/Xneon-Launcher-bun"), "Personal update feed missing")
      assert.ok(!main.includes("XNLC_UPDATE_PRIVATE_KEY"), "Signing code must not be bundled")
      const zipFile = path.join(directory, value.installer)
      const entries = (await listArchiveEntries(zipFile)).filter(entry => !entry.directory).map(entry => entry.name).sort()
      const stem = APP_NAME + "-Setup" + (options.channel === "stable" ? "" : "-" + options.channel)
      assert.deepEqual(entries, [stem + ".exe", `.installer/${stem}.metadata.json`, `.installer/${stem}.tar.zst`].sort(), "Unexpected native Setup ZIP layout")
      const entry = async (name: string) => {
        const bytes = await readArchiveEntry(zipFile, name, { maxEntrySize: limit, maxTotalSize: limit })
        assert.ok(bytes, "Missing Setup member: " + name)
        return bytes
      }
      assert.equal(sha256(await entry(`.installer/${stem}.tar.zst`)), sha256(compressed), "Setup payload differs from update archive")
      const setup = JSON.parse((await entry(`.installer/${stem}.metadata.json`)).toString())
      assert.equal(setup.name, APP_NAME)
      for (const key of ["identifier", "channel", "hash"]) assert.equal(setup[key], current[key], "Unexpected Setup " + key)
      windowsX64(await entry(stem + ".exe"))
      if (options.nsis) windowsInstaller(await read(value.nsis))
    } else if (options.platform === "linux") {
      const setupTar = path.join(scratch, "setup.tar")
      await writeFile(setupTar, Bun.gunzipSync(await read(value.installer)))
      const entries = tar(setupTar).toString().trim().split(/\r?\n/).map(entry => entry.replace(/^\.\//, "").replace(/\/$/, "")).filter(Boolean)
      assert.deepEqual(entries.sort(), ["README.txt", "installer"], "Unexpected native Linux Setup layout")
      const installer = tar(setupTar, "./installer")
      validateNativeExecutable(installer, options.platform, options.arch)
      const metadataMarker = Buffer.from("ELECTROBUN_METADATA_V1"), archiveMarker = Buffer.from("ELECTROBUN_ARCHIVE_V1")
      const archiveOffset = installer.length - compressed.length - archiveMarker.length
      assert.ok(archiveOffset > 0 && installer.subarray(archiveOffset, archiveOffset + archiveMarker.length).equals(archiveMarker), "Native Linux installer marker missing")
      const metadataOffset = installer.lastIndexOf(metadataMarker, archiveOffset - metadataMarker.length)
      assert.ok(metadataOffset > 0 && archiveOffset - metadataOffset < 512 * 1024, "Native Linux installer metadata missing")
      const setup = JSON.parse(installer.subarray(metadataOffset + metadataMarker.length, archiveOffset).toString())
      assert.equal(setup.name, APP_NAME)
      for (const key of ["identifier", "channel", "hash"]) assert.equal(setup[key], current[key], "Unexpected Linux Setup " + key)
      assert.equal(sha256(installer.subarray(-compressed.length)), sha256(compressed), "Native Linux installer payload differs")
    }
  } finally { await rm(scratch, { recursive: true, force: true }) }
  return { files, manifest: current }
}

/** Release staging оставляет native bytes/имена неизменными; добавляет только SHA256SUMS. */
export async function stageElectrobunRelease(input: string, output: string, options: Options) {
  assert.notEqual(path.resolve(input), path.resolve(output), "Expected distinct release directories")
  const inspected = await inspectElectrobunRelease(input, options)
  await mkdir(output)
  for (const file of inspected.files) await copyFile(path.join(input, file), path.join(output, file))
  await writeFile(path.join(output, "SHA256SUMS.txt"), await checksumText(output, inspected.files), { flag: "wx" })
  return inspected
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const nsis = args.includes("--nsis")
  const [action, input, ...rest] = args.filter(arg => arg !== "--nsis")
  assert.ok(["check", "verify", "stage"].includes(action) && input, "Usage: electrobun-artifacts <check|verify> <input> <platform> <arch> <channel> [version] [--nsis], or stage <input> <output> ...")
  assert.ok(action === "stage" ? rest.length === 4 || rest.length === 5 : rest.length === 3 || rest.length === 4, "Unexpected artifact validator arguments")
  const [output, platform, arch, channel, version] = action === "stage" ? rest : [undefined, ...rest]
  const options = { platform, arch, channel, version, nsis, requireChecksums: action === "verify" } as Options
  const checked = action === "stage" ? await stageElectrobunRelease(input, output!, options) : await inspectElectrobunRelease(input, options)
  console.log("Verified native Electrobun artifacts:\n" + checked.files.join("\n"))
}
