import { expect, test } from "bun:test"
import { unixUpdateLaunchSpec, ownsUnixUpdateProcess, unixUpdateOwnedGroups } from "../../electrobun/main/unix-update-process"

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
test("macOS запускает настоящий launcher без shell/open и без произвольных аргументов", () => {
  const spec = unixUpdateLaunchSpec({ kind: "app-bundle", platform: "macos", target: "/Applications/Xneon Launcher.app" }, nonce, {})
  expect(spec.file).toBe("/Applications/Xneon Launcher.app/Contents/MacOS/launcher")
  expect(spec.cwd).toBe("/Applications/Xneon Launcher.app/Contents/MacOS")
  expect(spec.args).toEqual([])
})
test("health PID может быть Bun-потомком launcher, но только в принадлежащей запуску группе", async () => {
  expect(await ownsUnixUpdateProcess(102, 100, async pid => pid === 102 ? 100 : null)).toBe(true)
  expect(await ownsUnixUpdateProcess(102, 100, async () => 200)).toBe(false)
  expect(await ownsUnixUpdateProcess(102, 100, async () => null)).toBe(false)
  expect(await ownsUnixUpdateProcess(0, 100, async () => 100)).toBe(false)
})
test("опасные пути и nonce не могут попасть в restart", () => {
  expect(() => unixUpdateLaunchSpec({ kind: "appimage", platform: "linux", target: "--evil" }, nonce, {})).toThrow()
  expect(() => unixUpdateLaunchSpec({ kind: "appimage", platform: "linux", target: "/normal" }, "../bad", {})).toThrow()
  expect(() => unixUpdateLaunchSpec({ kind: "manual", platform: "linux", target: "/normal" }, nonce, {})).toThrow()
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
