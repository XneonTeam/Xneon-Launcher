import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { acquireUnixFileLock, unixPrivateDirectory } from "./unix-file-lock"
import { createDarwinKeyring } from "./darwin-keyring"
import { createLinuxKeyring } from "./linux-keyring"

export interface MasterKeyStore { read(): Buffer | null; add(key: Buffer): void; close?(): void }
const unavailable = "OS keyring is unavailable or locked; unlock Keychain/Secret Service to use safeStorage"
const decode = (value: string) => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("Invalid keyring master key")
  const key = Buffer.from(value, "base64")
  if (key.length !== 32) throw new Error("Invalid keyring master key")
  return key
}

function secretToolStore(): MasterKeyStore {
  const tool = Bun.which("secret-tool")
  if (!tool) throw new Error(unavailable)
  const args = ["application", "org.xneon.launcher", "purpose", "safeStorage-v1"]
  return {
    read() {
      try { return decode(execFileSync(tool, ["lookup", ...args], { encoding: "utf8", timeout: 8000, maxBuffer: 4096, stdio: ["pipe", "pipe", "pipe"] }).trim()) }
      catch (error) {
        const result = error as { status?: number; stderr?: Buffer | string }
        if (result.status === 1 && !result.stderr?.toString().trim()) return null
        throw new Error(unavailable)
      }
    },
    add(key) {
      // Ключ передаётся через stdin, никогда через argv или лог.
      execFileSync(tool, ["store", "--label=Xneon Launcher safeStorage master key", ...args], {
        input: key.toString("base64"), timeout: 8000, maxBuffer: 4096, stdio: ["pipe", "pipe", "pipe"],
      })
    },
  }
}

export function loadOrCreateMasterKey(): Buffer {
  if (!["darwin", "linux"].includes(process.platform)) throw new Error(unavailable)
  const release = acquireUnixFileLock(path.join(unixPrivateDirectory(), "keyring-v1.lock"))
  if (!release) throw new Error("OS keyring initialization is busy; retry safeStorage")
  let store: MasterKeyStore | undefined
  try {
    if (process.platform === "darwin") store = createDarwinKeyring()
    else store = createLinuxKeyring(decode) ?? secretToolStore()
    let key = store.read()
    if (!key) {
      key = randomBytes(32)
      try { store.add(key) } finally { key.fill(0) }
      // Не кэшируем неподтверждённый ключ и никогда не перезаписываем существующий при чтении.
      key = store.read()
    }
    if (!key || key.length !== 32) throw new Error(unavailable)
    return key
  } catch { throw new Error(unavailable) }
  finally { try { store?.close?.() } finally { release() } }
}
