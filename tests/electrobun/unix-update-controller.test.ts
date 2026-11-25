// Unix update controller: канал, download/defer/install, restart barrier,
// безопасный launch spec, владение процессами, коды ошибок и IPC-валидация.
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import { createUnixUpdateController } from "../../electrobun/main/unix-update-controller"
import { unixUpdateLaunchSpec, ownsUnixUpdateProcess, unixUpdateOwnedGroups } from "../../electrobun/main/unix-update-process"
import { unixUpdateErrorCode } from "../../electrobun/main/unix-update-errors"
import { validateInvokeArgs } from "../../electrobun/platform/ipc-validation"
import { appIdentifier } from "../../electrobun/main/app-identity"

function controllerFixture() {
  const events: string[] = [], local = { identifier: appIdentifier, platform: "linux", arch: "x64", channel: "stable", version: "1.0.8", hash: "old" }
  let pending: any = null, selected = "stable"
  const update: any = { manifest: { version: "1.0.9", hash: "new", channel: "stable" } }
  const ports: any = {
    context: async () => ({ local, installation: { kind: "directory", target: "/app", platform: "linux" } }),
    store: { getChannel: async () => selected, selectChannel: async (value: string) => { selected = value; pending = null },
      peek: async () => pending, stage: async () => { pending = { update, path: "/payload", deferred: false } }, defer: async () => { pending.deferred = true } },
    resolve: async () => update, download: async () => { events.push("download"); return "/payload" },
    handoff: async () => { events.push("ready"); return { cancel: async () => { events.push("cancel") } } },
    drain: async () => { events.push("drain") }, cleanup: async () => { events.push("cleanup") }, closeDatabase: () => { events.push("close-db") },
    reopen: async () => { events.push("reopen") }, quit: async () => { events.push("quit") }, block: (value: boolean) => { events.push(`block:${value}`) },
    activeLaunch: () => false, send: () => {},
  }
  return { ports, events, controller: createUnixUpdateController(ports) }
}

test("выбор канала не скачивает и не запускает helper", async () => {
  const { controller, events } = controllerFixture()
  expect(await controller.setChannel("beta")).toEqual({ state: "selected" })
  expect(await controller.getChannel()).toBe("beta")
  expect(events).toEqual([])
})

test("check/download/defer восстанавливаются через существующий update state", async () => {
  const { controller, events } = controllerFixture()
  expect((await controller.check()).available).toBe(true)
  expect(await controller.download()).toEqual({ success: true })
  expect(await controller.defer()).toEqual({ success: true })
  expect(await controller.getState()).toEqual({ status: "downloaded", version: "1.0.9", deferred: true })
  expect(events).toEqual(["download"])
})

test("main закрывает БД и выходит только после helper ready и cleanup", async () => {
  const { controller, events } = controllerFixture()
  await controller.check(); await controller.download(); await controller.install()
  expect(events).toEqual(["download", "block:true", "drain", "ready", "cleanup", "close-db", "quit"])
})

test("неудача cleanup отменяет helper, оставляет A и снимает restart barrier", async () => {
  const { controller, ports, events } = controllerFixture()
  ports.cleanup = async () => { throw new Error("cleanup-failed") }
  await controller.check(); await controller.download(); await controller.install()
  expect(events).toContain("cancel")
  expect(events).not.toContain("quit")
  expect(events.at(-1)).toBe("block:false")
})

test("работающая Minecraft не позволяет начать handoff", async () => {
  const { controller, ports, events } = controllerFixture()
  await controller.check(); await controller.download(); ports.activeLaunch = () => true
  await controller.install()
  expect(events).not.toContain("ready")
})

const nonce = "a".repeat(32)

