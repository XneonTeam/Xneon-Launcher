// Состояние обновления: выбранный канал, отложенный (deferred) payload,
// проверка подписи/SHA-256 при каждом применении и старт после «Позже».
import assert from "node:assert/strict"
import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { UnixUpdateStateStore } from "../../electrobun/main/unix-update-state"
import { UpdateStateStore } from "../../electrobun/main/update-state"
import { resumeDeferredUpdate } from "../../electrobun/main/update-startup"
import { appIdentifier } from "../../electrobun/main/app-identity"
import { updateBaseUrls } from "../../electrobun/main/repository-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const unixTarget = { platform: "linux" as const, arch: "x64" as const }
const installation = { platform: "linux" as const, kind: "appimage" as const, target: "/home/test/Xneon.AppImage" }
const local = { channel: "stable" as const, version: "1.0.8", hash: "old123" }
const unixPayload = Buffer.from("AppImage fixture")
const unixManifest = { schemaVersion: 1, identifier: appIdentifier, platform: "linux", arch: "x64", channel: "canary", version: "1.0.9-pre1", hash: "new123",
  artifact: { file: "canary-linux-x64-XneonLauncher-canary.tar.zst", downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) },
  distributions: { appimage: { file: "xneon-launcher-1.0.9-pre1-x86_64.AppImage", downloadSize: unixPayload.length, downloadSha256: createHash("sha256").update(unixPayload).digest("hex") } } }
const unixManifestBytes = Buffer.from(JSON.stringify(unixManifest))
const unixSignature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, unixManifestBytes, privateKey).toString("base64") }))
const unixUpdate: any = { manifest: unixManifest, manifestBytes: unixManifestBytes, signatureBytes: unixSignature,
  baseUrl: updateBaseUrls.canary }

const windowsPayload = Buffer.from("installer fixture")
const windowsManifest = { schemaVersion: 1, identifier: appIdentifier, channel: "canary", version: "1.0.9-pre1", hash: "new123", platform: "win", arch: "x64",
  artifact: { file: "canary-win-x64-XneonLauncher-canary.tar.zst", tarSha256: "a".repeat(64), tarSize: 1000, downloadSha256: "b".repeat(64), downloadSize: 500 },
  installer: { file: "xneon-launcher-1.0.9-pre1-win-x64.exe", size: windowsPayload.length, sha256: createHash("sha256").update(windowsPayload).digest("hex") } }
const windowsManifestBytes = Buffer.from(JSON.stringify(windowsManifest))
const windowsSignature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, windowsManifestBytes, privateKey).toString("base64") }))
const windowsUpdate = { manifest: windowsManifest, manifestBytes: windowsManifestBytes, signatureBytes: windowsSignature, archiveUrl: "https://example.invalid/archive" }

async function unixFixture(action: (directory: string, source: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xneon-unix-state-"))
  const source = path.join(directory, "source"); await writeFile(source, unixPayload)
  try { await action(path.join(directory, "state"), source) } finally { await rm(directory, { recursive: true, force: true }) }
}
async function windowsFixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-deferred-"))
  try { await action(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test("Unix: канал и pending переживают restart, применение включается только явным defer", () => unixFixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, unixTarget, keys)
  await store.selectChannel("canary")
  expect(await store.peek(local, installation)).toBeNull()
  await store.stage(local, installation, unixUpdate, source)
  expect((await store.peek(local, installation))?.deferred).toBe(false)
  await store.defer(local, installation)

  const restarted = new UnixUpdateStateStore(directory, unixTarget, keys)
  const pending = await restarted.peek(local, installation)
  expect(pending?.deferred).toBe(true)
  expect(await readFile(pending!.path)).toEqual(unixPayload)
  expect(await restarted.getChannel("stable")).toBe("canary")

  // Bootstrap снимает однократный маркер, но payload остаётся для helper handoff.
  await restarted.consumeDeferred(local, installation)
  const consumed = await new UnixUpdateStateStore(directory, unixTarget, keys).peek(local, installation)
  expect(consumed?.deferred).toBe(false)
  expect(await readFile(consumed!.path)).toEqual(unixPayload)

  // Смена канала убирает pending и не переписывает фактически установленный.
  await restarted.selectChannel("stable")
  expect(await restarted.peek(local, installation)).toBeNull()
  expect(await restarted.getChannel(local.channel)).toBe("stable")
}))

