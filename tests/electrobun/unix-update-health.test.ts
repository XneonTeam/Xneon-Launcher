import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acknowledgeUnixUpdateStartup, readUnixUpdateHealth } from "../../electrobun/main/unix-update-health"
import { appIdentifier } from "../../electrobun/main/app-identity"

const nonce = "a".repeat(32)
const identity = { identifier: appIdentifier, platform: "macos" as const, arch: "arm64" as const, channel: "stable" as const, version: "1.0.9", hash: "new123" }
async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xneon-health-test-"))
  try { await action(root) } finally { await rm(root, { recursive: true, force: true }) }
}
test("startup ack связан с nonce, фактической identity и принадлежащим запуску PID", () => fixture(async root => {
  expect(await readUnixUpdateHealth(root, nonce, identity, async () => true)).toBeNull()
  const file = await acknowledgeUnixUpdateStartup(root, nonce, identity)
  const record = await readUnixUpdateHealth(root, nonce, identity, async pid => pid === process.pid)
  expect(record?.pid).toBe(process.pid)
  expect(JSON.parse(await readFile(file, "utf8")).version).toBe("1.0.9")
  await expect(readUnixUpdateHealth(root, nonce, identity, async () => false)).rejects.toThrow(/process/)
}))
test("неподходящие version/hash/channel/target и старый nonce не считаются успехом", () => fixture(async root => {
  const file = await acknowledgeUnixUpdateStartup(root, nonce, identity)
  const original = JSON.parse(await readFile(file, "utf8"))
  for (const patch of [{ version: "1.0.8" }, { hash: "old123" }, { channel: "canary" }, { platform: "linux" }, { arch: "x64" }, { nonce: "b".repeat(32) }, { ready: false }]) {
    await writeFile(file, JSON.stringify({ ...original, ...patch }))
    await expect(readUnixUpdateHealth(root, nonce, identity, async () => true)).rejects.toThrow()
  }
}))
test("ack нельзя направить в произвольный путь и подменить symlink", () => fixture(async root => {
  await expect(acknowledgeUnixUpdateStartup(root, "../outside", identity)).rejects.toThrow()
  const file = await acknowledgeUnixUpdateStartup(root, nonce, identity)
  const outside = path.join(root, "outside.json")
  await writeFile(outside, await readFile(file)); await rm(file); await symlink(outside, file)
  await expect(readUnixUpdateHealth(root, nonce, identity, async () => true)).rejects.toThrow()
}))
