import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, readlink } from "node:fs/promises"
import fs from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { stageRoot, stageTarUpdateRoot } from "../../scripts/package-linux"
import { validateCefPayload } from "../../scripts/unix-native-preflight"
import { stopUnixProcessGroup } from "../../scripts/unix-process-cleanup"
import { appIdentifier } from "../../electrobun/main/app-identity"

const elf64 = () => {
  const elf = Buffer.alloc(64)
  elf.write("\x7fELF"); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18)
  return elf
}

test("Linux CEF payload принимает SDK runtime и отвергает неполный или чужой ABI", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "xneon-cef-test-")))
  try {
    await mkdir(path.join(root, "bin/locales"), { recursive: true })
    const elf = elf64()
    await writeFile(path.join(root, "bin/libcef.so"), elf)
    await writeFile(path.join(root, "bin/bun Helper"), elf, { mode: 0o755 })
    for (const name of ["icudtl.dat", "resources.pak", "chrome_100_percent.pak", "chrome_200_percent.pak", "v8_context_snapshot.bin", "locales/en-US.pak"]) await writeFile(path.join(root, "bin", name), "fixture")
    expect((await validateCefPayload(root)).libcef).toBe("bin/libcef.so")
    await mkdir(path.join(root, "bin/cef"))
    await symlink("../libcef.so", path.join(root, "bin/cef/libcef.so"))
    expect((await validateCefPayload(root)).libcef).toBe("bin/libcef.so")
    await rm(path.join(root, "bin/bun Helper"))
    await expect(validateCefPayload(root)).rejects.toThrow()
    await writeFile(path.join(root, "bin/bun Helper"), elf, { mode: 0o755 })
    await rm(path.join(root, "bin/resources.pak"))
    await expect(validateCefPayload(root)).rejects.toThrow()
    await writeFile(path.join(root, "bin/resources.pak"), "fixture")
    elf.writeUInt16LE(183, 18)
    await writeFile(path.join(root, "bin/libcef.so"), elf)
    await expect(validateCefPayload(root)).rejects.toThrow("Invalid Linux ELF architecture")
  } finally { await rm(root, { recursive: true, force: true }) }

  const incomplete = await realpath(await mkdtemp(path.join(tmpdir(), "xneon-cef-test-")))
  try {
    await mkdir(path.join(incomplete, "bin"))
    await expect(validateCefPayload(incomplete)).rejects.toThrow()
    await writeFile(path.join(incomplete, "bin/libcef.so"), "not an ELF")
    await expect(validateCefPayload(incomplete)).rejects.toThrow()
  } finally { await rm(incomplete, { recursive: true, force: true }) }
})

test("updater helper собирается отдельным executable без окон и приватного ключа", async () => {
  const result = await Bun.build({ entrypoints: ["./electrobun/main/unix-update-helper.ts"], target: "bun", format: "cjs", write: false })
  expect(result.success).toBe(true)
  const text = await result.outputs[0].text()
  expect(text).toContain("Unknown update signing key or invalid signature envelope")
  expect(text).toContain("runUnixUpdateHelper")
  expect(text).not.toContain("class DesktopWindow")
  expect(text).not.toContain("XNLC_UPDATE_PRIVATE_KEY")
  expect(text).not.toContain("update-package-helper-not-configured")
  expect(text).toContain("installUnixPackage")

  const bundle = await Bun.build({ entrypoints: ["./electrobun/main/unix-update-helper-entry.ts"], target: "bun", format: "cjs", write: false })
  expect(bundle.success).toBe(true)
  expect(await bundle.outputs[0].text()).toContain("runUnixUpdateHelper")
})

