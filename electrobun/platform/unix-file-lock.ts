import { dlopen, read } from "bun:ffi"
import { constants, openSync, closeSync, fstatSync, mkdirSync, lstatSync, chmodSync } from "node:fs"
import path from "node:path"

/** Короткий путь для Unix-сокетов; каталог не может принадлежать другому UID или быть ссылкой. */
export function unixPrivateDirectory() {
  if (typeof process.getuid !== "function") throw new Error("Unix user identity is unavailable")
  const directory = `/tmp/xneon-launcher-${process.getuid()}`
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) throw new Error("Unsafe launcher IPC directory")
  chmodSync(directory, 0o700)
  return directory
}

/** Не удаляем lock-файл: иначе другой процесс сможет захватить уже иной inode. */
export function acquireUnixFileLock(file: string): (() => void) | null {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("Unix file locking is unavailable")
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const library = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    flock: { args: ["i32", "i32"], returns: "i32" },
    [process.platform === "darwin" ? "__error" : "__errno_location"]: { args: [], returns: "ptr" },
  })
  let fd: number | undefined
  try {
    fd = openSync(file, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600)
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid?.()) throw new Error("Unsafe launcher lock file")
    if (library.symbols.flock(fd, 2 | 4) !== 0) {
      // EWOULDBLOCK: Darwin=35, Linux=11. Остальные ошибки не маскируем вторым экземпляром.
      const errno = read.i32(library.symbols[process.platform === "darwin" ? "__error" : "__errno_location"]()!)
      if (errno !== (process.platform === "darwin" ? 35 : 11)) throw new Error("Could not lock launcher profile: errno " + errno)
      closeSync(fd); fd = undefined; library.close()
      return null
    }
    const held = fd
    let released = false
    return () => {
      if (released) return
      released = true
      try { library.symbols.flock(held, 8) }
      finally { try { closeSync(held) } finally { library.close() } }
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    library.close()
    throw error
  }
}
