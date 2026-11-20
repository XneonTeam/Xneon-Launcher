import { expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { authenticateUnixHelperJob } from "../../electrobun/main/unix-update-job"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const nonce = "a".repeat(32), profile = "/Users/test/Library/Application Support/xneonlauncher"
const context = { profile, parentPid: 42, platform: "macos" as const, arch: "arm64" as const }
const manifest = { schemaVersion: 2, identifier: appIdentifier, platform: "macos", arch: "arm64", channel: "stable", version: "1.0.9", hash: "new123",
  artifact: { file: "stable-macos-arm64-XneonLauncher.app.tar.zst", format: "electrobun-tar-zstd", downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) }, distributions: {} }
const bytes = Buffer.from(JSON.stringify(manifest)), signature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, privateKey).toString("base64") }))
function job() { return { schemaVersion: 1, nonce, parentPid: 42, profile, selectedChannel: "stable",
  old: { identifier: appIdentifier, platform: "macos", arch: "arm64", version: "1.0.8", hash: "old123", channel: "stable" },
  installation: { kind: "app-bundle", platform: "macos", target: "/Applications/Xneon Launcher.app" },
  executable: "/Applications/Xneon Launcher.app/Contents/MacOS/bun", mount: {},
  source: `${profile}/system-cache/unix-updates/payload-${"b".repeat(32)}`,
  manifest: bytes.toString("base64"), signature: signature.toString("base64"), allowChannelSwitch: false,
} }
test("helper job связан с родителем, профилем, installation и подписанным target", () => {
  const result = authenticateUnixHelperJob(job(), context, keys)
  expect(result.update.manifest.version).toBe("1.0.9")
  expect(result.installation.target).toBe("/Applications/Xneon Launcher.app")
})
for (const patch of [{ parentPid: 99 }, { profile: "/other/profile" }, { source: "/tmp/untrusted" }, { selectedChannel: "canary" },
  { executable: "/bin/sh" }, { nonce: "../bad" }, { program: "/bin/sh" }, { args: ["-c", "bad"] },
  { installation: { kind: "deb", platform: "macos", target: "/Applications/Xneon.app" } },
  { installation: { kind: "app-bundle", platform: "macos", target: "/Applications/../other.app" } },
  { old: { identifier: "other.app", platform: "macos", arch: "arm64", version: "1.0.8", hash: "old123", channel: "stable" } },
]) test(`helper отвергает опасное задание: ${JSON.stringify(patch)}`, () => {
  expect(() => authenticateUnixHelperJob({ ...job(), ...patch }, context, keys)).toThrow()
})
test("helper сам перепроверяет подпись и не принимает произвольные public keys из job", () => {
  expect(() => authenticateUnixHelperJob({ ...job(), manifest: Buffer.from(bytes.toString().replace("new123", "evil123")).toString("base64") }, context, keys)).toThrow(/signature/)
  expect(() => authenticateUnixHelperJob({ ...job(), publicKeys: keys }, context, keys)).toThrow()
})
