// Единая проверка Manifest v1: подпись, identity, версия, artifact и distributions
// для Unix и Windows. Платформенные политики отличаются, криптография общая.
import assert from "node:assert/strict"
import { test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { verifySignedUnixUpdateManifest } from "../../electrobun/main/update-manifest"
import { verifySignedWindowsUpdateManifest, verifyWindowsUpdateManifest } from "../../electrobun/main/verified-update-manifest"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const other = generateKeyPairSync("ed25519")

function unixDocument(platform: "linux" | "macos" = "linux", arch: "x64" | "arm64" = "x64", channel: "stable" | "canary" = "stable") {
  const version = channel === "stable" ? "1.0.9" : "1.0.9-pre1"
  const suffix = channel === "stable" ? "" : "-canary"
  return { schemaVersion: 1, identifier: appIdentifier, version, hash: "new123", channel, platform, arch,
    artifact: { file: `${channel}-${platform}-${arch}-XneonLauncher${suffix}${platform === "macos" ? ".app" : ""}.tar.zst`,
      downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) },
    distributions: platform === "linux" ? { appimage: { file: `xneon-launcher-${version}-x86_64.AppImage`, downloadSize: 100, downloadSha256: "c".repeat(64) } } : {},
  }
}

function windowsDocument() {
  return { schemaVersion: 1, identifier: appIdentifier, channel: "stable", version: "1.0.9", hash: "new123", platform: "win", arch: "x64",
    artifact: { file: "stable-win-x64-XneonLauncher.tar.zst", tarSha256: "a".repeat(64), tarSize: 1000, downloadSha256: "b".repeat(64), downloadSize: 500 } }
}

function signed(value: unknown, key = privateKey) {
  const bytes = Buffer.from(JSON.stringify(value))
  return [bytes, Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, key).toString("base64") }))] as const
}

function unixCheck(value: unknown, platform: "linux" | "macos" = "linux", arch: "x64" | "arm64" = "x64", channel: "stable" | "canary" = "stable") {
  const [bytes, envelope] = signed(value)
  return verifySignedUnixUpdateManifest(bytes, envelope, keys, { platform, arch, channel })
}

function windowsCheck(bytes: Buffer, envelope: Buffer) {
  return verifySignedWindowsUpdateManifest(bytes, envelope, keys, "1.0.8", "stable", "stable")
}

test("Manifest v1 принимается на всех поддерживаемых платформах и каналах; неизвестные поля совместимы", () => {
  for (const [platform, arch] of [["linux", "x64"], ["macos", "arm64"]] as const) {
    for (const channel of ["stable", "canary"] as const) {
      const value = unixDocument(platform, arch, channel)
      assert.deepEqual(unixCheck(value, platform, arch, channel), value, `${channel}-${platform}-${arch}`)
    }
  }
  const extended = { ...unixDocument(), futureField: { enabled: true }, artifact: { ...unixDocument().artifact, format: "electrobun-tar-zstd" } }
  assert.deepEqual(unixCheck(extended), unixDocument(), "Расширенный v1 остаётся совместимым")

  const windows = windowsDocument()
  const [bytes, envelope] = signed(windows)
  assert.equal(windowsCheck(bytes, envelope).version, "1.0.9")
  assert.equal(verifyWindowsUpdateManifest(bytes, sign(null, bytes, privateKey), publicKey, "1.0.8", "stable", "stable").hash, "new123")
  assert.equal(verifyWindowsUpdateManifest(bytes, sign(null, bytes, privateKey), publicKey, "1.0.8-pre2", "stable", "canary").version, "1.0.9")
})

