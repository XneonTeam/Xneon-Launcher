import { dlopen, ptr } from "bun:ffi"
import path from "node:path"

let native: ReturnType<typeof openNative> | undefined
function openNative() {
  const kernel = dlopen("kernel32.dll", {
    OpenProcess: { args: ["u32", "bool", "u32"], returns: "ptr" },
    CloseHandle: { args: ["ptr"], returns: "bool" },
    QueryFullProcessImageNameW: { args: ["ptr", "u32", "ptr", "ptr"], returns: "bool" },
  })
  try {
    const nt = dlopen("ntdll.dll", {
      NtQueryInformationProcess: { args: ["ptr", "u32", "ptr", "u32", "ptr"], returns: "i32" },
    })
    return { kernel: kernel.symbols, nt: nt.symbols }
  } catch (error) { kernel.close(); throw error }
}

/** Запрашивает только командную строку процесса с ожидаемым путём EXE. Чужую память не читает. */
export function readWindowsProcessCommandLine(pid: number, expectedExecutable: string): string | null {
  if (process.platform !== "win32" || !Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) return null
  try {
    const api = native ??= openNative()
    const handle = api.kernel.OpenProcess(0x1000, false, pid)
    if (!handle) return null
    try {
      const image = Buffer.alloc(32768 * 2)
      const chars = new Uint32Array([32768])
      if (!api.kernel.QueryFullProcessImageNameW(handle, 0, ptr(image), ptr(chars))) return null
      const normalize = (value: string) => path.win32.resolve(value.replace(/^\\\\\?\\/, "")).toLowerCase()
      if (normalize(image.subarray(0, chars[0] * 2).toString("utf16le")) !== normalize(expectedExecutable)) return null
      const required = new Uint32Array(1)
      api.nt.NtQueryInformationProcess(handle, 60, null, 0, ptr(required))
      for (let attempt = 0; attempt < 3; attempt++) {
        const size = required[0]
        if (size < 16 || size > 256 * 1024) return null
        const data = Buffer.alloc(size)
        const status = api.nt.NtQueryInformationProcess(handle, 60, ptr(data), size, ptr(required))
        if (status < 0) {
          if (required[0] > size) continue
          return null
        }
        // UNICODE_STRING содержит указатель внутрь нашего буфера, не в память родителя.
        const length = data.readUInt16LE(0)
        const address = data.readBigUInt64LE(8)
        const offset = Number(address - BigInt(ptr(data)))
        if (length % 2 || length > data.readUInt16LE(2) || offset < 16 || offset + length > data.length) return null
        return data.subarray(offset, offset + length).toString("utf16le")
      }
      return null
    } finally { api.kernel.CloseHandle(handle) }
  } catch { return null } // Родитель мог завершиться, NT API может быть недоступен.
}
