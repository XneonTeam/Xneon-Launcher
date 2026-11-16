// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { randomBytes } from "node:crypto"
import { transformSync } from "esbuild"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { safeStorage } from "../../electrobun/platform/windows-native.ts"
import { dlopen, ptr, read, toArrayBuffer } from "bun:ffi"
import { createUnixSafeStorage } from "../../electrobun/platform/unix-safe-storage.ts"

{
  describe("darwin-keyring", () => {
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
  })
}

{
  describe("windows-dpapi", () => {
    test("DPAPI не запускает внешний процесс", () => {
      const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
      const body = source.match(/function protect\([\s\S]*?\n\}/)[0]
      assert.doesNotMatch(body, /spawnSync|powershell|ProtectedData/)
    })

    for (const value of ["", "секрет 🔐 — +/=\n\0尾", "plain ASCII"]) {
      test(`DPAPI: UTF-8 и совместимость .NET (${value.length} символов)`, { skip: process.platform !== "win32" }, async () => {
        const encrypted = safeStorage.encryptString(value)
        assert.equal(safeStorage.decryptString(encrypted), value)
        assert.equal((await safeStorage.decryptStringAsync(await safeStorage.encryptStringAsync(value))).result, value)
        const powershell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe")
        const legacy = operation => {
          const input = operation === "Protect" ? Buffer.from(value) : encrypted
          const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
            "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::ReadLine()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::" + operation + "($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"],
          { input: input.toString("base64") + "\n", encoding: "utf8", windowsHide: true, timeout: 15000 })
          assert.equal(result.status, 0)
          return Buffer.from(result.stdout.trim(), "base64")
        }
        assert.equal(safeStorage.decryptString(legacy("Protect")), value)
        assert.equal(legacy("Unprotect").toString("utf8"), value)
      })
    }

    test("повреждённый DPAPI-блоб отклоняется", { skip: process.platform !== "win32" }, () => {
      assert.throws(() => safeStorage.decryptString(Buffer.from("invalid")), /DPAPI/)
    })
    test("DPAPI освобождает выходной буфер даже при ошибке копирования", { skip: process.platform !== "win32" }, () => {
      let freed = 0
      const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
      const body = source.match(/function protect\([\s\S]*?\n\}/)[0]
      const code = transformSync(body + "\nmodule.exports = protect", { loader: "ts", format: "cjs" }).code
      const module = { exports: {} }
      vm.runInNewContext(code, { module, Buffer, process, ptr, read,
        toArrayBuffer: () => { throw new Error("copy failed") },
        dlopen: (file, symbols) => {
          const library = dlopen(file, symbols)
          if (file !== "kernel32.dll") return library
          return { close: () => library.close(), symbols: { ...library.symbols,
            LocalFree: data => { freed++; return library.symbols.LocalFree(data) },
          } }
        },
      })
      assert.throws(() => module.exports(Buffer.from("test"), "Protect"), /copy failed/)
      assert.equal(freed, 1)
    })
  })
}

{
  describe("unix-safe-storage", () => {
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
  })
}
