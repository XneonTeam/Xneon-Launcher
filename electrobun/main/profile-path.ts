import os from "node:os"
import path from "node:path"

declare const XNEON_PORTABLE_BUILD: boolean
export const isPortable = typeof XNEON_PORTABLE_BUILD !== "undefined" && XNEON_PORTABLE_BUILD

export function getDefaultLauncherDataRoot(): string {
  if (isPortable) return path.resolve(path.dirname(process.execPath), "..", "PortableProfile")
  if (process.env.XNEON_BUN_DATA_DIR) return path.resolve(process.env.XNEON_BUN_DATA_DIR)
  const home = os.homedir()
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, ".config"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "xneonlauncher")
  return path.join(home, ".xneonlauncher")
}

export const launcherLocationConfig = isPortable || process.env.XNEON_BUN_DATA_DIR
  ? path.join(getDefaultLauncherDataRoot(), "data-location.json")
  : path.join(path.dirname(getDefaultLauncherDataRoot()), ".xneonlauncher-location.json")
