import { lstatSync, unlinkSync } from "node:fs"

/** Вызывать только после захвата flock того же профиля, до bind/listen. */
export function removeStaleUnixSocket(file: string, ownsProfileLock: boolean): void {
  if (!ownsProfileLock) throw new Error("Refusing to remove IPC socket without profile lock")
  let info
  try { info = lstatSync(file) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error }
  if (!info.isSocket() || info.isSymbolicLink() || info.uid !== process.getuid?.()) {
    throw new Error("Refusing to remove unsafe IPC path")
  }
  unlinkSync(file)
}
