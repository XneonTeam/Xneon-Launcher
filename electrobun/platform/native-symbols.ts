import { dlopen, ptr, read, type Pointer } from "bun:ffi"

/** Адреса констант/колбэков из системных библиотек; не вызываем переменные как функции. */
export function openNativeSymbols(file: string) {
  const linker = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libdl.so.2", {
    dlopen: { args: ["ptr", "i32"], returns: "ptr" },
    dlsym: { args: ["ptr", "ptr"], returns: "ptr" },
    dlclose: { args: ["ptr"], returns: "i32" },
  })
  const filename = Buffer.from(file + "\0")
  const handle = linker.symbols.dlopen(ptr(filename), 1)
  if (!handle) { linker.close(); throw new Error("System library is unavailable: " + file) }
  return {
    get(name: string, indirect = false): Pointer {
      const text = Buffer.from(name + "\0")
      const address = linker.symbols.dlsym(handle, ptr(text))
      if (!address) throw new Error("System symbol is unavailable: " + name)
      return indirect ? read.ptr(address) as Pointer : Number(address) as Pointer
    },
    close() { try { linker.symbols.dlclose(handle) } finally { linker.close() } },
  }
}
