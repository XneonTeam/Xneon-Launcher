import { dlopen, ptr } from "bun:ffi"
import { readFileSync, readlinkSync, realpathSync } from "node:fs"
import path from "node:path"

const maxArgumentsBytes = 1024 * 1024

export function parseLinuxCmdline(buffer: Buffer): string[] {
  if (!buffer.length || buffer.length > maxArgumentsBytes || buffer[buffer.length - 1] !== 0) return []
  const argv = buffer.subarray(0, -1).toString("utf8").split("\0")
  return argv.slice(1) // Не теряем пустые аргументы внутри argv.
}

export function parseDarwinProcArgs(buffer: Buffer): string[] {
  if (buffer.length < 5 || buffer.length > maxArgumentsBytes) return []
  const argc = buffer.readInt32LE(0)
  if (argc < 1 || argc > 65536) return []
  const executableEnd = buffer.indexOf(0, 4)
  if (executableEnd <= 4) return []
  let offset = executableEnd + 1
  // Между exec_path и argv[0] находится padding из нулей; внутри argv пустые строки допустимы.
  while (offset < buffer.length && buffer[offset] === 0) offset++
  const argv: string[] = []
  for (let index = 0; index < argc; index++) {
    const end = buffer.indexOf(0, offset)
    if (end < 0) return []
    argv.push(buffer.subarray(offset, end).toString("utf8"))
    offset = end + 1
  }
  return argv.slice(1) // Не включаем переменные окружения, следующие за argc аргументами.
}

let darwin: ReturnType<typeof openDarwin> | undefined
function openDarwin() {
  const proc = dlopen("/usr/lib/libproc.dylib", {
    proc_pidpath: { args: ["i32", "ptr", "u32"], returns: "i32" },
  })
  try {
    const system = dlopen("/usr/lib/libSystem.B.dylib", {
      sysctl: { args: ["ptr", "u32", "ptr", "ptr", "ptr", "u64"], returns: "i32" },
    })
    return { proc, system }
  } catch (error) { proc.close(); throw error }
}

/** Принимаем аргументы только от подтверждённого executable рядом с упакованным Bun. */
export function readUnixLauncherArgs(): string[] {
  if (!["linux", "darwin"].includes(process.platform) || !Number.isInteger(process.ppid) || process.ppid <= 0) return []
  try {
    const expected = realpathSync(path.join(path.dirname(process.execPath), "launcher"))
    if (process.platform === "linux") {
      const executable = `/proc/${process.ppid}/exe`
      if (realpathSync(readlinkSync(executable)) !== expected) return []
      const command = readFileSync(`/proc/${process.ppid}/cmdline`)
      if (realpathSync(readlinkSync(executable)) !== expected) return []
      return parseLinuxCmdline(command)
    }
    const api = darwin ??= openDarwin()
    const matchesParent = () => {
      const executable = Buffer.alloc(4096)
      const length = api.proc.symbols.proc_pidpath(process.ppid, ptr(executable), executable.length)
      if (length <= 0 || length > executable.length) return false
      return realpathSync(executable.subarray(0, length).toString("utf8").replace(/\0+$/, "")) === expected
    }
    if (!matchesParent()) return []
    const mib = new Int32Array([1, 49, process.ppid]) // CTL_KERN, KERN_PROCARGS2
    const size = new BigUint64Array(1)
    if (api.system.symbols.sysctl(ptr(mib), mib.length, null, ptr(size), null, 0n) !== 0) return []
    const bytes = Number(size[0])
    if (!Number.isSafeInteger(bytes) || bytes < 5 || bytes > maxArgumentsBytes) return []
    const command = Buffer.alloc(bytes)
    if (api.system.symbols.sysctl(ptr(mib), mib.length, ptr(command), ptr(size), null, 0n) !== 0 || size[0] > BigInt(bytes)) return []
    if (!matchesParent()) return []
    return parseDarwinProcArgs(command.subarray(0, Number(size[0])))
  } catch { return [] } // Родитель мог завершиться, путь/аргументы могут быть недоступны.
}
