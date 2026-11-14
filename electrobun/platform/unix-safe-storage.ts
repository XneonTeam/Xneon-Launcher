import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { loadOrCreateMasterKey } from "./unix-keyring"

const header = Buffer.from("XNLC:v1:aes-256-gcm\0", "ascii")

/** Windows продолжает использовать исходные DPAPI-блобы. Этот формат — только Unix. */
export function createUnixSafeStorage(loadKey: () => Buffer) {
  let cached: Buffer | undefined
  const key = () => {
    if (!cached) {
      const loaded = loadKey()
      if (!Buffer.isBuffer(loaded) || loaded.length !== 32) throw new Error("Invalid safeStorage master key")
      cached = Buffer.from(loaded)
    }
    return cached
  }
  return {
    isEncryptionAvailable() { try { key(); return true } catch { return false } },
    encryptString(value: string): Buffer {
      const master = key()
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", master, iv)
      cipher.setAAD(header)
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
      return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext])
    },
    decryptString(blob: Buffer): string {
      if (!Buffer.isBuffer(blob) || blob.length < header.length + 28 || !blob.subarray(0, header.length).equals(header)) {
        throw new Error("Unsupported safeStorage blob: expected Unix v1 AES-GCM; Windows DPAPI requires the original Windows user")
      }
      const decipher = createDecipheriv("aes-256-gcm", key(), blob.subarray(header.length, header.length + 12))
      decipher.setAAD(header)
      decipher.setAuthTag(blob.subarray(header.length + 12, header.length + 28))
      try { return Buffer.concat([decipher.update(blob.subarray(header.length + 28)), decipher.final()]).toString("utf8") }
      catch { throw new Error("safeStorage authentication failed: corrupted data or wrong master key") }
    },
    async encryptStringAsync(value: string) { return this.encryptString(value) },
    async decryptStringAsync(value: Buffer) { return { result: this.decryptString(value) } },
  }
}

export const unixSafeStorage = createUnixSafeStorage(loadOrCreateMasterKey)
