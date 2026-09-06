import { app } from "electron"
import path from "path"

export function getLauncherDataRoot(): string {
  if (process.platform === "win32") return path.join(app.getPath("appData"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(app.getPath("home"), "Library", "Application Support", "xneonlauncher")
  return path.join(app.getPath("home"), ".xneonlauncher")
}