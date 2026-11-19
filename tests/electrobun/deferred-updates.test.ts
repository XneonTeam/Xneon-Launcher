import assert from "node:assert/strict"
import { generateKeyPairSync, sign, createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { UpdateStateStore } from "../../electrobun/main/update-state"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const local = { channel: "stable" as const, version: "1.0.8", hash: "old123" }
const payload = Buffer.from("installer fixture")
const document = {
  schemaVersion: 1, identifier: appIdentifier, channel: "canary", version: "1.0.9-pre1", hash: "new123",
  platform: "win", arch: "x64",
  artifact: { file: "canary-win-x64-XneonLauncher-canary.tar.zst", tarSha256: "a".repeat(64), tarSize: 1000, downloadSha256: "b".repeat(64), downloadSize: 500 },
  installer: { file: "xneon-launcher-1.0.9-pre1-win-x64.exe", size: payload.length, sha256: createHash("sha256").update(payload).digest("hex") },
}
const manifestBytes = Buffer.from(JSON.stringify(document))
const signatureBytes = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, manifestBytes, privateKey).toString("base64") }))
const update = { manifest: document, manifestBytes, signatureBytes, archiveUrl: "https://example.invalid/archive" }

test("канал сохраняется без загрузки, скачанный файл не планируется до выбора Позже", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-deferred-"))
  try {
    const store = new UpdateStateStore(root, keys)
    await store.selectChannel("canary")
    assert.equal(await new UpdateStateStore(root, keys).getChannel("stable"), "canary")
    assert.equal(await store.peek(local), null)
    const source = path.join(root, "source.exe")
    await writeFile(source, payload)
    await store.stage("installer", local, update, source)
    assert.equal((await store.peek(local))?.deferred, false)
    await store.defer(local)
    const pending = await new UpdateStateStore(root, keys).peek(local, async () => { throw new Error("NSIS must not resolve SDK paths") })
    assert.equal(pending?.deferred, true)
    assert.deepEqual(await readFile(pending!.path!), payload)
    await store.selectChannel("stable")
    assert.equal(await store.peek(local), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("отложенный установщик заново проверяется по подписи и SHA-256, чужая версия запуска не подходит", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-deferred-"))
  try {
    const store = new UpdateStateStore(root, keys)
    const source = path.join(root, "source.exe")
    await writeFile(source, payload)
    await store.stage("installer", local, update, source)
    const pending = await store.peek(local)
    await writeFile(pending!.path!, Buffer.alloc(payload.length, 1))
    await assert.rejects(store.peek(local), /hash/)
    await writeFile(pending!.path!, payload)
    await assert.rejects(store.peek({ ...local, hash: "other123" }), /installed build/)
    await store.clearPending()
    const bad = { ...update, signatureBytes: Buffer.from(JSON.stringify({ keyId: "fixture", signature: Buffer.alloc(64).toString("base64") })) }
    await assert.rejects(store.stage("installer", local, bad, source), /signature/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("SDK prepared-record должен совпадать с сохранённым подписанным манифестом", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-deferred-"))
  try {
    const store = new UpdateStateStore(root, keys)
    const manifest = { ...document, channel: "stable", version: "1.0.9", artifact: { ...document.artifact, file: "stable-win-x64-XneonLauncher.tar.zst" } }
    const bytes = Buffer.from(JSON.stringify(manifest))
    const signature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, privateKey).toString("base64") }))
    await store.stage("sdk", local, { manifest, manifestBytes: bytes, signatureBytes: signature, archiveUrl: "" })
    const prepared = { ...manifest, artifact_file: manifest.artifact.file }
    await writeFile(path.join(root, ".electrobun-prepared-update.json"), JSON.stringify(prepared))
    assert.equal((await store.peek(local, async () => root))?.kind, "sdk")
    await store.defer(local, async () => root)
    assert.equal((await store.peek(local, root))?.deferred, true)
    await writeFile(path.join(root, ".electrobun-prepared-update.json"), JSON.stringify({ ...prepared, hash: "other123" }))
    await assert.rejects(store.peek(local, root), /SDK prepared update/)
    assert.equal(await store.peek({ channel: "stable", version: "1.0.9", hash: "new123" }, root), null)
    assert.equal(await store.peek(local), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})
