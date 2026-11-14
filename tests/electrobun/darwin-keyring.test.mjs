import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { randomBytes } from "node:crypto"
import { transformSync } from "esbuild"

test("Keychain: SecItemAdd/CopyMatching, бинарный мастер-ключ и освобождение CF-объектов", () => {
  const source = fs.readFileSync(new URL("../../electrobun/platform/darwin-keyring.ts", import.meta.url), "utf8")
  const module = { exports: {} }
  const allocated = new Map()
  let next = 100
  let secret = null
  let status = 0
  let closed = 0
  const allocate = data => { const id = ++next; allocated.set(id, data); return id }
  const cf = {
    CFDictionaryCreateMutable: () => allocate(new Map()),
    CFDictionarySetValue: (dictionary, key, value) => allocated.get(dictionary).set(key, value),
    CFStringCreateWithCString: (_allocator, buffer) => allocate(buffer.toString("utf8").replace(/\0$/, "")),
    CFDataCreate: (_allocator, buffer, length) => allocate(Buffer.from(buffer.subarray(0, length))),
    CFDataGetLength: data => allocated.get(data).length,
    CFDataGetBytePtr: data => allocated.get(data),
    CFRelease: data => assert.ok(allocated.delete(data)),
  }
  const checkQuery = dictionary => {
    const query = allocated.get(dictionary)
    assert.equal(query.get("kSecClass"), "kSecClassGenericPassword")
    assert.equal(allocated.get(query.get("kSecAttrService")), "org.xneon.launcher.safeStorage.v1")
    assert.equal(allocated.get(query.get("kSecAttrAccount")), "master-key")
    return query
  }
  const security = {
    SecItemCopyMatching: (dictionary, output) => {
      const query = checkQuery(dictionary)
      assert.equal(query.get("kSecReturnData"), "kCFBooleanTrue")
      if (status) return status
      if (!secret) return -25300
      output[0] = BigInt(allocate(Buffer.from(secret)))
      return 0
    },
    SecItemAdd: dictionary => {
      const query = checkQuery(dictionary)
      if (secret) return -25299
      secret = Buffer.from(allocated.get(query.get("kSecValueData")))
      return 0
    },
  }
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, { module, Buffer, require: name => {
    if (name === "./native-symbols") return { openNativeSymbols: () => ({ get: value => value, close: () => closed++ }) }
    return {
      ptr: value => value,
      toArrayBuffer: (value, offset, size) => value.buffer.slice(value.byteOffset + offset, value.byteOffset + offset + size),
      dlopen: file => ({ symbols: file.includes("CoreFoundation") ? cf : security, close: () => closed++ }),
    }
  } })
  const store = module.exports.createDarwinKeyring()
  assert.equal(store.read(), null)
  assert.equal(allocated.size, 0)
  const key = randomBytes(32)
  store.add(key)
  assert.equal(allocated.size, 0)
  assert.deepEqual(store.read(), key)
  store.add(randomBytes(32)) // Дубликат не перезаписывает мастер-ключ.
  assert.deepEqual(store.read(), key)
  secret = Buffer.alloc(16)
  assert.throws(store.read, /Invalid Keychain master key/)
  assert.equal(allocated.size, 0)
  status = -25308 // errSecInteractionNotAllowed / закрытый keychain
  assert.throws(store.read, /Keychain lookup failed/)
  assert.equal(allocated.size, 0)
  store.close()
  assert.equal(closed, 4)
})
