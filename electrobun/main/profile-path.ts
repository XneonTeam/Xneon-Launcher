import os from "node:os"
import path from "node:path"

export function getDefaultLauncherDataRoot(): string {
  if (process.env.XNEON_BUN_DATA_DIR) return path.resolve(process.env.XNEON_BUN_DATA_DIR)
  const home = os.homedir()
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, ".config"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "xneonlauncher")
  return path.join(home, ".xneonlauncher")
}

export const launcherLocationConfig = process.env.XNEON_BUN_DATA_DIR
  ? path.join(getDefaultLauncherDataRoot(), "data-location.json")
  : path.join(path.dirname(getDefaultLauncherDataRoot()), ".xneonlauncher-location.json")
