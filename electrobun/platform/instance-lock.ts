import { dlopen, ptr } from "bun:ffi"
import { createHash } from "node:crypto"

let release: (() => void) | undefined

export function lockLauncherProfile(profile: string): boolean {
  if (process.platform !== "win32") return true
  const { symbols } = dlopen("kernel32.dll", {
    CreateMutexW: { args: ["ptr", "bool", "ptr"], returns: "ptr" },
    GetLastError: { args: [], returns: "u32" },
    CloseHandle: { args: ["ptr"], returns: "bool" },
  })
  const hash = createHash("sha256").update(profile.toLowerCase()).digest("hex").slice(0, 32)
  const name = Buffer.from("Local\\XneonLauncherBun-" + hash + "\0", "utf16le")
  const handle = symbols.CreateMutexW(null, false, ptr(name))
  const error = symbols.GetLastError()
  if (!handle) throw new Error("Could not lock launcher profile: " + error)
  if (error === 183) {
    symbols.CloseHandle(handle)
    return false
  }
  release = () => { symbols.CloseHandle(handle) }
  return true
}

export function unlockLauncherProfile() {
  release?.()
  release = undefined
}
