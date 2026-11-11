import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { validateBundleCredentials, windowsInstaller, windowsX64 } from "./windows-candidate-validation"
import { appIdentifier } from "../electrobun/main/app-identity"

const [input, output, version = "1.0.8"] = Bun.argv.slice(2)
assert.ok(input && output && path.resolve(input) !== path.resolve(output), "Expected distinct candidate and output directories")
assert.equal(process.platform, "win32")
assert.equal(process.arch, "x64")
assert.equal(Bun.version, "1.4.4")

assert.ok(version === "1.0.8")
const name = `xneon-launcher-${version}-win-x64.exe`
// Распакованное приложение — zip-таргет electron-builder.
const unpackedName = `xneon-launcher-${version}-win-x64.zip`
// Метафайлы electron-builder: карты блоков и latest.yml.
const installerMap = name + ".blockmap"
const unpackedMap = unpackedName + ".blockmap"
const latestName = "latest.yml"
const archive = "stable-win-x64-XneonLauncher.tar.zst"
const setupZip = "win-x64-XneonLauncher-Setup.zip"
const legacyManifest = "stable-win-x64-update.json"
const manifest = "stable-win-x64-update-v2.json"
const expectedFiles = [name, unpackedName, installerMap, unpackedMap, latestName, archive, setupZip, legacyManifest, manifest].sort()
assert.deepEqual((await readdir(input)).sort(), expectedFiles, "Unexpected or missing candidate artifacts")
for (const file of expectedFiles) {
  const info = await stat(path.join(input, file))
  // .json / .yml / .blockmap — небольшие метафайлы, остальное — артефакты.
  const metadata = /\.(?:json|yml|blockmap)$/.test(file)
  assert.ok(info.isFile() && info.size > (metadata ? 0 : 1024 ** 2) && info.size < (metadata ? 512 * 1024 : 512 * 1024 ** 2), "Unexpected artifact size: " + file)
}

function tar(file: string, entry?: string): Buffer {
  const cmd = entry ? ["tar.exe", "-xOf", path.resolve(input, file), entry] : ["tar.exe", "-tf", path.resolve(input, file)]
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" })
  assert.equal(result.exitCode, 0, "Archive inspection failed: " + file)
  return Buffer.from(result.stdout)
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const read = (file: string) => readFile(path.join(input, file))
// Синхронное чтение нужно внутри проверок, которые не объявлены async.
const readBytes = (file: string) => readFileSync(path.join(input, file))
const sha512 = (bytes: Buffer) => createHash("sha512").update(bytes).digest("base64")

/**
 * Разбор latest.yml в том виде, в каком его пишет electron-builder (и мы):
 * version, files[] (url/sha512/size/blockMapSize), path, sha512, releaseDate.
 * Полноценный YAML-парсер здесь не нужен, формат фиксированный.
 */
function parseLatestYml(text: string) {
  const document: { version: string; files: { url: string; sha512: string; size: number; blockMapSize?: number }[]; path: string; sha512: string; releaseDate: string } = {
    version: "", files: [], path: "", sha512: "", releaseDate: "",
  }
  let current: (typeof document.files)[number] | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const line = raw.trim()
    const split = line.startsWith("- ") ? line.slice(2) : line
    const separator = split.indexOf(":")
    const key = split.slice(0, separator).trim()
    const value = split.slice(separator + 1).trim().replace(/^'(.*)'$/, "$1")
    if (raw.startsWith("  - ")) {
      current = { url: value, sha512: "", size: 0 }
      document.files.push(current)
    } else if (raw.startsWith("    ") && current) {
      if (key === "url") current.url = value
      else if (key === "sha512") current.sha512 = value
      else if (key === "size") current.size = Number(value)
      else if (key === "blockMapSize") current.blockMapSize = Number(value)
    } else if (!raw.startsWith(" ") && separator > 0) {
      if (key === "version") document.version = value
      else if (key === "path") document.path = value
      else if (key === "sha512") document.sha512 = value
      else if (key === "releaseDate") document.releaseDate = value
    }
  }
  return document
}
const v2 = JSON.parse(await readFile(path.join(input, manifest), "utf8"))
const v1 = JSON.parse(await readFile(path.join(input, legacyManifest), "utf8"))
for (const doc of [v1, v2]) {
  assert.equal(doc.schemaVersion, 1)
  assert.equal(doc.identifier, appIdentifier)
  assert.equal(doc.version, version)
  assert.equal(doc.channel, "stable")
  assert.equal(doc.platform, "win")
  assert.equal(doc.arch, "x64")
  assert.equal(doc.artifact?.file, archive)
  assert.match(doc.hash, /^[a-z0-9]+$/)
}
assert.equal(v1.hash, v2.hash)
const archiveBytes = await read(archive)
assert.ok(Number.isSafeInteger(v2.artifact.tarSize) && v2.artifact.tarSize > 0 && v2.artifact.tarSize < 512 * 1024 ** 2)
const rawTar = Buffer.from(Bun.zstdDecompressSync(archiveBytes))
assert.equal(v2.artifact.tarSize, rawTar.length)
assert.equal(v2.artifact.tarSha256, sha256(rawTar))

