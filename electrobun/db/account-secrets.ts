type SecretStorage = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
const PREFIX = "xnlc-secret:v1:"
let storage: SecretStorage | undefined

export function configureAccountSecrets(port: SecretStorage): void { storage = port }
export function protectAccountSecret(value: string | null | undefined, preserveEnvelope = false): string | null {
  if (value == null) return null
  if (preserveEnvelope && value.startsWith(PREFIX)) return value
  if (!storage?.isEncryptionAvailable()) {
    if (value.startsWith(PREFIX)) throw new Error("Account secret storage is unavailable")
    return value
  }
  const encoded = storage.encryptString(value)
  // Проверяем обратимость ДО замены plaintext в SQLite.
  if (storage.decryptString(encoded) !== value) throw new Error("Account secret round-trip verification failed")
  return PREFIX + encoded.toString("base64")
}
export function readAccountSecret(value: string | null | undefined): string | undefined {
  if (value == null) return undefined
  if (!value.startsWith(PREFIX)) return value
  if (!storage?.isEncryptionAvailable()) throw new Error("Account secret storage is unavailable")
  return storage.decryptString(Buffer.from(value.slice(PREFIX.length), "base64"))
}
