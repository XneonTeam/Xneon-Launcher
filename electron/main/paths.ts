import { app } from "electron"
import path from "path"
import fs from "node:fs"
import { readDataLocation, migrateInstancesLocation, writeDataLocation } from "./data-location"

export function getDefaultLauncherDataRoot(): string {
  if (process.platform === "win32") return path.join(app.getPath("appData"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(app.getPath("home"), "Library", "Application Support", "xneonlauncher")
  return path.join(app.getPath("home"), ".xneonlauncher")
}
export const launcherLocationConfig = path.join(path.dirname(getDefaultLauncherDataRoot()), ".xneonlauncher-location.json")
let location = readDataLocation(launcherLocationConfig, getDefaultLauncherDataRoot())
// Блокировка нужна до переноса, а не после загрузки модулей и открытия БД.
if (app.isPackaged && !app.requestSingleInstanceLock()) app.exit(0)
// Отменяем ещё не выполненный перенос всех данных: настройка снова относится только к сборкам.
if (location.pending) { location = { ...location, pending: undefined }; writeDataLocation(launcherLocationConfig, location) }
if (location.pendingInstances) {
  try { location = migrateInstancesLocation(launcherLocationConfig, location) }
  catch (error) {
    console.error("[Storage] Instance move failed; using original directory:", error)
    location = { ...location, pendingInstances: undefined, error: error instanceof Error ? error.message : String(error) }
    writeDataLocation(launcherLocationConfig, location)
  }
}
if (location.relocated) {
  if (!fs.existsSync(location.root)) throw new Error("DATA_DIRECTORY_UNAVAILABLE")
  const profile = path.join(location.root, "profile"), session = path.join(location.root, "system-config", "session")
  fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(session, { recursive: true })
  app.setPath("userData", profile)
  app.setPath("sessionData", session)
}
export function getLauncherDataRoot(): string { return location.root }
export function isLauncherDataRelocated(): boolean { return !!location.relocated }
export function getDataMoveError(): string | undefined { return location.error }
export function getMcServerDir(id: string): string { return path.join(getLauncherDataRoot(), "mc-servers", id) }
