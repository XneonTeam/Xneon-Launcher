import { dlopen, ptr } from "bun:ffi"
import { createHash } from "node:crypto"
import path from "node:path"
import { acquireUnixFileLock } from "./unix-file-lock"

let release: (() => void) | undefined
let ownedProfile: string | undefined
const profileKey = (profile: string) => process.platform === "win32" ? path.resolve(profile).toLowerCase() : path.resolve(profile)

export function hasLauncherProfileLock(profile: string): boolean {
  return release !== undefined && ownedProfile === profileKey(profile)
}

export function lockLauncherProfile(profile: string): boolean {
  if (release) {
    if (hasLauncherProfileLock(profile)) return true
    throw new Error("This process already owns another launcher profile")
  }
  if (process.platform !== "win32") {
    const unlock = acquireUnixFileLock(path.resolve(profile) + ".lock")
    if (!unlock) return false
    ownedProfile = profileKey(profile)
    release = unlock
    return true
  }
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
  ownedProfile = profileKey(profile)
  return true
}

export function unlockLauncherProfile() {
  try { release?.() }
  finally { release = undefined; ownedProfile = undefined }
}