const zipMembers = tar(setupZip).toString().trim().split(/\r?\n/).sort()
assert.deepEqual(zipMembers, [".installer/Xneon Launcher-Setup.metadata.json", ".installer/Xneon Launcher-Setup.tar.zst", "Xneon Launcher-Setup.exe"].sort())
assert.equal(sha256(tar(setupZip, ".installer/Xneon Launcher-Setup.tar.zst")), sha256(archiveBytes))
const setup = JSON.parse(tar(setupZip, ".installer/Xneon Launcher-Setup.metadata.json").toString())
assert.equal(setup.name, "Xneon Launcher")
assert.equal(setup.identifier, v2.identifier)
assert.equal(setup.channel, v2.channel)
assert.equal(setup.hash, v2.hash)
windowsX64(tar(setupZip, "Xneon Launcher-Setup.exe"))

const entries = tar(archive).toString().trim().split(/\r?\n/)
const blocked = /(?:^|\/)(?:\.env(?:[./]|$)|\.npmrc(?:\/|$)|node_modules(?:\/|$)|electron(?:\.exe|\/|$)|app\.asar(?:\.unpacked)?(?:\/|$)|credentials(?:\.generated)?\.(?:ts|json)(?:$|\/))|\.(?:db(?:-wal|-shm)?|sqlite3?|pdb|map|log|tmp|bak)$/i
assert.equal(new Set(entries).size, entries.length, "Duplicate package entries")
for (const entry of entries) {
  assert.ok(entry.startsWith("XneonLauncher/") && !/(?:^|\/)\.\.(?:\/|$)|[\\:\u0000-\u001f]/.test(entry) && !blocked.test(entry), "Unexpected member in packaged application")
}
const prefix = "XneonLauncher/Resources/"
const local = JSON.parse(tar(archive, prefix + "version.json").toString())
assert.equal(local.displayName, "Xneon Launcher")
assert.equal(local.identifier, v2.identifier)
assert.equal(local.version, v2.version)
assert.equal(local.channel, v2.channel)
assert.equal(local.hash, v2.hash)
windowsX64(tar(archive, "XneonLauncher/bin/launcher.exe"))
windowsX64(tar(archive, "XneonLauncher/bin/bun.exe"))
const bundle = tar(archive, prefix + "app/bun/index.js").toString()
validateBundleCredentials(bundle)

const installer = await read(name)
// NSIS-установщик сжимает полезную нагрузку целиком (solid lzma), поэтому
// вложенного Setup-ZIP внутри уже нет: совпадение содержимого проверяется по
// исходному архиву канала, а от установщика требуется быть настоящим NSIS.
windowsInstaller(installer)

