// Unix helper: аутентификация job, handoff файлов, startup health (ack/wait),
// жизненный цикл транзакции и barrier, удерживающий side effects до commit.
import { expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { authenticateUnixHelperJob } from "../../electrobun/main/unix-update-job"
import { prepareUnixHelperFiles, waitForUnixHelperReady, readActiveUnixUpdate } from "../../electrobun/main/unix-update-handoff"
import { acknowledgeUnixUpdateStartup, readUnixUpdateHealth, waitForUnixUpdateHealth } from "../../electrobun/main/unix-update-health"
import { unixUpdateStartupAction } from "../../electrobun/main/unix-update-lifecycle"
import { UnixUpdateStartupBarrier } from "../../electrobun/platform/unix-update-startup-barrier"
import { appIdentifier } from "../../electrobun/main/app-identity"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const nonce = "a".repeat(32), profile = "/Users/test/Library/Application Support/xneonlauncher"
const context = { profile, parentPid: 42, platform: "macos" as const, arch: "arm64" as const }
const manifest = { schemaVersion: 1, identifier: appIdentifier, platform: "macos", arch: "arm64", channel: "stable", version: "1.0.9", hash: "new123",
  artifact: { file: "stable-macos-arm64-XneonLauncher.app.tar.zst", downloadSize: 100, downloadSha256: "a".repeat(64), tarSize: 200, tarSha256: "b".repeat(64) }, distributions: {} }
const manifestBytes = Buffer.from(JSON.stringify(manifest)), signature = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, manifestBytes, privateKey).toString("base64") }))
function job() { return { schemaVersion: 1, nonce, parentPid: 42, profile, selectedChannel: "stable",
  old: { identifier: appIdentifier, platform: "macos", arch: "arm64", version: "1.0.8", hash: "old123", channel: "stable" },
  installation: { kind: "app-bundle", platform: "macos", target: "/Applications/Xneon Launcher.app" },
  executable: "/Applications/Xneon Launcher.app/Contents/MacOS/bun", mount: {},
  source: `${profile}/system-cache/unix-updates/payload-${"b".repeat(32)}`,
  manifest: manifestBytes.toString("base64"), signature: signature.toString("base64"), allowChannelSwitch: false } }

test("helper job связан с родителем, профилем, installation и подписанным target", () => {
  const result = authenticateUnixHelperJob(job(), context, keys)
  expect(result.update.manifest.version).toBe("1.0.9")
  expect(result.installation.target).toBe("/Applications/Xneon Launcher.app")
})

test("helper отвергает опасное задание, подменённую подпись и произвольные public keys", () => {
  for (const patch of [{ parentPid: 99 }, { profile: "/other/profile" }, { source: "/tmp/untrusted" }, { selectedChannel: "canary" },
    { executable: "/bin/sh" }, { nonce: "../bad" }, { program: "/bin/sh" }, { args: ["-c", "bad"] },
    { installation: { kind: "deb", platform: "macos", target: "/Applications/Xneon.app" } },
    { installation: { kind: "app-bundle", platform: "macos", target: "/Applications/../other.app" } },
    { old: { identifier: "other.app", platform: "macos", arch: "arm64", version: "1.0.8", hash: "old123", channel: "stable" } },
  ]) expect(() => authenticateUnixHelperJob({ ...job(), ...patch }, context, keys), JSON.stringify(patch)).toThrow()
  expect(() => authenticateUnixHelperJob({ ...job(), manifest: Buffer.from(manifestBytes.toString().replace("new123", "evil123")).toString("base64") }, context, keys)).toThrow(/signature/)
  expect(() => authenticateUnixHelperJob({ ...job(), publicKeys: keys }, context, keys)).toThrow()
})

