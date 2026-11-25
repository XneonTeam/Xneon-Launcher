// Единая проверка update feed: канонические URL, версии и выбор обновления
// для Unix и Windows. Здесь нет проверки формата Manifest — она в update-manifest.test.ts.
import assert from "node:assert/strict"
import { test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { installedPreference, isAllowedUpdateRedirect, isNewerRelease, manifestUrls, releaseChannelOf } from "../../electrobun/main/verified-update-feed"
import { isTrustedUnixUpdateBase, resolveVerifiedUnixUpdate, unixManifestUrls } from "../../electrobun/main/unix-update-feed"
import { repository, updateBaseUrls } from "../../electrobun/main/repository-identity"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const local = { channel: "stable" as const, version: "1.0.8", hash: "old123" }
const target = { platform: "linux" as const, arch: "x64" as const, channel: "stable" as const }

function responses(version = "1.0.9", channel = "stable") {
  const artifact = { file: `${channel}-linux-x64-XneonLauncher${channel === "canary" ? "-canary" : ""}.tar.zst`,
    tarSize: 200, tarSha256: "a".repeat(64), downloadSize: 100, downloadSha256: "b".repeat(64) }
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, identifier: appIdentifier, platform: "linux", arch: "x64", channel, version, hash: "new123", artifact, distributions: {} }))
  const envelope = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, privateKey).toString("base64") }))
  return { request: async (url: string) => new Response(url.endsWith(".sig") ? envelope : bytes), keys }
}

test("каналы, версии и URL фида: canonical GitHub layout, безопасные редиректы, policy версий", () => {
  assert.equal(releaseChannelOf("1.0.8"), "stable")
  for (const version of ["1.0.8-pre2", "1.0.8-beta1"]) assert.equal(releaseChannelOf(version), "canary")
  assert.equal(installedPreference("stable"), "stable")
  assert.equal(installedPreference("canary"), "beta")
  assert.equal(isNewerRelease("1.0.11", "1.0.11"), false)
  assert.equal(isNewerRelease("1.0.11-pre1", "1.0.11"), false)
  assert.equal(isNewerRelease("1.0.10", "1.0.11"), false)
  assert.equal(isNewerRelease("1.0.12", "1.0.11"), true)
  assert.equal(isNewerRelease("1.0.11-pre2", "1.0.11-pre1"), true)
  assert.throws(() => isNewerRelease("1.0", "1.0.11"), /Invalid update version/)

  const stable = manifestUrls("stable"), canary = manifestUrls("canary")
  assert.equal(stable.base, updateBaseUrls.stable)
  assert.equal(stable.manifestUrl, stable.base + "/stable-win-x64-update-v2.json")
  assert.equal(stable.signatureUrl, stable.base + "/stable-win-x64-update-v2.json.sig")
  assert.equal(canary.base, updateBaseUrls.canary)
  assert.equal(canary.manifestUrl, canary.base + "/canary-win-x64-update-v2.json")

  assert.equal(unixManifestUrls(target).manifestUrl, updateBaseUrls.stable + "/stable-linux-x64-update.json")
  assert.equal(unixManifestUrls({ platform: "macos", arch: "arm64", channel: "canary" }).signatureUrl,
    updateBaseUrls.canary + "/canary-macos-arm64-update.json.sig")

  assert.equal(isAllowedUpdateRedirect(new URL(`https://github.com/${repository}/releases/download/v1.0.10/stable-win-x64-update-v2.json`)), true)
  assert.equal(isAllowedUpdateRedirect(new URL("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r")), true)
  assert.equal(isAllowedUpdateRedirect(new URL("https://objects.githubusercontent.com/x")), true)
  for (const url of ["https://github.com/other/repo/releases/download/v1/x.json", "https://evil.example/x.json",
    `http://github.com/${repository}/releases/download/v1/x.json`,
    `https://github.com:8443/${repository}/releases/download/v1/x.json`]) {
    assert.equal(isAllowedUpdateRedirect(new URL(url)), false, url)
  }
})

test("новая версия обнаруживается, равная/старая и отсутствующий feed — нет; downgrade требует смены канала", async () => {
  assert.equal((await resolveVerifiedUnixUpdate(local, target, responses()))?.manifest.version, "1.0.9")
  for (const version of ["1.0.8", "1.0.7"]) assert.equal(await resolveVerifiedUnixUpdate(local, target, responses(version)), null)
  assert.equal(await resolveVerifiedUnixUpdate(local, target, { keys, request: async () => null }), null)
  const canary = { ...target, channel: "canary" as const }
  const options = responses("1.0.7-pre1", "canary")
  await assert.rejects(resolveVerifiedUnixUpdate(local, canary, options), /channel/)
  assert.equal((await resolveVerifiedUnixUpdate(local, canary, { ...options, allowChannelSwitch: true }))?.manifest.channel, "canary")
})

test("скачивание Unix-обновления принимает только официальные base URL каналов", () => {
  assert.equal(isTrustedUnixUpdateBase(unixManifestUrls(target).base), true)
  assert.equal(isTrustedUnixUpdateBase(unixManifestUrls({ ...target, channel: "canary" }).base), true)
  assert.equal(isTrustedUnixUpdateBase(`https://github.com/${repository}/releases/download/v1.0.8`), false)
  assert.equal(isTrustedUnixUpdateBase(`http://github.com/${repository}/releases/latest/download`), false)
})