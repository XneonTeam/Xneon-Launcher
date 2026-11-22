import assert from "node:assert/strict"
import { dlopen, ptr, read } from "bun:ffi"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** Атомарно меняет два существующих имени; target никогда не исчезает из Finder/desktop entry. */
export function exchangeUnixUpdatePaths(left: string, right: string) {
  assert.ok(process.platform === "linux" || process.platform === "darwin", "Native Unix atomic exchange required")
  for (const file of [left, right]) assert.ok(path.isAbsolute(file) && !file.includes("\0"), "Invalid atomic update path")
  const mac = process.platform === "darwin", name = mac ? "renameatx_np" : "renameat2", errnoName = mac ? "__error" : "__errno_location"
  const library = dlopen(mac ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    [name]: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
    [errnoName]: { args: [], returns: "ptr" },
  })
  try {
    const a = Buffer.from(left + "\0"), b = Buffer.from(right + "\0"), cwd = mac ? -2 : -100
    if (library.symbols[name](cwd, ptr(a), cwd, ptr(b), 2) !== 0) {
      const errno = read.i32(library.symbols[errnoName]()!)
      const code = ({ 1: "EPERM", 13: "EACCES", 18: "EXDEV", 22: "EINVAL", 38: "ENOSYS", 45: "ENOTSUP", 78: "ENOSYS", 95: "ENOTSUP" } as Record<number, string>)[errno] ?? "EIO"
      throw Object.assign(new Error("update-atomic-replacement-unavailable"), { code, errno })
    }
  } finally { library.close() }
}

/** Проверка поддержки на том же volume выполняется до закрытия A, не затрагивая target. */
export async function probeUnixUpdateExchange(directory: string) {
  const probe = await mkdtemp(path.join(directory, "exchange-probe-"))
  try {
    const a = path.join(probe, "a"), b = path.join(probe, "b")
    await mkdir(a, { mode: 0o700 }); await mkdir(b, { mode: 0o700 })
    await writeFile(path.join(a, "value"), "a"); await writeFile(path.join(b, "value"), "b")
    exchangeUnixUpdatePaths(a, b)
    assert.equal(await readFile(path.join(a, "value"), "utf8"), "b")
    assert.equal(await readFile(path.join(b, "value"), "utf8"), "a")
  } finally { await rm(probe, { recursive: true, force: true }) }
}