test("AppImage restart не наследует старый mount и переменные инъекции", () => {
  const spec = unixUpdateLaunchSpec({ kind: "appimage", platform: "linux", target: "/home/user/Xneon Launcher.AppImage" }, nonce,
    { APPIMAGE: "/old.AppImage", APPDIR: "/tmp/.mount_old", LD_LIBRARY_PATH: "/oldmount/lib", LD_PRELOAD: "/bad.so", NODE_OPTIONS: "--require bad", DISPLAY: ":0", HOME: "/home/user", XNEON_BUN_DATA_DIR: "/home/user/profile" })
  expect(spec.file).toBe("/home/user/Xneon Launcher.AppImage")
  expect(spec.args).toEqual([])
  expect(spec.env.APPDIR).toBeUndefined()
  expect(spec.env.APPIMAGE).toBeUndefined()
  expect(spec.env.LD_PRELOAD).toBeUndefined()
  expect(spec.env.LD_LIBRARY_PATH).toBeUndefined()
  expect(spec.env.NODE_OPTIONS).toBeUndefined()
  expect(spec.env.DISPLAY).toBe(":0")
  expect(spec.env.XNEON_BUN_DATA_DIR).toBe("/home/user/profile")
  expect(spec.env.XNLC_UNIX_UPDATE_NONCE).toBe(nonce)
})

test("macOS запускает настоящий launcher без shell/open, а опасные пути и nonce не попадают в restart", () => {
  const spec = unixUpdateLaunchSpec({ kind: "app-bundle", platform: "macos", target: "/Applications/Xneon Launcher.app" }, nonce, {})
  expect(spec.file).toBe("/Applications/Xneon Launcher.app/Contents/MacOS/launcher")
  expect(spec.cwd).toBe("/Applications/Xneon Launcher.app/Contents/MacOS")
  expect(spec.args).toEqual([])
  expect(() => unixUpdateLaunchSpec({ kind: "appimage", platform: "linux", target: "--evil" }, nonce, {})).toThrow()
  expect(() => unixUpdateLaunchSpec({ kind: "appimage", platform: "linux", target: "/normal" }, "../bad", {})).toThrow()
  expect(() => unixUpdateLaunchSpec({ kind: "manual", platform: "linux", target: "/normal" }, nonce, {})).toThrow()
})

test("health PID может быть Bun-потомком launcher, но только в принадлежащей запуску группе", async () => {
  expect(await ownsUnixUpdateProcess(102, 100, async pid => pid === 102 ? 100 : null)).toBe(true)
  expect(await ownsUnixUpdateProcess(102, 100, async () => 200)).toBe(false)
  expect(await ownsUnixUpdateProcess(102, 100, async () => null)).toBe(false)
  expect(await ownsUnixUpdateProcess(0, 100, async () => 100)).toBe(false)
})

test("поиск orphan групп требует точного environment nonce, не подстроки command line", () => {
  expect(unixUpdateOwnedGroups([
    `100 /app/bin/bun XNLC_UNIX_UPDATE_NONCE=${nonce} HOME=/home/test`,
    `100 /app/bin/bun --type=renderer XNLC_UNIX_UPDATE_NONCE=${nonce}`,
    `200 /else/bun XNLC_UNIX_UPDATE_NONCE=${nonce}b`,
    `300 /else/bun ARG_XNLC_UNIX_UPDATE_NONCE=${nonce}`,
    `400 /else/bun --argument=${nonce}`,
  ].join("\n"), nonce)).toEqual([100])
})

test("ошибки файловой системы и integrity превращаются в локализуемые Unix коды", () => {
  expect(unixUpdateErrorCode(Object.assign(new Error("disk"), { code: "ENOSPC" }))).toBe("update-insufficient-space")
  expect(unixUpdateErrorCode(Object.assign(new Error("permissions"), { code: "EACCES" }))).toBe("update-no-permission")
  try { assert.equal(1, 2, "signature details") } catch (error) { expect(unixUpdateErrorCode(error)).toBe("update-verification-failed") }
  expect(unixUpdateErrorCode(new Error("update-recovery-required"))).toBe("update-recovery-required")
  expect(unixUpdateErrorCode(new Error("restart-cancelled"))).toBe("restart-cancelled")
})

test("startup health RPC не принимает nonce/identity/пути от renderer", () => {
  expect(() => validateInvokeArgs("startup:update-ready", [])).not.toThrow()
  expect(() => validateInvokeArgs("startup:update-ready", ["spoofed-nonce"])).toThrow()
})

test("настоящие IPC/controller/signed store и child handshake работают совместно (не native E2E)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-controller-integration-"))
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../fixtures/unix-controller-integration.ts", import.meta.url)), root], { stdout: "pipe", stderr: "pipe" })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(code, stderr).toBe(0)
    expect(stdout).toContain("UNIX_CONTROLLER_PROTOCOL_INTEGRATION_PASS_NOT_NATIVE_E2E")
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20_000)