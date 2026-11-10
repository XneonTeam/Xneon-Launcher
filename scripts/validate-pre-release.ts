import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const [input, output, version = "1.0.8"] = Bun.argv.slice(2)
assert.ok(input && output && path.resolve(input) !== path.resolve(output), "Expected distinct candidate and output directories")
assert.equal(process.platform, "win32")
assert.equal(process.arch, "x64")
assert.equal(Bun.version, "1.4.4")

assert.ok(version === "1.0.8")
const name = `xneon-launcher-${version}-win-x64.exe`
const archive = "stable-win-x64-XneonLauncher.tar.zst"
const setupZip = "win-x64-XneonLauncher-Setup.zip"
const legacyManifest = "stable-win-x64-update.json"
const manifest = "stable-win-x64-update-v2.json"
const expectedFiles = [name, archive, setupZip, legacyManifest, manifest].sort()
assert.deepEqual((await readdir(input)).sort(), expectedFiles, "Unexpected or missing candidate artifacts")
for (const file of expectedFiles) {
  const info = await stat(path.join(input, file))
  const metadata = file.endsWith(".json")
  assert.ok(info.isFile() && info.size > (metadata ? 0 : 1024 ** 2) && info.size < (metadata ? 64 * 1024 : 512 * 1024 ** 2), "Unexpected artifact size: " + file)
}

function tar(file: string, entry?: string): Buffer {
  const cmd = entry ? ["tar.exe", "-xOf", path.resolve(input, file), entry] : ["tar.exe", "-tf", path.resolve(input, file)]
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" })
  assert.equal(result.exitCode, 0, "Archive inspection failed: " + file)
  return Buffer.from(result.stdout)
}

function windowsX64(bytes: Buffer): void {
  assert.ok(bytes.length > 64 && bytes.toString("ascii", 0, 2) === "MZ", "Invalid PE file")
  const offset = bytes.readUInt32LE(60)
  assert.ok(offset < bytes.length - 6 && bytes.readUInt32LE(offset) === 0x4550, "Invalid PE header")
  assert.equal(bytes.readUInt16LE(offset + 4), 0x8664, "PE must be x64")
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const read = (file: string) => readFile(path.join(input, file))
const v2 = JSON.parse(await readFile(path.join(input, manifest), "utf8"))
const v1 = JSON.parse(await readFile(path.join(input, legacyManifest), "utf8"))
for (const doc of [v1, v2]) {
  assert.equal(doc.schemaVersion, 1)
  assert.equal(doc.identifier, "com.xneonlauncher.app")
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
const credentials = bundle.match(/cloudCredentials\s*=\s*\{([\s\S]*?)\n\s*\};/)
assert.ok(credentials, "Cannot inspect bundled OAuth configuration")
const values = [...credentials[1].matchAll(/\b(?:clientId|clientSecret|deviceClientId):\s*("(?:[^"\\]|\\.)*")/g)]
assert.ok(values.length === 12 && values.every(match => JSON.parse(match[1]) === ""), "Bundled OAuth configuration must be empty")
assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:github_pat_|ghp_|sk-proj-)[a-zA-Z0-9_-]{24,}/.test(bundle), "Possible private credential in packaged app")

const installer = await read(name)
windowsX64(installer)
assert.ok(installer.includes(await read(setupZip)), "Standalone installer does not embed the validated ZIP")
const checksum = sha256(installer)
await mkdir(output)
await copyFile(path.join(input, name), path.join(output, name))
await writeFile(path.join(output, "SHA256SUMS.txt"), checksum + "  " + name + "\n", { flag: "wx" })
console.log("Validated manual Windows x64 installer:", checksum, name)
