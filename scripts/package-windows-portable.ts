import assert from "node:assert/strict"
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import { portableAppIdentifier } from "../electrobun/main/app-identity"
import { validateBundleCredentials, windowsProductIdentity, windowsX64 } from "./windows-candidate-validation"
import { checksumText } from "./artifact-checksums"

const [destination] = Bun.argv.slice(2)
assert.ok(destination && Bun.argv.length === 3 && process.platform === "win32" && process.arch === "x64", "Usage: package-windows-portable <new-output>")
assert.equal(Bun.version, "1.4.4")
const output = path.resolve(destination)
const root = path.resolve("build-electrobun/portable/dev-win-x64/XneonLauncher-dev")
const staging = path.join(output, "portable-stage")
const version = packageJson.version
const name = `xneon-launcher-${version}-win-x64`
const zip = path.join(output, name + "-portable.zip")
await mkdir(output)
await mkdir(staging)
for (const directory of ["bin", "Resources"]) {
  await cp(path.join(root, directory), path.join(staging, directory), {
    recursive: true,
    filter: source => path.relative(root, source).split(path.sep).join("/") !== "Resources/uninstall",
  })
}

await writeFile(path.join(staging, "README.txt"), [
  "Xneon Launcher " + version + " | Windows x64 Portable",
  "",
  "VM test candidate. Extract all files to a new writable folder.",
  "Windows 11 x64 and the Microsoft Edge WebView2 Runtime are required.",
  "Open bin\\launcher.exe. Keep bin and Resources together.",
  "Exit the application before moving the folder or replacing its files.",
  "Launcher and WebView2 data are stored in PortableProfile beside bin.",
  "Keep PortableProfile when replacing the program with a later portable build.",
  "In-app updates and storage relocation are disabled in this build.",
  "Windows-protected credentials may need to be entered again on another PC.",
  "",
].join("\r\n"))

function tar(args: string[]): Buffer {
  const result = Bun.spawnSync(["tar.exe", ...args], { stderr: "inherit" })
  assert.equal(result.exitCode, 0, "Portable ZIP operation failed")
  return Buffer.from(result.stdout)
}

const entries = await readdir(staging, { recursive: true, withFileTypes: true })
for (const entry of entries) assert.ok(entry.isDirectory() || entry.isFile(), "Portable ZIP cannot contain links")
const files = entries.filter(entry => entry.isFile()).map(entry =>
  path.relative(staging, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
const blocked = /(?:^|\/)(?:\.env(?:[./]|$)|\.npmrc(?:$|\/)|node_modules(?:$|\/)|uninstall(?:$|\/)|PortableProfile(?:$|\/))|\.(?:db(?:-wal|-shm)?|sqlite3?|pdb|map|log|tmp|bak|pem|pfx|key)$/i
assert.equal(new Set(files.map(file => file.toLowerCase())).size, files.length)
for (const file of files) assert.ok(!blocked.test(file) && !/[\\:\u0000-\u001f]/.test(file), "Forbidden portable entry: " + file)
tar(["-a", "-cf", zip, "-C", staging, "bin", "Resources", "README.txt"])
const archivedFiles = tar(["-tf", zip]).toString().trim().split(/\r?\n/).filter(entry => !entry.endsWith("/"))
assert.deepEqual(archivedFiles.sort(), files.sort(), "Unexpected portable ZIP entries")
const readEntry = (name: string) => tar(["-xOf", zip, name])

const identity = JSON.parse(readEntry("Resources/version.json").toString())
assert.equal(identity.version, version)
assert.equal(identity.channel, "dev")
assert.equal(identity.identifier, portableAppIdentifier)
assert.equal(identity.baseUrl, "")
const build = JSON.parse(readEntry("Resources/build.json").toString())
assert.equal(build.runtime.appUserModelId, identity.identifier)
assert.equal(build.electrobunVersion, "2.0.6")
assert.equal(build.runtimeVersions.bun, "1.4.4")
for (const file of files.filter(file => /\.(?:exe|dll)$/i.test(file))) windowsX64(readEntry(file))
for (const file of ["bin/launcher.exe", "bin/bun.exe"].map(file => path.join(staging, file))) {
  windowsProductIdentity(file, version)
}
const bundle = readEntry("Resources/app/bun/index.js").toString()
assert.ok(bundle.includes("PortableProfile must be a local directory") && bundle.includes("Portable builds require manual updates."), "Portable runtime guards are missing")
validateBundleCredentials(bundle)

// PortableProfile — отдельная функция приложения, а не переупаковка обычного релиза.
// NSIS и штатные артефакты SDK проверяются/публикуются независимо.
const hashes = await checksumText(output, [path.basename(zip)])
await writeFile(path.join(output, "SHA256SUMS.txt"), hashes, { flag: "wx" })
console.log(hashes.trimEnd())
