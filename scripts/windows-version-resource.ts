import path from "node:path"

const align = (length: number) => (length + 3) & ~3
const wide = (value: string) => Buffer.from(value + "\0", "utf16le")

/** VERSIONINFO состоит из DWORD-выровненных блоков; текстовая длина задаётся в WCHAR. */
function block(key: string, value: Buffer, text: boolean, children: Buffer[] = []): Buffer {
  const name = wide(key), valueOffset = align(6 + name.length)
  const bytes = Buffer.alloc(align(valueOffset + value.length) + children.reduce((size, child) => size + align(child.length), 0))
  bytes.writeUInt16LE(bytes.length)
  bytes.writeUInt16LE(text ? value.length / 2 : value.length, 2)
  bytes.writeUInt16LE(text ? 1 : 0, 4)
  name.copy(bytes, 6)
  value.copy(bytes, valueOffset)
  let offset = align(valueOffset + value.length)
  for (const child of children) { child.copy(bytes, offset); offset += align(child.length) }
  return bytes
}

export function createWindowsVersionResource(version: string): Buffer {
  if (!/^\d+\.\d+\.\d+(?:-pre\d+)?$/.test(version)) throw new Error("Invalid launcher version")
  const parts = version.split("-")[0]!.split(".").map(Number)
  if (parts.some(value => value > 65535)) throw new Error("Windows version component exceeds WORD range")
  const high = parts[0]! * 65536 + parts[1]!, low = parts[2]! * 65536
  const fixed = Buffer.alloc(52)
  // VS_FIXEDFILEINFO: NT/Win32, application, без специальных flags/subtype/date.
  ;[0xfeef04bd, 0x10000, high, low, high, low, 0x3f, 0, 0x40004, 1, 0, 0, 0]
    .forEach((value, index) => fixed.writeUInt32LE(value, index * 4))
  const strings = {
    CompanyName: "Xneon Launcher", FileDescription: "Xneon Launcher",
    FileVersion: parts.join(".") + ".0", InternalName: "Xneon Launcher.dll",
    OriginalFilename: "Xneon Launcher.dll", ProductName: "Xneon Launcher", ProductVersion: version,
  }
  return block("VS_VERSION_INFO", fixed, false, [
    block("StringFileInfo", Buffer.alloc(0), true, [
      block("040904B0", Buffer.alloc(0), true, Object.entries(strings).map(([key, value]) => block(key, wide(value), true))),
    ]),
    block("VarFileInfo", Buffer.alloc(0), true, [block("Translation", Buffer.from([9, 4, 176, 4]), false)]),
  ])
}

/** Меняет только VERSIONINFO (RT_VERSION/1), не затрагивая иконки и остальные ресурсы PE. */
export async function setWindowsExecutableVersion(file: string, version: string): Promise<void> {
  const data = createWindowsVersionResource(version)
  if (process.platform !== "win32") throw new Error("Windows resource updates require Windows")
  const { dlopen, ptr, JSCallback } = await import("bun:ffi")
  const api = dlopen("kernel32.dll", {
    LoadLibraryExW: { args: ["ptr", "ptr", "u32"], returns: "ptr" },
    FreeLibrary: { args: ["ptr"], returns: "bool" },
    EnumResourceLanguagesW: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "bool" },
    BeginUpdateResourceW: { args: ["ptr", "bool"], returns: "ptr" },
    UpdateResourceW: { args: ["ptr", "ptr", "ptr", "u16", "ptr", "u32"], returns: "bool" },
    EndUpdateResourceW: { args: ["ptr", "bool"], returns: "bool" },
    GetLastError: { args: [], returns: "u32" },
  })
  const name = wide(path.resolve(file))
  const resourceType = 16 as import("bun:ffi").Pointer, resourceId = 1 as import("bun:ffi").Pointer
  const fail = (operation: string) => new Error(`${operation} failed for ${file} (Win32 ${api.symbols.GetLastError()})`)
  try {
    const module = api.symbols.LoadLibraryExW(ptr(name), null, 2)
    if (!module) throw fail("LoadLibraryExW")
    const languages: number[] = []
    const callback = new JSCallback((_module, _type, _id, language) => { languages.push(language); return true }, {
      args: ["ptr", "ptr", "ptr", "u16", "ptr"], returns: "bool",
    })
    try {
      if (!api.symbols.EnumResourceLanguagesW(module, resourceType, resourceId, callback.ptr, null)) {
        const code = api.symbols.GetLastError()
        // PE без VERSIONINFO допустим; остальные ошибки не скрываем.
        if (![1812, 1813, 1814, 1815].includes(code)) throw fail("EnumResourceLanguagesW")
      }
    } finally { callback.close(); api.symbols.FreeLibrary(module) }
    let update = api.symbols.BeginUpdateResourceW(ptr(name), false)
    if (!update) throw fail("BeginUpdateResourceW")
    try {
      for (const language of languages) {
        if (!api.symbols.UpdateResourceW(update, resourceType, resourceId, language, null, 0)) throw fail("Delete version resource")
      }
      if (!api.symbols.UpdateResourceW(update, resourceType, resourceId, 1033, ptr(data), data.length)) throw fail("UpdateResourceW")
      const handle = update
      update = null
      if (!api.symbols.EndUpdateResourceW(handle, false)) throw fail("EndUpdateResourceW")
    } finally { if (update) api.symbols.EndUpdateResourceW(update, true) }
  } finally { api.close() }
}