async function handoffFixture(action: (profile: string, runtime: string, helper: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "xneon-handoff-")))
  try {
    const profilePath = path.join(root, "profile"), runtime = path.join(root, "bun"), helper = path.join(root, "helper.js")
    await mkdir(profilePath); await writeFile(runtime, "runtime"); await writeFile(helper, "helper")
    await action(profilePath, runtime, helper)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test("handoff копирует runtime/helper, создаёт приватный immutable job вне app и не перезаписывает его", () => handoffFixture(async (profilePath, runtime, helper) => {
  const files = await prepareUnixHelperFiles(profilePath, nonce, runtime, helper, { nonce })
  expect(await readFile(files.runtime, "utf8")).toBe("runtime")
  expect(await readFile(files.helper, "utf8")).toBe("helper")
  expect(JSON.parse(await readFile(files.job, "utf8"))).toEqual({ nonce })
  expect((await lstat(files.runtime)).ino).not.toBe((await lstat(runtime)).ino)
  await expect(prepareUnixHelperFiles(profilePath, nonce, runtime, helper, { nonce })).rejects.toThrow()
}))

test("symlink вместо private root отвергается до копирования", () => handoffFixture(async (profilePath, runtime, helper) => {
  const cache = path.join(profilePath, "system-cache"), outside = path.join(profilePath, "outside")
  await mkdir(cache); await mkdir(outside)
  await symlink(outside, path.join(cache, "unix-update-helper"), process.platform === "win32" ? "junction" : "dir")
  await expect(prepareUnixHelperFiles(profilePath, nonce, runtime, helper, { nonce })).rejects.toThrow()
}))

test("ready требует точного nonce/PID и живого helper, отмена не разрешает закрыть A", () => handoffFixture(async (profilePath, runtime, helper) => {
  const files = await prepareUnixHelperFiles(profilePath, nonce, runtime, helper, { nonce })
  await writeFile(files.ready, JSON.stringify({ schemaVersion: 1, nonce, pid: 321 }), { mode: 0o600 })
  expect(await waitForUnixHelperReady(files, 321, () => true)).toBeUndefined()
  await expect(waitForUnixHelperReady(files, 123, () => true)).rejects.toThrow()
  await expect(waitForUnixHelperReady(files, 321, () => false)).rejects.toThrow()
  const controller = new AbortController()
  controller.abort(new Error("restart-cancelled"))
  await expect(waitForUnixHelperReady(files, 321, () => true, controller.signal)).rejects.toThrow(/restart-cancelled/)
}))

test("active marker с потерянным job не превращается в отсутствие обновления", () => handoffFixture(async (profilePath, runtime, helper) => {
  const files = await prepareUnixHelperFiles(profilePath, nonce, runtime, helper, { nonce })
  await writeFile(files.active, JSON.stringify({ schemaVersion: 1, nonce: "b".repeat(32) }), { mode: 0o600 })
  await expect(readActiveUnixUpdate(profilePath)).rejects.toThrow()
}))

const identity = { identifier: appIdentifier, platform: "macos" as const, arch: "arm64" as const, channel: "stable" as const, version: "1.0.9", hash: "new123" }
async function healthFixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-health-test-"))
  try { await action(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test("startup ack связан с nonce, фактической identity и принадлежащим запуску PID", () => healthFixture(async root => {
  expect(await readUnixUpdateHealth(root, nonce, identity, async () => true)).toBeNull()
  const file = await acknowledgeUnixUpdateStartup(root, nonce, identity)
  const record = await readUnixUpdateHealth(root, nonce, identity, async pid => pid === process.pid)
  expect(record?.pid).toBe(process.pid)
  expect(JSON.parse(await readFile(file, "utf8")).version).toBe("1.0.9")
  await expect(readUnixUpdateHealth(root, nonce, identity, async () => false)).rejects.toThrow(/process/)
}))

test("неподходящие version/hash/channel/target/nonce не считаются успехом; ack нельзя подменить symlink", () => healthFixture(async root => {
  const file = await acknowledgeUnixUpdateStartup(root, nonce, identity)
  const original = JSON.parse(await readFile(file, "utf8"))
  for (const patch of [{ version: "1.0.8" }, { hash: "old123" }, { channel: "canary" }, { platform: "linux" }, { arch: "x64" }, { nonce: "b".repeat(32) }, { ready: false }]) {
    await writeFile(file, JSON.stringify({ ...original, ...patch }))
    await expect(readUnixUpdateHealth(root, nonce, identity, async () => true), JSON.stringify(patch)).rejects.toThrow()
  }
  await expect(acknowledgeUnixUpdateStartup(root, "../outside", identity)).rejects.toThrow()
  await writeFile(file, JSON.stringify(original))
  const outside = path.join(root, "outside.json")
  await writeFile(outside, await readFile(file)); await rm(file); await symlink(outside, file)
  await expect(readUnixUpdateHealth(root, nonce, identity, async () => true)).rejects.toThrow()
}))

test("ожидание health: отмена имеет приоритет и не читает ack, deadline и смерть группы дают false", async () => {
  const aborted = new AbortController(); aborted.abort(new Error("update-cancelled"))
  let reads = 0
  await expect(waitForUnixUpdateHealth({ readHealthy: async () => { reads++; return true }, isAlive: async () => true }, aborted.signal)).rejects.toThrow(/update-cancelled/)
  expect(reads).toBe(0)

  const racing = new AbortController()
  await expect(waitForUnixUpdateHealth({ readHealthy: async () => { racing.abort(new Error("update-cancelled")); return true }, isAlive: async () => true }, racing.signal)).rejects.toThrow(/update-cancelled/)

  let clock = 0
  const ports = { readHealthy: async () => false, isAlive: async () => true, now: () => clock, sleep: async (ms: number) => { clock += ms } }
  expect(await waitForUnixUpdateHealth(ports, undefined, 500)).toBe(false)
  expect(clock).toBe(500)
  expect(await waitForUnixUpdateHealth({ ...ports, isAlive: async () => false })).toBe(false)
  expect(await waitForUnixUpdateHealth({ ...ports, readHealthy: async () => true })).toBe(true)
})

test("отмена во время интервала не запускает следующее чтение", async () => {
  const controller = new AbortController(); let reads = 0
  await expect(waitForUnixUpdateHealth({ readHealthy: async () => { reads++; return false }, isAlive: async () => true,
    sleep: async () => { controller.abort(new Error("update-cancelled")) } }, controller.signal)).rejects.toThrow(/update-cancelled/)
  expect(reads).toBe(1)
})

const base = { nonce, current: "old" as "old" | "next" | "unknown", inheritedNonce: undefined as string | undefined,
  live: false, ready: true, journal: true, result: undefined as string | undefined }

test("startup: trial только для ожидаемой B живого helper, остальные состояния fail-closed", () => {
  expect(unixUpdateStartupAction({ ...base, current: "next", live: true, inheritedNonce: nonce })).toBe("trial")
  expect(unixUpdateStartupAction({ ...base, current: "next", live: true })).toBe("busy")
  expect(unixUpdateStartupAction({ ...base, live: true })).toBe("busy")
  expect(() => unixUpdateStartupAction({ ...base, live: true, inheritedNonce: "b".repeat(32) })).toThrow()
  expect(unixUpdateStartupAction(base)).toBe("finish")
  expect(unixUpdateStartupAction({ ...base, ready: false, journal: false })).toBe("abandon")
  expect(unixUpdateStartupAction({ ...base, current: "next" })).toBe("blocked")
  expect(unixUpdateStartupAction({ ...base, current: "unknown" })).toBe("blocked")
})

test("startup: подтверждённая B завершает обновление, неподтверждённая — блокирует", () => {
  expect(unixUpdateStartupAction({ ...base, current: "next", result: "committed" })).toBe("finish")
  expect(() => unixUpdateStartupAction({ ...base, result: "committed" })).toThrow()
  for (const result of ["failed", "cancelled"]) expect(unixUpdateStartupAction({ ...base, result })).toBe("finish")
  for (const result of ["failed", "cancelled"]) expect(unixUpdateStartupAction({ ...base, current: "next", result })).toBe("blocked")
})

test("fail-closed проверяется до CEF, иначе неподтверждённая B не будет заблокирована", async () => {
  const source = await readFile(new URL("../../electrobun/main/bootstrap.ts", import.meta.url), "utf8")
  expect(source.indexOf("resumeUnixUpdates(bundledWorker")).toBeLessThan(source.indexOf("assertLinuxCefRuntime(path.dirname"))
})

test("startup barrier: ack и чтение темы не ждут commit, auth/launch и фоновые side effects ждут", async () => {
  const barrier = new UnixUpdateStartupBarrier(), commit = Promise.withResolvers<void>()
  barrier.hold(commit.promise)
  expect(barrier.waitForRpc("startup:update-ready")).toBeNull()
  expect(barrier.waitForRpc("startup:ready")).toBeNull()
  expect(barrier.waitForRpc("settings:get-many")).toBeNull()
  let invoked = false
  const delayed = barrier.waitForRpc("auth:microsoft-login")!.then(() => { invoked = true })
  await Promise.resolve(); expect(invoked).toBe(false)
  commit.resolve(); await delayed; expect(invoked).toBe(true)
  expect(barrier.waitForRpc("minecraft:launch")).toBeNull()
})