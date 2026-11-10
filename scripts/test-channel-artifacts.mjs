import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const pkg = JSON.parse(await readFile("package.json", "utf8"))

function build(channel) {
  const child = spawnSync(process.execPath, ["scripts/electrobun.mjs", "build", "--env=" + channel], { stdio: "inherit" })
  if (child.error) throw child.error
  assert.equal(child.status, 0, channel + " build")
}

async function verify(channel) {
  const dir = path.join("release-electrobun", channel)
  const prefix = channel + "-win-x64"
  const files = (await readdir(dir)).sort()
  const [legacy, current] = await Promise.all(["-update.json", "-update-v2.json"].map(async suffix =>
    JSON.parse(await readFile(path.join(dir, prefix + suffix), "utf8"))))
  for (const manifest of [legacy, current]) {
    assert.equal(manifest.identifier, "com.xneonlauncher.app")
    assert.equal(manifest.version, pkg.version)
    assert.equal(manifest.channel, channel)
    assert.equal(manifest.platform, "win")
    assert.equal(manifest.arch, "x64")
    assert.ok(manifest.artifact.file.startsWith(prefix + "-"))
    assert.ok(files.includes(manifest.artifact.file))
  }
  assert.equal(legacy.hash, current.hash)
  assert.equal(legacy.artifact.file, current.artifact.file)
  assert.match(current.artifact.tarSha256, /^[a-f0-9]{64}$/)
  assert.ok(current.artifact.tarSize > 0)
  assert.ok(files.some(file => file.endsWith(".zip")))
  if (channel === "stable") assert.ok(files.includes(`${pkg.name}-${pkg.version}-win-x64.exe`))
  for (const file of files) assert.ok((await stat(path.join(dir, file))).size > 0)
  return Object.fromEntries(await Promise.all(files.map(async file => {
    const hash = createHash("sha256")
    for await (const data of createReadStream(path.join(dir, file))) hash.update(data)
    return [file, hash.digest("hex")]
  })))
}

assert.equal(process.platform, "win32", "Test requires Windows x64")
assert.equal(process.arch, "x64", "Test requires Windows x64")
build("stable")
const stable = await verify("stable")
build("canary")
const canary = await verify("canary")
assert.deepEqual(await verify("stable"), stable)
build("stable")
assert.deepEqual(await verify("canary"), canary)
console.log("Stable and Canary manifests and artifact isolation verified in both directions.")
