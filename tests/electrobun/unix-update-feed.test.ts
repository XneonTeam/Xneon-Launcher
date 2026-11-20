import { expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { unixManifestUrls, resolveVerifiedUnixUpdate, resolvePreviousUnixUpdate, unixHistoricalManifestUrls } from "../../electrobun/main/unix-update-feed"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const local = { channel: "stable" as const, version: "1.0.8", hash: "old123" }
const target = { platform: "linux" as const, arch: "x64" as const, channel: "stable" as const }
function responses(version = "1.0.9", channel = "stable") {
  const artifact = { file: `${channel}-linux-x64-XneonLauncher${channel === "canary" ? "-canary" : ""}.tar.zst`, format: "electrobun-tar-zstd", tarSize: 200, tarSha256: "a".repeat(64), downloadSize: 100, downloadSha256: "b".repeat(64) }
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, identifier: appIdentifier, platform: "linux", arch: "x64", channel, version, hash: "new123", artifact, distributions: {} }))
  const envelope = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, privateKey).toString("base64") }))
  return { request: async (url: string) => new Response(url.endsWith(".sig") ? envelope : bytes), keys }
}
test("Unix использует отдельный v3 URL, Windows v2 не подменяется", () => {
  expect(unixManifestUrls(target).manifestUrl).toEndWith("/stable-linux-x64-update-v3.json")
  expect(unixManifestUrls({ platform: "macos", arch: "arm64", channel: "canary" }).signatureUrl).toEndWith("/canary-macos-arm64-update-v3.json.sig")
})
test("новая версия обнаруживается, одинаковая/старая и отсутствующий feed не являются обновлением", async () => {
  expect((await resolveVerifiedUnixUpdate(local, target, responses()))?.manifest.version).toBe("1.0.9")
  for (const version of ["1.0.8", "1.0.7"]) expect(await resolveVerifiedUnixUpdate(local, target, responses(version))).toBeNull()
  expect(await resolveVerifiedUnixUpdate(local, target, { keys, request: async () => null })).toBeNull()
})
test("понижение допустимо только при явной смене канала", async () => {
  const canary = { ...target, channel: "canary" as const }
  const options = responses("1.0.7-pre1", "canary")
  await expect(resolveVerifiedUnixUpdate(local, canary, options)).rejects.toThrow(/channel/)
  expect((await resolveVerifiedUnixUpdate(local, canary, { ...options, allowChannelSwitch: true }))?.manifest.channel).toBe("canary")
})

test("rollback feed берётся из точного тега A, а не latest B", async () => {
  const expected = { channel: "stable" as const, version: "1.0.8", hash: "new123" }
  expect(unixHistoricalManifestUrls(expected, target).manifestUrl).toEndWith("/releases/download/v1.0.8/stable-linux-x64-update-v3.json")
  expect((await resolvePreviousUnixUpdate(expected, target, responses("1.0.8"))).manifest.hash).toBe("new123")
  await expect(resolvePreviousUnixUpdate({ ...expected, hash: "wrong" }, target, responses("1.0.8"))).rejects.toThrow()
  await expect(resolvePreviousUnixUpdate(expected, target, responses("1.0.9"))).rejects.toThrow()
})
