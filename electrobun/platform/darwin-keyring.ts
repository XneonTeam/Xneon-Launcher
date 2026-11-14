import { dlopen, ptr, toArrayBuffer, type Pointer } from "bun:ffi"
import { openNativeSymbols } from "./native-symbols"
import type { MasterKeyStore } from "./unix-keyring"

const securityPath = "/System/Library/Frameworks/Security.framework/Security"
const cfPath = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"

export function createDarwinKeyring(): MasterKeyStore {
  const security = dlopen(securityPath, {
    SecItemCopyMatching: { args: ["ptr", "ptr"], returns: "i32" },
    SecItemAdd: { args: ["ptr", "ptr"], returns: "i32" },
  })
  const resources: Array<() => void> = [() => security.close()]
  try {
    const cf = dlopen(cfPath, {
      CFDictionaryCreateMutable: { args: ["ptr", "i64", "ptr", "ptr"], returns: "ptr" },
      CFDictionarySetValue: { args: ["ptr", "ptr", "ptr"], returns: "void" },
      CFStringCreateWithCString: { args: ["ptr", "ptr", "u32"], returns: "ptr" },
      CFDataCreate: { args: ["ptr", "ptr", "i64"], returns: "ptr" },
      CFDataGetLength: { args: ["ptr"], returns: "i64" },
      CFDataGetBytePtr: { args: ["ptr"], returns: "ptr" },
      CFRelease: { args: ["ptr"], returns: "void" },
    })
    resources.push(() => cf.close())
    const secSymbols = openNativeSymbols(securityPath)
    resources.push(() => secSymbols.close())
    const cfSymbols = openNativeSymbols(cfPath)
    resources.push(() => cfSymbols.close())
    const sec = (name: string) => secSymbols.get(name, true)
    const value = (dictionary: Pointer, name: string, data: Pointer) => cf.symbols.CFDictionarySetValue(dictionary, sec(name), data)

    function query<T>(action: (dictionary: Pointer, own: (item: Pointer | bigint | null) => Pointer) => T): T {
      const owned: Pointer[] = []
      const own = (item: Pointer | bigint | null) => {
        if (!item) throw new Error("Could not allocate Keychain query")
        const address = Number(item) as Pointer
        owned.push(address)
        return address
      }
      try {
        const dictionary = own(cf.symbols.CFDictionaryCreateMutable(null, 0, cfSymbols.get("kCFTypeDictionaryKeyCallBacks"), cfSymbols.get("kCFTypeDictionaryValueCallBacks")))
        value(dictionary, "kSecClass", sec("kSecClassGenericPassword"))
        for (const [name, text] of [["kSecAttrService", "org.xneon.launcher.safeStorage.v1"], ["kSecAttrAccount", "master-key"]]) {
          const string = Buffer.from(text + "\0")
          value(dictionary, name, own(cf.symbols.CFStringCreateWithCString(null, ptr(string), 0x08000100)))
        }
        return action(dictionary, own)
      } finally { for (const item of owned.reverse()) cf.symbols.CFRelease(item) }
    }
    return {
      read() {
        return query(dictionary => {
          value(dictionary, "kSecReturnData", cfSymbols.get("kCFBooleanTrue", true))
          value(dictionary, "kSecMatchLimit", sec("kSecMatchLimitOne"))
          const output = new BigUint64Array(1)
          const status = security.symbols.SecItemCopyMatching(dictionary, ptr(output))
          const result = output[0] ? Number(output[0]) as Pointer : null
          try {
            if (status === -25300) return null // errSecItemNotFound
            if (status !== 0 || !result) throw new Error("Keychain lookup failed: " + status)
            if (Number(cf.symbols.CFDataGetLength(result)) !== 32) throw new Error("Invalid Keychain master key")
            const data = cf.symbols.CFDataGetBytePtr(result)
            if (!data) throw new Error("Keychain data is unavailable")
            return Buffer.from(new Uint8Array(toArrayBuffer(data, 0, 32)))
          } finally { if (result) cf.symbols.CFRelease(result) }
        })
      },
      add(key) {
        query((dictionary, own) => {
          value(dictionary, "kSecValueData", own(cf.symbols.CFDataCreate(null, ptr(key), key.length)))
          const status = security.symbols.SecItemAdd(dictionary, null)
          if (status !== 0 && status !== -25299) throw new Error("Keychain store failed: " + status)
          // При duplicate item читаем существующий ключ, не перезаписываем его.
        })
      },
      close() { for (const release of resources.reverse()) release() },
    }
  } catch (error) { for (const release of resources.reverse()) release(); throw error }
}
