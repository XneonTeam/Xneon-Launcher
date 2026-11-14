import { CString, dlopen, ptr, read, type Pointer } from "bun:ffi"
import { openNativeSymbols } from "./native-symbols"
import type { MasterKeyStore } from "./unix-keyring"

let cachedStore: MasterKeyStore | undefined

/** Невариативные *_v API: не зависим от ABI вызовов с varargs в Bun FFI. */
export function createLinuxKeyring(decode: (value: string) => Buffer): MasterKeyStore | null {
  if (cachedStore) return cachedStore
  let secret: ReturnType<typeof openSecret>
  try { secret = openSecret() } catch { return null } // Только отсутствие libsecret разрешает CLI-фолбэк.
  const resources: Array<() => void> = [() => secret.close()]
  try {
    const glib = dlopen("libglib-2.0.so.0", {
      g_hash_table_new: { args: ["ptr", "ptr"], returns: "ptr" },
      g_hash_table_insert: { args: ["ptr", "ptr", "ptr"], returns: "bool" },
      g_hash_table_unref: { args: ["ptr"], returns: "void" },
      g_error_free: { args: ["ptr"], returns: "void" },
    })
    resources.push(() => glib.close())
    const symbols = openNativeSymbols("libglib-2.0.so.0")
    resources.push(() => symbols.close())
    const cstr = (value: string) => Buffer.from(value + "\0")
    const schemaName = cstr("org.xneon.launcher.SafeStorage.v1")
    const attributes = [[cstr("application"), cstr("org.xneon.launcher")], [cstr("purpose"), cstr("safeStorage-v1")]]
    // SecretSchema, ABI 64-bit: name/flags(16), 32 attributes(512), reserved(64).
    const schema = Buffer.alloc(592)
    schema.writeBigUInt64LE(BigInt(ptr(schemaName)), 0)
    schema.writeUInt32LE(2, 8) // SECRET_SCHEMA_DONT_MATCH_NAME: совместимость с secret-tool.
    attributes.forEach(([name], index) => schema.writeBigUInt64LE(BigInt(ptr(name)), 16 + index * 16))

    function call<T>(action: (table: Pointer, error: Buffer) => T): T {
      const address = glib.symbols.g_hash_table_new(symbols.get("g_str_hash"), symbols.get("g_str_equal"))
      if (!address) throw new Error("Could not allocate Secret Service attributes")
      const table = Number(address) as Pointer
      const error = Buffer.alloc(8)
      try {
        for (const [name, value] of attributes) glib.symbols.g_hash_table_insert(table, ptr(name), ptr(value))
        return action(table, error)
      } finally {
        const failure = read.ptr(ptr(error))
        if (failure) glib.symbols.g_error_free(failure as Pointer)
        glib.symbols.g_hash_table_unref(table)
      }
    }
    cachedStore = {
      read() {
        return call((table, error) => {
          const password = secret.symbols.secret_password_lookupv_sync(ptr(schema), table, null, ptr(error))
          try {
            if (read.ptr(ptr(error))) throw new Error("Secret Service lookup failed")
            return password ? decode(new CString(password).toString()) : null
          } finally { if (password) secret.symbols.secret_password_free(password) }
        })
      },
      add(key) {
        call((table, error) => {
          const password = cstr(key.toString("base64"))
          const collection = cstr("default")
          const label = cstr("Xneon Launcher safeStorage master key")
          try {
            if (!secret.symbols.secret_password_storev_sync(ptr(schema), table, ptr(collection), ptr(label), ptr(password), null, ptr(error)) || read.ptr(ptr(error))) {
              throw new Error("Secret Service store failed")
            }
          } finally { password.fill(0) }
        })
      },
      close() {
        // GObject регистрирует типы глобально: libsecret/GLib нельзя выгружать и загружать заново.
        // Удерживаем библиотеки и строку schemaName (на неё указывает schema) до выхода процесса.
        void resources
        void schemaName
      },
    }
    return cachedStore
  } catch (error) { for (const release of resources.reverse()) release(); throw error }
}

function openSecret() {
  return dlopen("libsecret-1.so.0", {
    secret_password_lookupv_sync: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "ptr" },
    secret_password_storev_sync: { args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "bool" },
    secret_password_free: { args: ["ptr"], returns: "void" },
  })
}
