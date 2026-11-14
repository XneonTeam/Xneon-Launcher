import { dlopen, ptr } from "bun:ffi"

const roots = [
  "SOFTWARE\\JavaSoft\\Java Runtime Environment", "SOFTWARE\\JavaSoft\\Java Development Kit",
  "SOFTWARE\\JavaSoft\\JRE", "SOFTWARE\\JavaSoft\\JDK",
  "SOFTWARE\\Eclipse Adoptium", "SOFTWARE\\Eclipse Foundation", "SOFTWARE\\AdoptOpenJDK",
  "SOFTWARE\\Azul Systems\\Zulu", "SOFTWARE\\Amazon Corretto", "SOFTWARE\\BellSoft\\Liberica",
  "SOFTWARE\\Microsoft\\JDK",
]

/** Только чтение HKLM: WOW64-представления выбираем флагами, без ручного WOW6432Node. */
export function readJavaHomesFromRegistry(): string[] {
  if (process.platform !== "win32") return []
  const api = dlopen("advapi32.dll", {
    RegOpenKeyExW: { args: ["ptr", "ptr", "u32", "u32", "ptr"], returns: "i32" },
    RegEnumKeyExW: { args: ["ptr", "u32", "ptr", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    RegGetValueW: { args: ["ptr", "ptr", "ptr", "u32", "ptr", "ptr", "ptr"], returns: "i32" },
    RegCloseKey: { args: ["ptr"], returns: "i32" },
  })
  const wide = (value: string) => Buffer.from(value + "\0", "utf16le")
  const found = new Map<string, string>()
  let visited = 0
  const visit = (parent: bigint, name: string, view: number, depth: number) => {
    if (depth > 16 || ++visited > 8192) return
    const handle = new BigUint64Array(1)
    const keyName = wide(name)
    const status = api.symbols.RegOpenKeyExW(parent, ptr(keyName), 0, 0x20019 | view, ptr(handle))
    if (status !== 0) return // В том числе ERROR_FILE_NOT_FOUND (2) и ACCESS_DENIED.
    const key = handle[0]
    try {
      for (const valueName of ["JavaHome", "Path", "InstallationPath"]) {
        const value = wide(valueName)
        const size = new Uint32Array(1)
        // RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ; переменные REG_EXPAND_SZ раскрывает Windows.
        if (api.symbols.RegGetValueW(key, null, ptr(value), 6, null, null, ptr(size)) !== 0) continue
        if (size[0] < 2 || size[0] > 128 * 1024) continue
        const data = Buffer.alloc(size[0])
        if (api.symbols.RegGetValueW(key, null, ptr(value), 6, null, ptr(data), ptr(size)) !== 0) continue
        const home = data.subarray(0, Math.min(size[0], data.length)).toString("utf16le").replace(/\0+$/, "").trim()
        if (home) found.set(home.toLowerCase(), home)
      }
      for (let index = 0; index < 8192; index++) {
        const name = Buffer.alloc(512) // Максимальная длина имени ключа — 255 символов.
        const length = new Uint32Array([256])
        const result = api.symbols.RegEnumKeyExW(key, index, ptr(name), ptr(length), null, null, null, null)
        if (result !== 0) break // ERROR_NO_MORE_ITEMS (259), либо ключ стал недоступен.
        visit(key, name.subarray(0, length[0] * 2).toString("utf16le"), view, depth + 1)
      }
    } finally { api.symbols.RegCloseKey(key) }
  }
  try {
    for (const view of [0x0100, 0x0200]) {
      for (const root of roots) visit(0xffffffff80000002n, root, view, 0) // HKEY_LOCAL_MACHINE
    }
    return [...found.values()]
  } finally { api.close() }
}
