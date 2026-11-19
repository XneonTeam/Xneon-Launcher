import assert from "node:assert/strict"
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import { updatePublicKeys } from "../electrobun/main/update-public-keys"
import { verifyWindowsUpdateManifest } from "../electrobun/main/verified-update-manifest"

const [channel, input, output] = Bun.argv.slice(2)
assert.ok((channel === "stable" || channel === "canary") && input && output && path.resolve(input) !== path.resolve(output), "Usage: sign-update-feed <stable|canary> <candidate> <new-output>")
const keyId = process.env.XNLC_UPDATE_KEY_ID
const privatePem = process.env.XNLC_UPDATE_PRIVATE_KEY
assert.ok(keyId && Object.hasOwn(updatePublicKeys, keyId) && privatePem, "Configure a trusted key ID and provide the private key in the protected signing environment")
const privateKey = createPrivateKey(privatePem)
const publicKey = createPublicKey(updatePublicKeys[keyId])
assert.equal(privateKey.asymmetricKeyType, "ed25519", "Invalid update key type")

const name = `${channel}-win-x64-update-v2.json`
const manifest = JSON.parse(await readFile(path.join(input, name), "utf8"))
assert.equal(manifest.version, packageJson.version)
const artifact = manifest.artifact
assert.ok(typeof artifact?.file === "string" && new RegExp(`^${channel}-win-x64-[a-zA-Z0-9_-]{1,120}\\.tar\\.zst$`).test(artifact.file))
const file = path.join(input, artifact.file)
const info = await stat(file)
assert.ok(info.isFile() && info.size > 0 && info.size < 512 * 1024 ** 2)
const archive = await readFile(file)
assert.ok(Number.isSafeInteger(artifact.tarSize) && artifact.tarSize > 0 && artifact.tarSize < 512 * 1024 ** 2)
const tar = Bun.zstdDecompressSync(archive)
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
assert.equal(tar.length, artifact.tarSize)
assert.equal(sha256(tar), artifact.tarSha256)

// NSIS-установщик того же канала: смена канала в приложении ставит его поверх.
// Его хеш входит в подписанный манифест, поэтому загрузка с GitHub проверяема.
const installerName = `xneon-launcher-${packageJson.version}-win-x64.exe`
const installerPath = path.join(input, installerName)
let installer: { file: string; size: number; sha256: string } | undefined
try {
  const installerInfo = await stat(installerPath)
  assert.ok(installerInfo.isFile() && installerInfo.size > 1024 ** 2 && installerInfo.size < 512 * 1024 ** 2, "Invalid installer size")
  installer = { file: installerName, size: installerInfo.size, sha256: sha256(await readFile(installerPath)) }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
}

const bytes = Buffer.from(JSON.stringify({ ...manifest, ...(installer ? { installer } : {}), artifact: { ...artifact, downloadSize: archive.length, downloadSha256: sha256(archive) } }))
const signature = sign(null, bytes, privateKey)
verifyWindowsUpdateManifest(bytes, signature, publicKey, "0.0.0", channel, "canary")

await mkdir(output)
await writeFile(path.join(output, name), bytes, { flag: "wx" })
await writeFile(path.join(output, name + ".sig"), JSON.stringify({ keyId, signature: signature.toString("base64") }), { flag: "wx" })
await writeFile(path.join(output, artifact.file), archive, { flag: "wx" })
console.log(`Signed ${name} for key ${keyId}`)