test("подпись связывает все критические поля и не принимает чужой ключ или повреждённый документ", () => {
  const value = unixDocument()
  const [, envelope] = signed(value)
  for (const changed of [{ ...value, version: "1.1.0" }, { ...value, hash: "other" }, { ...value, platform: "macos" },
    { ...value, arch: "arm64" }, { ...value, channel: "canary" }, { ...value, artifact: { ...value.artifact, downloadSize: 101 } },
    { ...value, artifact: { ...value.artifact, downloadSha256: "d".repeat(64) } }, { ...value, distributions: {} }]) {
    assert.throws(() => verifySignedUnixUpdateManifest(Buffer.from(JSON.stringify(changed)), envelope, keys, { platform: "linux", arch: "x64", channel: "stable" }),
      /signature/, JSON.stringify(changed))
  }
  const [foreignBytes, foreignEnvelope] = signed(value, other.privateKey)
  assert.throws(() => verifySignedUnixUpdateManifest(foreignBytes, foreignEnvelope, keys, { platform: "linux", arch: "x64", channel: "stable" }), /signature/)
  assert.throws(() => verifySignedUnixUpdateManifest(Buffer.from(JSON.stringify(value)), envelope, {}, { platform: "linux", arch: "x64", channel: "stable" }), /key/)
  assert.throws(() => verifySignedUnixUpdateManifest(Buffer.from("{"), envelope, keys, { platform: "linux", arch: "x64", channel: "stable" }))
  assert.throws(() => verifySignedUnixUpdateManifest(Buffer.from(JSON.stringify(value)), Buffer.alloc(1025), keys, { platform: "linux", arch: "x64", channel: "stable" }))
  assert.throws(() => verifySignedUnixUpdateManifest(Buffer.alloc(65537), envelope, keys, { platform: "linux", arch: "x64", channel: "stable" }))

  const windows = windowsDocument()
  const original = Buffer.from(JSON.stringify(windows)), changed = Buffer.from(JSON.stringify({ ...windows, version: "1.0.10" }))
  assert.throws(() => verifyWindowsUpdateManifest(changed, sign(null, original, privateKey), publicKey, "1.0.8", "stable", "stable"), /signature/)
  const trusted = { current: publicKey.export({ type: "spki", format: "pem" }) }
  const windowsEnvelope = (keyId: string, key: typeof privateKey) => Buffer.from(JSON.stringify({ keyId, signature: sign(null, original, key).toString("base64") }))
  assert.equal(verifySignedWindowsUpdateManifest(original, windowsEnvelope("current", privateKey), trusted, "1.0.8", "stable", "stable").version, "1.0.9")
  assert.throws(() => verifySignedWindowsUpdateManifest(original, windowsEnvelope("unknown", privateKey), trusted, "1.0.8", "stable", "stable"), /Unknown update signing key/)
  assert.throws(() => verifySignedWindowsUpdateManifest(original, windowsEnvelope("current", other.privateKey), trusted, "1.0.8", "stable", "stable"), /manifest signature/)
})

test("identity, версия, artifact и distributions проверяются до установки", () => {
  for (const patch of [{ schemaVersion: 2 }, { identifier: "other.app" }, { platform: "win" }, { arch: "arm64" },
    { channel: "canary" }, { version: "invalid" }, { version: "1.0.9-pre1" }, { hash: "../other" }]) {
    assert.throws(() => unixCheck({ ...unixDocument(), ...patch }), undefined, JSON.stringify(patch))
  }
  for (const patch of [{ file: "../payload.tar.zst" }, { file: "https://evil.invalid/archive" },
    { downloadSha256: "z".repeat(64) }, { downloadSize: 0 }, { downloadSize: 1.5 }, { downloadSize: 2 ** 40 },
    { tarSize: -1 }, { tarSha256: "bad" }]) {
    const value = unixDocument()
    assert.throws(() => unixCheck({ ...value, artifact: { ...value.artifact, ...patch } }), undefined, JSON.stringify(patch))
  }
  for (const patch of [{ file: "xneon-launcher-1.0.8-x86_64.AppImage" }, { file: "installer.exe" }, { downloadSize: 0 }]) {
    const value = unixDocument()
    assert.throws(() => unixCheck({ ...value, distributions: { appimage: { ...value.distributions.appimage, ...patch } } }))
  }
  assert.throws(() => unixCheck({ ...unixDocument(), distributions: { unknown: {} } }))
  assert.throws(() => unixCheck({ ...unixDocument(), installer: { file: "xneon-launcher-1.0.9-win-x64.exe", size: 10, sha256: "a".repeat(64) } }))

  const windows = windowsDocument()
  const checkWindows = (patch: Record<string, unknown>, installed = "1.0.8-pre2", preference: "stable" | "canary" = "stable") => {
    const value = { ...windows, ...patch }, bytes = Buffer.from(JSON.stringify(value))
    return verifyWindowsUpdateManifest(bytes, sign(null, bytes, privateKey), publicKey, installed, "stable", preference)
  }
  assert.throws(() => checkWindows({ version: "1.0.8-pre3" }), /stable version/)
  assert.throws(() => checkWindows({ version: "1.0.8-pre1" }), /newer/)
  assert.throws(() => checkWindows({}, "1.0.9"), /newer/)
  assert.throws(() => checkWindows({ channel: "canary" }), /installed package/)
  assert.throws(() => checkWindows({ identifier: "com.xneonlauncher.app" }), /installed package/)
  assert.throws(() => checkWindows({ artifact: { file: windows.artifact.file } }), /artifact metadata/)
})