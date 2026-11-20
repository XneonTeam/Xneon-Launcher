import { expect, test } from "bun:test"
import { generateKeyPairSync, sign, createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { UnixUpdateStateStore } from "../../electrobun/main/unix-update-state"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const target = { platform: "linux" as const, arch: "x64" as const }
const installation = { platform: "linux" as const, kind: "appimage" as const, target: "/home/test/Xneon.AppImage" }
const local = { channel: "stable" as const, version: "1.0.8", hash: "old123" }
const payload = Buffer.from("AppImage fixture")
const manifest = { schemaVersion: 2, identifier: appIdentifier, platform: "linux", arch: "x64", channel: "canary", version: "1.0.9-pre1", hash: "new123",
  artifact: { format: "electrobun-tar-zstd", file: "canary-linux-x64-XneonLauncher-canary.tar.zst", downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) },
  distributions: { appimage: { format: "appimage", file: "xneon-launcher-1.0.9-pre1-x86_64.AppImage", downloadSize: payload.length, downloadSha256: createHash("sha256").update(payload).digest("hex") } } }
const bytes = Buffer.from(JSON.stringify(manifest))
const envelope = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, bytes, privateKey).toString("base64") }))
const update: any = { manifest, manifestBytes: bytes, signatureBytes: envelope, baseUrl: "https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/download/canary" }
async function fixture(action: (directory: string, source: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xneon-unix-state-"))
  const source = path.join(directory, "source"); await writeFile(source, payload)
  try { await action(path.join(directory, "state"), source) } finally { await rm(directory, { recursive: true, force: true }) }
}
test("Unix pending переживает restart и применяется только после явного defer", () => fixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, target, keys)
  await store.selectChannel("canary")
  expect(await store.peek(local, installation)).toBeNull()
  await store.stage(local, installation, update, source)
  expect((await store.peek(local, installation))?.deferred).toBe(false)
  await store.defer(local, installation)
  const pending = await new UnixUpdateStateStore(directory, target, keys).peek(local, installation)
  expect(pending?.deferred).toBe(true)
  expect(await readFile(pending!.path)).toEqual(payload)
  expect(await new UnixUpdateStateStore(directory, target, keys).getChannel("stable")).toBe("canary")
}))
test("Unix pending проверяет подпись, bytes и исходную installation при каждом применении", () => fixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, target, keys)
  await store.stage(local, installation, update, source)
  const pending = await store.peek(local, installation)
  await writeFile(pending!.path, Buffer.alloc(payload.length))
  await expect(store.peek(local, installation)).rejects.toThrow(/SHA-256/)
  await writeFile(pending!.path, payload)
  await expect(store.peek({ ...local, hash: "other123" }, installation)).rejects.toThrow(/installed build/)
  await expect(store.peek(local, { ...installation, target: "/other/app.AppImage" })).rejects.toThrow(/installation/)
  const stateFile = path.join(directory, "state.json"), state = JSON.parse(await readFile(stateFile, "utf8"))
  state.pending.manifest = Buffer.from(bytes.toString().replace("new123", "evil123")).toString("base64")
  await writeFile(stateFile, JSON.stringify(state))
  await expect(store.peek(local, installation)).rejects.toThrow(/signature/)
}))
test("смена выбранного канала убирает pending, но не меняет фактически установленный", () => fixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, target, keys)
  await store.stage(local, installation, update, source)
  await store.selectChannel("stable")
  expect(await store.peek(local, installation)).toBeNull()
  expect(await store.getChannel(local.channel)).toBe("stable")
  expect(local.channel).toBe("stable")
}))
test("непроверенный файл не становится сохранённым pending", () => fixture(async (directory, source) => {
  const store = new UnixUpdateStateStore(directory, target, keys)
  await writeFile(source, "bad")
  await expect(store.stage(local, installation, update, source)).rejects.toThrow()
  expect(await store.peek(local, installation)).toBeNull()
}))
