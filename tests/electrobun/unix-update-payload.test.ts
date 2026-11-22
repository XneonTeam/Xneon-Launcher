import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { verifyUnixUpdatePayload } from "../../electrobun/main/unix-update-payload"
import { appIdentifier } from "../../electrobun/main/app-identity"

const identity = { identifier: appIdentifier, version: "1.0.9", channel: "stable", hash: "new123" }
async function fixture(action: (root: string, expected: any) => Promise<void>) {
  const work = await realpath(await mkdtemp(path.join(os.tmpdir(), "xneon-payload-test-")))
  const root = path.join(work, "Xneon.app")
  try {
    await mkdir(path.join(root, "Contents/MacOS"), { recursive: true }); await mkdir(path.join(root, "Contents/Resources"))
    await writeFile(path.join(root, "Contents/Resources/version.json"), JSON.stringify(identity))
    await writeFile(path.join(root, "Contents/Info.plist"), "fixture")
    const binary = Buffer.alloc(64); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(0x0100000c, 4)
    for (const name of ["bun", "launcher"]) await writeFile(path.join(root, "Contents/MacOS", name), binary, { mode: 0o755 })
    await action(root, { ...identity, platform: "macos", arch: "arm64" })
  } finally { await rm(work, { recursive: true, force: true }) }
}
const plist = async () => appIdentifier
test("payload проверяет local identity, оба Mach-O и plist identifier", () => fixture(async (root, expected) => {
  await verifyUnixUpdatePayload(root, expected, plist)
  await expect(verifyUnixUpdatePayload(root, expected, async () => "other.app")).rejects.toThrow()
}))
test("неверная bundled identity не проходит проверку payload", () => fixture(async (root, expected) => {
  for (const key of ["identifier", "version", "channel", "hash"]) {
    await writeFile(path.join(root, "Contents/Resources/version.json"), JSON.stringify({ ...identity, [key]: "other" }))
    await expect(verifyUnixUpdatePayload(root, expected, plist), key).rejects.toThrow()
  }
}))
test("не тот Mach-O и ELF library не могут попасть в macOS payload", () => fixture(async (root, expected) => {
  const binary = Buffer.alloc(64); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(0x01000007, 4)
  await writeFile(path.join(root, "Contents/MacOS/bun"), binary)
  await expect(verifyUnixUpdatePayload(root, expected, plist)).rejects.toThrow()
}))
test("дополнительный native library также обязан быть ARM64", () => fixture(async (root, expected) => {
  const library = Buffer.alloc(64); library.writeUInt32LE(0xfeedfacf); library.writeUInt32LE(0x01000007, 4)
  await writeFile(path.join(root, "Contents/MacOS/libNativeWrapper.dylib"), library)
  await expect(verifyUnixUpdatePayload(root, expected, plist)).rejects.toThrow()
}))
test("готовое staging-дерево повторно проверяется на внешние symlinks", () => fixture(async (root, expected) => {
  const outside = path.join(path.dirname(root), "outside")
  await writeFile(outside, "data"); await symlink(outside, path.join(root, "Contents/escape"))
  await expect(verifyUnixUpdatePayload(root, expected, plist)).rejects.toThrow()
}))