// Распакованное приложение: то же содержимое бандла, что кладёт установщик,
// но без установки — корень архива это bin\ и Resources\.
const unpackedEntries = tar(unpackedName).toString().trim().split(/\r?\n/).filter(Boolean)
assert.ok(unpackedEntries.every(entry => entry.startsWith("bin/") || entry.startsWith("Resources/")), "Unexpected member in unpacked archive")
assert.ok(unpackedEntries.includes("bin/launcher.exe") && unpackedEntries.includes("Resources/version.json"), "Unpacked archive is incomplete")
const unpackedIdentity = JSON.parse(tar(unpackedName, "Resources/version.json").toString())
assert.equal(unpackedIdentity.identifier, v2.identifier)
assert.equal(unpackedIdentity.version, v2.version)
assert.equal(unpackedIdentity.channel, v2.channel)
assert.equal(unpackedIdentity.hash, v2.hash)
windowsX64(tar(unpackedName, "bin/launcher.exe"))
windowsX64(tar(unpackedName, "bin/bun.exe"))
const unpacked = await read(unpackedName)
assert.ok(unpacked.length > 1024 ** 2 && unpacked.length < 512 * 1024 ** 2, "Unexpected unpacked archive size")

// ---------------------------------------------------------------------------
// Метафайлы electron-builder: .blockmap (v2, gzip+JSON) и latest.yml.
// Наш лаунчер их не использует, но набор файлов релиза совпадает с Electron.
// ---------------------------------------------------------------------------
function inspectBlockMap(file: string, artifact: Buffer) {
  const bytes = readBytes(file)
  const document = JSON.parse(Buffer.from(Bun.gunzipSync(bytes)).toString())
  assert.equal(document.version, "2")
  assert.equal(document.files.length, 1)
  const map = document.files[0]
  assert.equal(map.name, "file")
  assert.equal(map.offset, 0)
  assert.ok(Array.isArray(map.sizes) && map.sizes.length > 0, "Block map has no blocks")
  assert.equal(map.checksums.length, map.sizes.length, "Block map checksums do not match blocks")
  assert.equal(map.sizes.reduce((sum: number, size: number) => sum + size, 0), artifact.length, "Block map does not cover the artifact")
  assert.ok(map.sizes.every((size: number) => size >= 0 && size <= 32 * 1024), "Unexpected block size")
  assert.ok(map.checksums.every((checksum: string) => Buffer.from(checksum, "base64").length === 18), "Unexpected block checksum")
  return bytes.length
}

const installerMapSize = inspectBlockMap(installerMap, installer)
const unpackedMapSize = inspectBlockMap(unpackedMap, unpacked)

// latest.yml — ровно тот формат, что пишет electron-builder.
const latest = parseLatestYml(readBytes(latestName).toString())
assert.equal(latest.version, version)
assert.equal(latest.path, name)
assert.equal(latest.sha512, sha512(installer))
assert.deepEqual(latest.files.map(file => file.url), [name, unpackedName])
assert.deepEqual(latest.files.map(file => file.size), [installer.length, unpacked.length])
assert.deepEqual(latest.files.map(file => file.sha512), [sha512(installer), sha512(unpacked)])
assert.deepEqual(latest.files.map(file => file.blockMapSize), [installerMapSize, unpackedMapSize])
assert.ok(!Number.isNaN(Date.parse(latest.releaseDate)), "latest.yml has no release date")

// Проверенная выдача: установщик, распакованное приложение и метафайлы
// electron-builder рядом с ними — ровно тот набор, что публикуется.
const verified = [name, unpackedName, installerMap, unpackedMap, latestName]
await mkdir(output)
for (const file of verified) await copyFile(path.join(input, file), path.join(output, file))
const lines = await Promise.all(verified.map(async file => sha256(await readFile(path.join(output, file))) + "  " + file))
await writeFile(path.join(output, "SHA256SUMS.txt"), lines.join("\n") + "\n", { flag: "wx" })
console.log("Validated Windows x64 distribution files:\n" + lines.join("\n"))
