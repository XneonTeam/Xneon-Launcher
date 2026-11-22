import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { realpath, writeFile, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../../electrobun/platform/sqlite"
import { createUnixUpdateController } from "../../electrobun/main/unix-update-controller"
import { UnixUpdateStateStore } from "../../electrobun/main/unix-update-state"
import { resolveVerifiedUnixUpdate } from "../../electrobun/main/unix-update-feed"
import { downloadUnixUpdateFile } from "../../electrobun/main/unix-update-download"
import { prepareUnixHelperFiles, waitForUnixHelperReady } from "../../electrobun/main/unix-update-handoff"
import { rpcRegistry, invokeHandler, ViewSession } from "../../electrobun/platform/ipc"
import { launcherOperations } from "../../electrobun/platform/operation-gate"
import { unixUpdateStartupBarrier } from "../../electrobun/platform/unix-update-startup-barrier"

const root = await realpath(Bun.argv[2]), bytes = Buffer.from("signed protocol fixture, not an AppImage")
const local = { identifier: "org.xneon.launcher", platform: "linux" as const, arch: "x64" as const, channel: "stable" as const, version: "1.0.8", hash: "old123" }
const installation = { platform: "linux" as const, kind: "appimage" as const, target: "/home/fixture/Xneon.AppImage" }
const manifest = { schemaVersion: 1, identifier: local.identifier, platform: "linux", arch: "x64", channel: "stable", version: "1.0.9", hash: "next123",
  artifact: { file: "stable-linux-x64-XneonLauncher.tar.zst", downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) },
  distributions: { appimage: { file: "xneon-launcher-1.0.9-x86_64.AppImage", downloadSize: bytes.length, downloadSha256: createHash("sha256").update(bytes).digest("hex") } } }
const { privateKey, publicKey } = generateKeyPairSync("ed25519"), keys = { fixture: publicKey.export({ format: "pem", type: "spki" }).toString() }
const manifestBytes = Buffer.from(JSON.stringify(manifest)), signature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, manifestBytes, privateKey).toString("base64") }))
const store = new UnixUpdateStateStore(path.join(root, "state"), { platform: "linux", arch: "x64" }, keys), order: string[] = []
const database = path.join(root, "data.db")
const db = new Database(database); db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('A')")
let child: ReturnType<typeof Bun.spawn> | undefined, files: Awaited<ReturnType<typeof prepareUnixHelperFiles>> | undefined
const controller = createUnixUpdateController({
  context: async () => ({ local, installation }), store,
  resolve: (_context, channel, signal) => resolveVerifiedUnixUpdate(local, { platform: "linux", arch: "x64", channel }, { keys, signal,
    request: async url => new Response(url.endsWith(".sig") ? signature : manifestBytes) }),
  download: async (_context, update, signal) => (await downloadUnixUpdateFile(update.baseUrl, update.manifest.distributions.appimage!, path.join(root, "downloads"), { signal, request: async () => new Response(bytes) })).path,
  handoff: async (_context, pending, signal) => {
    assert.equal((await readFile(pending.path)).toString(), bytes.toString())
    const runtime = path.join(root, "runtime-source"), helper = path.join(root, "helper-source")
    await writeFile(runtime, "copy fixture"); await writeFile(helper, "copy fixture")
    files = await prepareUnixHelperFiles(root, "a".repeat(32), runtime, helper, { nonce: "a".repeat(32) })
    child = Bun.spawn([process.execPath, fileURLToPath(new URL("./unix-helper-handshake.ts", import.meta.url)), files.job], { stdout: "ignore", stderr: "inherit" })
    let exited = false; void child.exited.then(() => { exited = true })
    await waitForUnixHelperReady(files, child.pid, () => !exited, signal); order.push("ready")
    return { cancel: async () => { child?.kill(); await child?.exited } }
  },
  drain: () => launcherOperations.drain(1000), cleanup: async () => { order.push("cleanup") },
  closeDatabase: () => { order.push("close-db"); db.close() }, reopen: async () => {},
  quit: async () => { order.push("quit"); await writeFile(path.join(files!.directory, "fixture-finish"), "finish"); await child!.exited },
  block: value => { launcherOperations.blocked = value }, activeLaunch: () => false, send: () => {},
})
try {
  rpcRegistry.handle("update:check", () => controller.check())
  rpcRegistry.handle("update:download", () => controller.download())
  rpcRegistry.handle("update:defer", () => controller.defer())
  rpcRegistry.handle("update:install", () => controller.install())
  const sender = new ViewSession(12345, () => {})
  const invoke = (channel: string) => invokeHandler(sender, { channel, args: [] })
  assert.equal((await invoke("update:check")).available, true)
  assert.equal((await invoke("update:download")).success, true)
  assert.equal((await invoke("update:defer")).success, true)
  assert.equal((await store.peek(local, installation))?.deferred, true)
  await store.consumeDeferred(local, installation)
  await invoke("update:install")
  assert.deepEqual(order, ["ready", "cleanup", "close-db", "quit"])
  assert.equal(JSON.parse(await readFile(files!.result, "utf8")).status, "protocol-fixture-only")
  const restored = new Database(database)
  assert.equal((restored.query("SELECT value FROM sentinel").get() as { value: string }).value, "A"); restored.close()
  launcherOperations.blocked = false
  const commit = Promise.withResolvers<void>(); unixUpdateStartupBarrier.hold(commit.promise)
  let sideEffects = 0
  rpcRegistry.handle("system:get-total-memory", () => { sideEffects++; return 42 })
  rpcRegistry.handle("startup:update-ready", () => { commit.resolve() })
  const delayed = invoke("system:get-total-memory")
  assert.equal(sideEffects, 0)
  await invoke("startup:update-ready"); assert.equal(await delayed, 42); assert.equal(sideEffects, 1)
  console.log("UNIX_CONTROLLER_PROTOCOL_INTEGRATION_PASS_NOT_NATIVE_E2E")
} finally { launcherOperations.blocked = false; child?.kill(); await child?.exited }