test("Unix pending проверяет bytes, сборку, installation и подпись при каждом применении", () => unixFixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, unixTarget, keys)
  await store.stage(local, installation, unixUpdate, source)
  const pending = await store.peek(local, installation)
  await writeFile(pending!.path, Buffer.alloc(unixPayload.length))
  await expect(store.peek(local, installation)).rejects.toThrow(/SHA-256/)
  await writeFile(pending!.path, unixPayload)
  await expect(store.peek({ ...local, hash: "other123" }, installation)).rejects.toThrow(/installed build/)
  await expect(store.peek(local, { ...installation, target: "/other/app.AppImage" })).rejects.toThrow(/installation/)

  const stateFile = path.join(directory, "state.json"), state = JSON.parse(await readFile(stateFile, "utf8"))
  state.pending.manifest = Buffer.from(unixManifestBytes.toString().replace("new123", "evil123")).toString("base64")
  await writeFile(stateFile, JSON.stringify(state))
  await expect(store.peek(local, installation)).rejects.toThrow(/signature/)
}))

test("Unix: непроверенный файл не становится pending, а сбой cleanup прежнего payload не теряет новый", () => unixFixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, unixTarget, keys)
  await writeFile(source, "bad")
  await expect(store.stage(local, installation, unixUpdate, source)).rejects.toThrow()
  expect(await store.peek(local, installation)).toBeNull()

  await writeFile(source, unixPayload)
  await store.stage(local, installation, unixUpdate, source)
  const previous = await store.peek(local, installation)
  await rm(previous!.path); await mkdir(previous!.path)
  await expect(store.stage(local, installation, unixUpdate, source)).rejects.toThrow()
  const pending = await store.peek(local, installation)
  expect(await readFile(pending!.path)).toEqual(unixPayload)
}))

test("Windows: канал сохраняется без загрузки, pending не планируется до «Позже» и переживает restart", () => windowsFixture(async root => {
  const store = new UpdateStateStore(root, keys)
  await store.selectChannel("canary")
  assert.equal(await new UpdateStateStore(root, keys).getChannel("stable"), "canary")
  assert.equal(await store.peek(local), null)
  const source = path.join(root, "source.exe")
  await writeFile(source, windowsPayload)
  await store.stage(local, windowsUpdate, source)
  assert.equal((await store.peek(local))?.deferred, false)
  await store.defer(local)
  const pending = await new UpdateStateStore(root, keys).peek(local)
  assert.equal(pending?.deferred, true)
  assert.deepEqual(await readFile(pending!.path), windowsPayload)
  await store.selectChannel("stable")
  assert.equal(await store.peek(local), null)
}))

test("Windows: отложенный установщик заново проверяется по подписи и SHA-256, чужая сборка не подходит", () => windowsFixture(async root => {
  const store = new UpdateStateStore(root, keys)
  const source = path.join(root, "source.exe")
  await writeFile(source, windowsPayload)
  await store.stage(local, windowsUpdate, source)
  const pending = await store.peek(local)
  await writeFile(pending!.path, Buffer.alloc(windowsPayload.length, 1))
  await assert.rejects(store.peek(local), /hash/)
  await writeFile(pending!.path, windowsPayload)
  await assert.rejects(store.peek({ ...local, hash: "other123" }), /installed build/)
  await store.clearPending()
  const bad = { ...windowsUpdate, signatureBytes: Buffer.from(JSON.stringify({ keyId: "fixture", signature: Buffer.alloc(64).toString("base64") })) }
  await assert.rejects(store.stage(local, bad, source), /signature/)
}))

test("Windows: запись прежней SDK-схемы снимается и не применяется", () => windowsFixture(async root => {
  const store = new UpdateStateStore(root, keys)
  const manifest = { ...windowsManifest, channel: "stable", version: "1.0.9",
    artifact: { ...windowsManifest.artifact, file: "stable-win-x64-XneonLauncher.tar.zst" },
    installer: { ...windowsManifest.installer, file: "xneon-launcher-1.0.9-win-x64.exe" } }
  const bytes = Buffer.from(JSON.stringify(manifest))
  const signature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, privateKey).toString("base64") }))
  const state = { channel: "stable", pending: { kind: "sdk", channel: "stable", fromHash: local.hash, fromChannel: local.channel,
    manifest: bytes.toString("base64"), signature: signature.toString("base64"), deferred: true } }
  await writeFile(path.join(root, "state.json"), JSON.stringify(state))
  assert.equal(await store.peek(local), null)
  // Запись действительно удалена, а не просто скрыта.
  assert.equal(JSON.parse(await readFile(path.join(root, "state.json"), "utf8")).pending, undefined)
}))