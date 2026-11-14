import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { randomBytes } from "node:crypto"
import { createUnixSafeStorage } from "../../electrobun/platform/unix-safe-storage.ts"

test("единый safeStorage имеет Unix-адаптер, не меняя Windows DPAPI", () => {
  const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
  assert.equal(source.includes("unixSafeStorage"), true)
  assert.equal(source.includes("CryptProtectData"), true)
})

for (const text of ["", "Обычный секрет 🔐 尾\n\0", "ASCII"]) {
  test(`AES-GCM: Unicode/пустая строка (${text.length}) и Async-контракт`, async () => {
    let loads = 0
    const key = randomBytes(32)
    const storage = createUnixSafeStorage(() => { loads++; return key })
    const first = storage.encryptString(text)
    const second = await storage.encryptStringAsync(text)
    assert.equal(first.subarray(0, 20).toString(), "XNLC:v1:aes-256-gcm\0")
    assert.equal(storage.decryptString(first), text)
    assert.equal((await storage.decryptStringAsync(second)).result, text)
    assert.equal(first.equals(second), false)
    assert.equal(loads, 1)
    assert.equal(createUnixSafeStorage(() => Buffer.from(key)).decryptString(first), text)
  })
}

test("AES-GCM отклоняет подмену header, IV, authTag и ciphertext", () => {
  const storage = createUnixSafeStorage(() => randomBytes(32))
  const original = storage.encryptString("секрет")
  for (const index of [0, 20, 32, original.length - 1]) {
    const changed = Buffer.from(original)
    changed[index] ^= 1
    assert.throws(() => storage.decryptString(changed))
  }
  assert.throws(() => createUnixSafeStorage(() => randomBytes(32)).decryptString(original), /authentication failed/)
  assert.throws(() => storage.decryptString(original.subarray(0, 30)), /Unsupported/)
  assert.throws(() => storage.decryptString(Buffer.from("DPAPI or plaintext")), /Unsupported/)
})

test("недоступный кейринг: false и явный отказ, без plaintext-фолбэка", () => {
  let available = false
  const storage = createUnixSafeStorage(() => {
    if (!available) throw new Error("OS keyring is locked")
    return randomBytes(32)
  })
  assert.equal(storage.isEncryptionAvailable(), false)
  assert.throws(() => storage.encryptString("private"), /keyring is locked/)
  available = true
  assert.equal(storage.isEncryptionAvailable(), true)
  assert.equal(storage.decryptString(storage.encryptString("")), "")
  assert.throws(() => createUnixSafeStorage(() => Buffer.alloc(16)).encryptString("x"), /Invalid/)
})
