import { expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { verifySignedUnixUpdateManifest } from "../../electrobun/main/unix-update-manifest"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const target = { platform: "linux" as const, arch: "x64" as const, channel: "stable" as const }
function document(platform = "linux", arch = "x64", channel = "stable") {
  const version = channel === "stable" ? "1.0.9" : "1.0.9-pre1"
  const suffix = channel === "stable" ? "" : "-canary"
  return { schemaVersion: 2, identifier: appIdentifier, version, hash: "new123", channel, platform, arch,
    artifact: { file: `${channel}-${platform}-${arch}-XneonLauncher${suffix}${platform === "macos" ? ".app" : ""}.tar.zst`,
      format: "electrobun-tar-zstd", downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) },
    distributions: platform === "linux" ? { appimage: { file: `xneon-launcher-${version}-x86_64.AppImage`, format: "appimage", downloadSize: 100, downloadSha256: "c".repeat(64) } } : {},
  }
}
function signed(value: unknown, key = privateKey) {
  const bytes = Buffer.from(JSON.stringify(value))
  return [bytes, Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, key).toString("base64") }))] as const
}
function check(value: unknown, expected = target) { const [bytes, envelope] = signed(value); return verifySignedUnixUpdateManifest(bytes, envelope, keys, expected) }

for (const [platform, arch] of [["linux", "x64"], ["macos", "arm64"]] as const) {
  for (const channel of ["stable", "canary"] as const) test(`подписанный Unix feed: ${channel}-${platform}-${arch}`, () => {
    const value = document(platform, arch, channel)
    const [bytes, envelope] = signed(value)
    expect(verifySignedUnixUpdateManifest(bytes, envelope, keys, { platform, arch, channel })).toEqual(value)
  })
}

test("все критические поля связаны с Ed25519-подписью", () => {
  const value = document()
  const [, envelope] = signed(value)
  for (const changed of [ { ...value, version: "1.1.0" }, { ...value, hash: "other" }, { ...value, platform: "macos" },
    { ...value, arch: "arm64" }, { ...value, channel: "canary" }, { ...value, artifact: { ...value.artifact, downloadSize: 101 } },
    { ...value, artifact: { ...value.artifact, downloadSha256: "d".repeat(64) } }, { ...value, distributions: {} } ]) {
    expect(() => verifySignedUnixUpdateManifest(Buffer.from(JSON.stringify(changed)), envelope, keys, target)).toThrow(/signature/)
  }
})

test("чужой ключ, keyId и повреждённые документы отвергаются", () => {
  const [bytes, envelope] = signed(document(), generateKeyPairSync("ed25519").privateKey)
  expect(() => verifySignedUnixUpdateManifest(bytes, envelope, keys, target)).toThrow(/signature/)
  const [validBytes, validEnvelope] = signed(document())
  expect(() => verifySignedUnixUpdateManifest(validBytes, validEnvelope, {}, target)).toThrow(/key/)
  expect(() => verifySignedUnixUpdateManifest(Buffer.from("{"), validEnvelope, keys, target)).toThrow()
  expect(() => verifySignedUnixUpdateManifest(validBytes, Buffer.alloc(1025), keys, target)).toThrow()
  expect(() => verifySignedUnixUpdateManifest(Buffer.alloc(65537), validEnvelope, keys, target)).toThrow()
})

for (const patch of [ { schemaVersion: 1 }, { identifier: "other.app" }, { platform: "win" }, { arch: "arm64" },
  { channel: "canary" }, { version: "invalid" }, { version: "1.0.9-pre1" }, { hash: "../other" } ]) {
  test(`неверная Unix identity: ${JSON.stringify(patch)}`, () => { expect(() => check({ ...document(), ...patch })).toThrow() })
}
for (const patch of [ { file: "../payload.tar.zst" }, { file: "https://evil.invalid/archive" }, { format: "zip" },
  { downloadSha256: "z".repeat(64) }, { downloadSize: 0 }, { downloadSize: 1.5 }, { downloadSize: 2 ** 40 },
  { tarSize: -1 }, { tarSha256: "bad" } ]) {
  test(`неверный Unix artifact: ${JSON.stringify(patch)}`, () => {
    const value = document(); expect(() => check({ ...value, artifact: { ...value.artifact, ...patch } })).toThrow()
  })
}
test("дистрибутивы нельзя перепутать с Windows, чужой версией или форматом", () => {
  for (const patch of [ { file: "xneon-launcher-1.0.8-x86_64.AppImage" }, { format: "deb" }, { file: "installer.exe" }, { downloadSize: 0 } ]) {
    const value = document()
    expect(() => check({ ...value, distributions: { appimage: { ...value.distributions.appimage, ...patch } } })).toThrow()
  }
  expect(() => check({ ...document(), distributions: { unknown: {} } })).toThrow()
})
