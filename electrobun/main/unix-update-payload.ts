import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"
import { assertLinuxCefRuntime } from "../platform/linux-cef"
import { appIdentifier } from "./app-identity"
import type { UnixHealthIdentity } from "./unix-update-health"

const execute = promisify(execFile)
async function plistIdentifier(file: string) {
  const result = await execute("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleIdentifier", file], { encoding: "utf8", timeout: 5000, maxBuffer: 8192 })
  return result.stdout.trim()
}
function nativeHeader(bytes: Buffer, platform: "linux" | "macos") {
  assert.ok(bytes.length >= 32, "Truncated native update executable")
  if (platform === "macos") {
    assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, "Expected native Mach-O update payload")
    assert.equal(bytes.readUInt32LE(4), 0x0100000c, "Update Mach-O is not ARM64")
  } else {
    assert.equal(bytes.toString("hex", 0, 4), "7f454c46", "Expected native ELF update payload")
    assert.ok(bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === 62, "Update ELF is not x64")
  }
}

/** Повторная проверка уже извлечённого дерева непосредственно перед handoff/rename. */
export async function verifyUnixUpdatePayload(bundle: string, expected: UnixHealthIdentity, readPlistIdentifier = plistIdentifier) {
  assert.equal(expected.identifier, appIdentifier, "Invalid update application identity")
  assert.ok(expected.platform === "linux" && expected.arch === "x64" || expected.platform === "macos" && expected.arch === "arm64", "Unsupported native update target")
  const root = await realpath(bundle)
  assert.equal(root, bundle, "Update bundle path is not canonical")
  const mac = expected.platform === "macos", resources = path.join(root, mac ? "Contents/Resources" : "Resources")
  const version = path.join(resources, "version.json"), metadata = await lstat(version)
  assert.ok(metadata.isFile() && metadata.size > 0 && metadata.size <= 64 * 1024, "Invalid bundled update identity")
  const local = JSON.parse(await readFile(version, "utf8"))
  for (const key of ["identifier", "version", "hash", "channel"] as const) assert.equal(local[key], expected[key], "Bundled update identity mismatch")
  const bin = path.join(root, mac ? "Contents/MacOS" : "bin")
  for (const name of ["launcher", "bun"]) {
    const file = path.join(bin, name), info = await lstat(file)
    assert.ok(info.isFile() && (process.platform === "win32" || info.mode & 0o111), "Missing update executable or permission")
    nativeHeader(Buffer.from(await Bun.file(file).slice(0, 64).arrayBuffer()), expected.platform)
  }
  if (mac) assert.equal(await readPlistIdentifier(path.join(root, "Contents/Info.plist")), appIdentifier, "Update .app identifier mismatch")
  else assertLinuxCefRuntime(bin)
  for (const name of await readdir(root, { recursive: true })) {
    const file = path.join(root, name), info = await lstat(file)
    if (info.isSymbolicLink()) {
      const target = path.relative(root, await realpath(file))
      assert.ok(target !== ".." && !target.startsWith(".." + path.sep) && !path.isAbsolute(target), "Update symlink escapes bundle")
      continue
    }
    assert.ok(info.isFile() || info.isDirectory(), "Invalid native update file type")
    if (!info.isFile()) continue
    // До изменения build.copy NFD содержит соседние OS-варианты; loader выбирает только свой target.
    const relative = path.relative(resources, file).replaceAll("\\", "/")
    if (relative.startsWith("app/native/nfd/") && !relative.startsWith(`app/native/nfd/${mac ? "darwin-arm64" : "linux-x64"}/`)) continue
    const bytes = Buffer.from(await Bun.file(file).slice(0, 64).arrayBuffer())
    if (bytes.length >= 4 && (bytes.toString("hex", 0, 4) === "7f454c46" || bytes.readUInt32LE(0) === 0xfeedfacf)) nativeHeader(bytes, expected.platform)
  }
  return local as { identifier: string; version: string; hash: string; channel: "stable" | "canary" }
}
