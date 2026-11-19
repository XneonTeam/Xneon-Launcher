import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import { updatePublicKeys } from "../electrobun/main/update-public-keys"
import { verifySignedWindowsUpdateManifest } from "../electrobun/main/verified-update-manifest"
import { artifactChecksums, formatChecksums } from "./artifact-checksums"

export async function verifySignedUpdateFeed(directory: string, version = packageJson.version) {
  assert.ok(directory, "Usage: verify-signed-update-feed <candidate>")
  const releaseChannel = version.includes("-") ? "canary" : "stable"
  // Установщик есть в обоих каналах: он нужен для смены канала из приложения.
  const installerName = `xneon-launcher-${version}-win-x64.exe`
  const expected = new Set<string>([installerName])
  const artifacts: Array<{ file: string; downloadSize: number; downloadSha256: string }> = []
  // Канал берётся из версии: prerelease публикует canary, обычный релиз — stable.
  const name = `${releaseChannel}-win-x64-update-v2.json`
  const [manifestBytes, envelope] = await Promise.all(
    [name, name + ".sig"].map(file => readFile(path.join(directory, file))),
  )
  const manifest = verifySignedWindowsUpdateManifest(manifestBytes, envelope, updatePublicKeys, "0.0.0", releaseChannel, "canary")
  assert.equal(manifest.version, version)
  const installer = JSON.parse(manifestBytes.toString("utf8")).installer
  assert.ok(installer && installer.file === installerName &&
    Number.isSafeInteger(installer.size) && installer.size > 0 &&
    /^[a-f0-9]{64}$/.test(installer.sha256), "Signed manifest must describe the installer")
  const installerInfo = await stat(path.join(directory, installerName))
  assert.equal(installerInfo.size, installer.size, "Installer size differs from the signed manifest")
  assert.equal(createHash("sha256").update(await readFile(path.join(directory, installerName))).digest("hex"),
    installer.sha256, "Installer hash differs from the signed manifest")
  artifacts.push(manifest.artifact)
  expected.add(name).add(name + ".sig").add(manifest.artifact.file)
  const files = await readdir(directory)
  const hasChecksums = files.includes("SHA256SUMS.txt")
  assert.deepEqual(files.sort(), [...expected, ...(hasChecksums ? ["SHA256SUMS.txt"] : [])].sort(), "Unexpected release attachments")
  const checksums = await artifactChecksums(directory, [...expected])
  for (const artifact of artifacts) {
    const actual = checksums.find(entry => entry.file === artifact.file)!
    assert.equal(actual.size, artifact.downloadSize)
    assert.equal(actual.sha256, artifact.downloadSha256)
  }
  const text = formatChecksums(checksums)
  // Повторная проверка никогда не перегенерирует уже существующий checksum-файл.
  if (hasChecksums) assert.equal(await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8"), text, "Signed transport checksum mismatch")
  else await writeFile(path.join(directory, "SHA256SUMS.txt"), text, { flag: "wx" })
  console.log("Verified trusted signatures and release attachment hashes")
  return [...expected].sort()
}

if (import.meta.main) verifySignedUpdateFeed(Bun.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
