import { dbHelpers } from "../../db"
import { replaceCloudConfig } from "../../db/cloud"
import { safeStorage } from "../../platform/windows-native"

const prefix = "dpapi:v1:"
const snapshots = new WeakMap<object, { providerId: string; raw: string }>()

function protectedValue(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secret storage is unavailable")
  return prefix + safeStorage.encryptString(value).toString("base64")
}

export async function readCloudToken<T>(providerId: string): Promise<T | null> {
  return readToken<T>(providerId, true)
}

async function readToken<T>(providerId: string, retryMigration: boolean): Promise<T | null> {
  const raw = await dbHelpers.getCloudConfig(providerId)
  if (!raw) return null
  try {
    const encrypted = raw.startsWith(prefix)
    const value = encrypted ? safeStorage.decryptString(Buffer.from(raw.slice(prefix.length), "base64")) : raw
    const token = JSON.parse(value) as T
    if (token === null || typeof token !== "object" || Array.isArray(token)) return null

    let current = raw
    if (!encrypted && safeStorage.isEncryptionAvailable()) {
      const replacement = protectedValue(value)
      if (!await replaceCloudConfig(providerId, raw, replacement)) return retryMigration ? readToken<T>(providerId, false) : null
      current = replacement
    }
    snapshots.set(token, { providerId, raw: current })
    return token
  } catch {
    return null
  }
}

export async function writeCloudToken<T>(providerId: string, token: T): Promise<void> {
  await dbHelpers.setCloudConfig(providerId, protectedValue(JSON.stringify(token)))
}

export async function replaceCloudToken<T extends object>(providerId: string, previous: T, token: T): Promise<void> {
  const snapshot = snapshots.get(previous)
  if (snapshot?.providerId !== providerId) throw new Error("Cloud credentials changed during refresh")
  const raw = protectedValue(JSON.stringify(token))
  if (!await replaceCloudConfig(providerId, snapshot.raw, raw)) {
    throw new Error("Cloud credentials changed during refresh")
  }
  snapshots.set(token, { providerId, raw })
}

export async function clearCloudToken(providerId: string): Promise<void> {
  await dbHelpers.removeCloudConfig(providerId)
}