test("package-linux сохраняет относительный CEF symlink и маркер только в TAR staging", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "xneon-package-layout-"))
  try {
    const source = path.join(work, "extracted"), app = "XneonLauncher", payload = path.join(source, app)
    await mkdir(path.join(payload, "bin/cef"), { recursive: true })
    await mkdir(path.join(payload, "Resources"))
    for (const file of ["bin/launcher", "bin/bun", "bin/cef/libcef.so", "Resources/version.json"]) await writeFile(path.join(payload, file), "fixture")
    await symlink("cef/libcef.so", path.join(payload, "bin/libcef.so"))
    const root = await stageRoot(source, path.join(work, "stage"), app)
    const link = await readlink(path.join(root, "opt/xneon-launcher/bin/libcef.so"))
    expect(link.replaceAll("\\", "/")).toBe("cef/libcef.so")

    const original = path.join(work, "packages")
    await mkdir(path.join(original, "opt/xneon-launcher/Resources"), { recursive: true })
    await writeFile(path.join(original, "opt/xneon-launcher/Resources/version.json"), "fixture")
    const stage = await stageTarUpdateRoot(original)
    const marker = "opt/xneon-launcher/Resources/update-installation.json"
    expect(JSON.parse(await readFile(path.join(stage, marker), "utf8"))).toEqual({ schemaVersion: 1, identifier: appIdentifier, format: "tar-xz" })
    await expect(readFile(path.join(original, marker))).rejects.toThrow()
  } finally { await rm(work, { recursive: true, force: true }) }
})

test("ldd использует абсолютный ELF path и search path после смены cwd", async () => {
  const source = fs.readFileSync(new URL("../../scripts/unix-native-preflight.ts", import.meta.url), "utf8")
  const code = transformSync(source.slice(0, source.indexOf("if (import.meta.main)")), { loader: "ts", format: "cjs" }).code
  const module = { exports: {} as any }
  let inspected = false
  const mocks = {
    "node:assert/strict": await import("node:assert/strict"),
    "node:path": path,
    "node:fs/promises": { lstat: async () => ({ isFile: () => true, mode: 0o755 }), readFile: async () => Buffer.alloc(64), readdir: async () => ["bin/bun"] },
    "node:child_process": { spawnSync(program: string, args: string[], options: any) {
      if (program === "ldd") {
        inspected = true
        expect(args[0]).toBe(path.resolve("native-payload/XneonLauncher/bin/bun"))
        expect(path.isAbsolute(options.cwd)).toBe(true)
        expect(options.env.LD_LIBRARY_PATH).toBe([options.cwd, path.join(options.cwd, "cef")].join(":"))
        expect(options.env.LD_PRELOAD).toBeUndefined()
      }
      return { status: 0, stdout: program === "readelf" && args[0] === "--dynamic" ? "(NEEDED)" : "", stderr: "" }
    } },
    "./electrobun-artifacts": { validateNativeExecutable() {} },
    "./artifact-checksums": {},
    "../package.json": {},
    "../electrobun/platform/linux-cef": { assertLinuxCefRuntime: (bin: string) => ({ libcef: path.join(bin, "libcef.so"), helper: path.join(bin, "bun Helper") }) },
  }
  vm.runInNewContext(code, { module, exports: module.exports, Buffer,
    process: { platform: "linux", arch: "x64", env: { LD_PRELOAD: "/untrusted.so" } },
    Bun: { file: () => ({ slice: () => ({ arrayBuffer: async () => Buffer.from("7f454c46", "hex") }) }) },
    require: (name: string) => { expect(Object.hasOwn(mocks, name)).toBe(true); return (mocks as any)[name] },
  })
  await module.exports.inspectUnixBundle("native-payload/XneonLauncher")
  expect(inspected).toBe(true)
})

test("остановка Unix process group: штатный выход, SIGKILL и отказ не скрываются", async () => {
  const graceful: string[] = []
  let checks = 0
  expect(await stopUnixProcessGroup(42, {
    alive: () => ++checks < 3,
    signal: signal => { graceful.push(signal) },
    pause: async () => {},
  })).toEqual({ stopped: true, forced: false })
  expect(graceful).toEqual(["SIGTERM"])

  const forcedSignals: string[] = []
  let forced = false
  expect(await stopUnixProcessGroup(42, {
    alive: () => !forced,
    signal: signal => { forcedSignals.push(signal); if (signal === "SIGKILL") forced = true },
    pause: async () => {},
  })).toEqual({ stopped: true, forced: true })
  expect(forcedSignals).toEqual(["SIGTERM", "SIGKILL"])

  await expect(stopUnixProcessGroup(42, { alive: () => true, signal: () => {}, pause: async () => {} })).rejects.toThrow("remains alive")
  await expect(stopUnixProcessGroup(0)).rejects.toThrow("Invalid process group")
})