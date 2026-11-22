import assert from "node:assert/strict"
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { appIdentifier } from "./app-identity"
import type { UnixUpdateManifest } from "./update-manifest"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"

export type UnixHealthIdentity = Pick<UnixUpdateManifest, "identifier" | "platform" | "arch" | "version" | "hash" | "channel">
type HealthRecord = UnixHealthIdentity & { nonce: string; pid: number; ready: true }
const fields = ["identifier", "platform", "arch", "version", "hash", "channel"] as const
async function healthFile(root: string, nonce: string, create: boolean) {
  assert.ok(/^[a-f0-9]{32}$/.test(nonce), "Invalid update startup nonce")
  if (create) await mkdir(root, { recursive: true, mode: 0o700 })
  const info = await lstat(root)
  assert.ok(info.isDirectory(), "Invalid update health directory")
  if (process.platform !== "win32") assert.ok(info.uid === process.getuid!() && !(info.mode & 0o077), "Update health directory is not private")
  return path.join(root, `health-${nonce}.json`)
}

/** Вызывается main только после успешного старта новой сборки, без аргументов от renderer. */
export async function acknowledgeUnixUpdateStartup(root: string, nonce: string, actual: UnixHealthIdentity) {
  assert.equal(actual.identifier, appIdentifier, "Invalid startup application identity")
  const file = await healthFile(root, nonce, true)
  const temporary = file + `.${randomBytes(8).toString("hex")}.tmp`
  try {
    const handle = await open(temporary, "wx", 0o600)
    try { await handle.writeFile(JSON.stringify({ ...actual, nonce, pid: process.pid, ready: true })); await handle.sync() }
    finally { await handle.close() }
    await rename(temporary, file)
    await syncUnixUpdateDirectory(root); await syncUnixUpdateDirectory(path.dirname(root))
  } finally { await rm(temporary, { force: true }) }
  return file
}

/** expected берётся из проверенного Ed25519-манифеста; владение PID проверяет native helper. */
export async function readUnixUpdateHealth(root: string, nonce: string, expected: UnixHealthIdentity,
  ownsProcess: (pid: number) => Promise<boolean>): Promise<HealthRecord | null> {
  let file: string
  try { file = await healthFile(root, nonce, false) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
  let bytes: Buffer
  try {
    const info = await lstat(file)
    assert.ok(info.isFile() && info.size > 0 && info.size <= 8192, "Invalid update health file")
    bytes = await readFile(file)
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
  const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as HealthRecord
  assert.ok(record?.nonce === nonce && record.ready === true, "Update startup acknowledgement mismatch")
  for (const key of fields) assert.equal(record[key], expected[key], "Update startup identity mismatch")
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1 && await ownsProcess(record.pid), "Update acknowledgement belongs to another process")
  return record
}

type UnixHealthWaitPorts = {
  readHealthy: () => Promise<boolean>
  isAlive: () => Promise<boolean>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<unknown>
}

/** Отмена не является обычным timeout и не должна превращаться в commit при гонке с acknowledgement. */
export async function waitForUnixUpdateHealth(ports: UnixHealthWaitPorts, signal?: AbortSignal, timeout = 90_000) {
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 90_000, "Invalid update health timeout")
  const now = ports.now ?? (() => performance.now()), sleep = ports.sleep ?? Bun.sleep
  const deadline = now() + timeout
  while (now() < deadline) {
    signal?.throwIfAborted()
    const healthy = await ports.readHealthy()
    signal?.throwIfAborted()
    if (healthy) return true
    const alive = await ports.isAlive()
    signal?.throwIfAborted()
    if (!alive) return false
    const remaining = deadline - now()
    if (remaining > 0) await sleep(Math.min(250, remaining))
  }
  signal?.throwIfAborted()
  return false
}
