import { app } from "../platform/desktop"
import path from "path"
import fs from "node:fs"
import { readDataLocation, migrateInstancesLocation, writeDataLocation } from "./data-location"
import { getDefaultLauncherDataRoot, launcherLocationConfig } from "./profile-path"
export { getDefaultLauncherDataRoot, launcherLocationConfig } from "./profile-path"
let location = readDataLocation(launcherLocationConfig, getDefaultLauncherDataRoot())
// Отменяем ещё не выполненный перенос всех данных: настройка снова относится только к сборкам.
if (location.pending) { location = { ...location, pending: undefined }; writeDataLocation(launcherLocationConfig, location) }
export function applyPendingInstancesMove(): void {
  if (location.pendingInstances) {
    try { location = migrateInstancesLocation(launcherLocationConfig, location) }
    catch (error) {
      console.error("[Storage] Instance move failed; using original directory:", error)
      location = { ...location, pendingInstances: undefined, error: error instanceof Error ? error.message : String(error) }
      writeDataLocation(launcherLocationConfig, location)
    }
  }
}
if (location.relocated && !fs.existsSync(location.root)) throw new Error("DATA_DIRECTORY_UNAVAILABLE")
app.setPath("userData", location.profile && location.relocated ? location.profile : location.root)
export function getLauncherDataRoot(): string { return location.root }
export function isLauncherDataRelocated(): boolean { return !!location.relocated }
export function getDataMoveError(): string | undefined { return location.error }
export function getMcServerDir(id: string): string { return path.join(getLauncherDataRoot(), "mc-servers", id) }
