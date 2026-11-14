import { dlopen, ptr } from "bun:ffi"
import { readFile } from "node:fs/promises"

// Только системные DLL. Библиотека живёт весь процесс, HANDLE — один замер.
let kernel: ReturnType<typeof openKernel> | undefined
function openKernel() {
  return dlopen("kernel32.dll", {
    OpenProcess: { args: ["u32", "bool", "u32"], returns: "ptr" },
    CloseHandle: { args: ["ptr"], returns: "bool" },
    GetExitCodeProcess: { args: ["ptr", "ptr"], returns: "bool" },
    GetProcessTimes: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "bool" },
    K32GetProcessMemoryInfo: { args: ["ptr", "ptr", "u32"], returns: "bool" },
  })
}

export function readWindowsProcessMetrics(pid: number) {
  if (process.platform !== "win32" || !Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) return null
  try {
    const api = (kernel ??= openKernel()).symbols
    const handle = api.OpenProcess(0x1000, false, pid) // PROCESS_QUERY_LIMITED_INFORMATION
    if (!handle) return null
    try {
      const exit = new Uint32Array(1)
      if (!api.GetExitCodeProcess(handle, ptr(exit)) || exit[0] !== 259) return null
      const times = Buffer.alloc(32)
      if (!api.GetProcessTimes(handle, ptr(times), ptr(times.subarray(8)), ptr(times.subarray(16)), ptr(times.subarray(24)))) return null
      // PROCESS_MEMORY_COUNTERS_EX: DWORD cb/flags, затем SIZE_T; WorkingSetSize — offset 16.
      const memory = Buffer.alloc(80)
      memory.writeUInt32LE(memory.length)
      if (!api.K32GetProcessMemoryInfo(handle, ptr(memory), memory.length)) return null
      if (!api.GetExitCodeProcess(handle, ptr(exit)) || exit[0] !== 259) return null
      return {
        cpuMilliseconds: Number(times.readBigUInt64LE(16) + times.readBigUInt64LE(24)) / 10000,
        workingSetBytes: Number(memory.readBigUInt64LE(16)),
      }
    } finally { api.CloseHandle(handle) }
  } catch { return null } // Процесс мог исчезнуть или стать недоступным между вызовами.
}

let darwin: ReturnType<typeof openDarwin> | null | undefined
function openDarwin() {
  const system = dlopen("/usr/lib/libSystem.B.dylib", {
    mach_timebase_info: { args: ["ptr"], returns: "i32" },
  })
  try {
    const timebase = Buffer.alloc(8)
    if (system.symbols.mach_timebase_info(ptr(timebase)) !== 0) throw new Error("Mach timebase unavailable")
    const numer = BigInt(timebase.readUInt32LE(0))
    const denom = BigInt(timebase.readUInt32LE(4))
    if (!numer || !denom) throw new Error("Invalid Mach timebase")
    const proc = dlopen("/usr/lib/libproc.dylib", {
      proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
    })
    return { proc, numer, denom }
  } finally { system.close() }
}

export function readDarwinProcessMetrics(pid: number) {
  if (process.platform !== "darwin" || !Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) return null
  try {
    if (darwin === undefined) {
      darwin = null // Не повторяем неудачную инициализацию на каждом тике сэмплера.
      darwin = openDarwin()
    }
    if (!darwin) return null
    const data = Buffer.alloc(96)
    if (darwin.proc.symbols.proc_pidinfo(pid, 4, 0n, ptr(data), data.length) < data.length) return null
    const ticks = data.readBigUInt64LE(16) + data.readBigUInt64LE(24)
    const nanoseconds = ticks * darwin.numer / darwin.denom
    return {
      cpuMilliseconds: Number(nanoseconds) / 1e6,
      workingSetBytes: Number(data.readBigUInt64LE(8)),
    }
  } catch { return null }
}

let linuxUnits: { ticks: number; pageSize: number } | undefined
function getLinuxUnits() {
  if (linuxUnits) return linuxUnits
  linuxUnits = { ticks: 100, pageSize: 4096 }
  try {
    const libc = dlopen("libc.so.6", { sysconf: { args: ["i32"], returns: "i64" } })
    try {
      const ticks = Number(libc.symbols.sysconf(2)) // _SC_CLK_TCK (glibc/musl)
      const pageSize = Number(libc.symbols.sysconf(30)) // _SC_PAGESIZE
      if (Number.isSafeInteger(ticks) && ticks > 0) linuxUnits.ticks = ticks
      if (Number.isSafeInteger(pageSize) && pageSize > 0) linuxUnits.pageSize = pageSize
    } finally { libc.close() }
  } catch { /* На системах без glibc остаются стандартные 100 Гц / 4096 байт. */ }
  return linuxUnits
}

/** Поля после последней ')' начинаются с state (поле 3), utime/stime — поля 14/15. */
export function parseLinuxProcessMetrics(stat: string, statm: string, ticks: number, pageSize: number) {
  try {
    const end = stat.lastIndexOf(")")
    if (end < 0 || stat.indexOf("(") < 0) return null
    const fields = stat.slice(end + 1).trim().split(/\s+/)
    const pages = statm.trim().split(/\s+/)[1]
    if (["Z", "X", "x"].includes(fields[0])) return null
    if (!/^\d+$/.test(fields[11] ?? "") || !/^\d+$/.test(fields[12] ?? "") || !/^\d+$/.test(pages ?? "")) return null
    if (!Number.isSafeInteger(ticks) || ticks <= 0 || !Number.isSafeInteger(pageSize) || pageSize <= 0) return null
    const cpuMilliseconds = Number(BigInt(fields[11]) + BigInt(fields[12])) * 1000 / ticks
    const workingSetBytes = Number(BigInt(pages) * BigInt(pageSize))
    if (!Number.isFinite(cpuMilliseconds) || !Number.isSafeInteger(workingSetBytes)) return null
    return { cpuMilliseconds, workingSetBytes }
  } catch { return null }
}

export async function readLinuxProcessMetrics(pid: number) {
  if (process.platform !== "linux" || !Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) return null
  try {
    const [stat, statm] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"), readFile(`/proc/${pid}/statm`, "utf8"),
    ])
    const { ticks, pageSize } = getLinuxUnits()
    return parseLinuxProcessMetrics(stat, statm, ticks, pageSize)
  } catch { return null } // ENOENT/ESRCH, недоступный /proc, завершение процесса.
}

/** Общий порт: накопленное CPU-время в мс и резидентная память в байтах. */
export function readProcessMetrics(pid: number) {
  switch (process.platform) {
    case "win32": return readWindowsProcessMetrics(pid)
    case "darwin": return readDarwinProcessMetrics(pid)
    case "linux": return readLinuxProcessMetrics(pid)
    default: return null
  }
}
