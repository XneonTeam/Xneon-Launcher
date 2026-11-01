import { queryAll, run, transactionImmediate } from "./core"
import type { ShareLink } from "@xnlc/types"
import type { LocalLaunchSettings } from "../main/share/launch-settings"

interface BindingRow { build_id: string; repository_id: string; branch: string; applied_commit: string; latest_commit: string; user_id: string; role: ShareLink["role"]; status: ShareLink["status"] }
export function getShareBinding(buildId: string): ShareLink | null {
  const row = queryAll<BindingRow>("SELECT * FROM shared_instances WHERE build_id=?", [buildId])[0]
  return row ? { repositoryId: row.repository_id, branch: row.branch, applied: row.applied_commit, latest: row.latest_commit, userId: row.user_id, role: row.role, status: row.status } : null
}
export function saveShareBinding(buildId: string, link: ShareLink): void {
  run("INSERT OR REPLACE INTO shared_instances VALUES (?,?,?,?,?,?,?,?,?)", [buildId, link.repositoryId, link.branch, link.applied, link.latest, link.userId, link.role, link.status, Date.now()])
}
export function removeSharePublicationBindings(repositoryId: string): string[] {
  return transactionImmediate(() => {
    const builds = queryAll<{ build_id: string }>("SELECT build_id FROM shared_instances WHERE repository_id=?", [repositoryId])
    run("DELETE FROM shared_instances WHERE repository_id=?", [repositoryId])
    return builds.map(build => build.build_id)
  })
}
export function finishShareInstall(buildId: string, link: ShareLink, fields: { description: string; version: string; modLoader: string; loaderVersion: string; icon?: string; coverImage?: string; launch?: LocalLaunchSettings; mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods: Record<string, string> }): void {
  transactionImmediate(() => {
    run("UPDATE builds SET version=?,modLoader=?,loaderVersion=?,mods=?,resourcepacks=?,shaders=?,installedMods=?,modsCount=?,resourcepacksCount=?,shadersCount=? WHERE id=?", [fields.version, fields.modLoader, fields.loaderVersion, JSON.stringify(fields.mods), JSON.stringify(fields.resourcepacks), JSON.stringify(fields.shaders), JSON.stringify(fields.installedMods), fields.mods.length, fields.resourcepacks.length, fields.shaders.length, buildId])
    saveShareBinding(buildId, link)
    run("UPDATE builds SET description=? WHERE id=?", [fields.description, buildId])
    // Старые публикации без иконки не стирают локальную картинку.
    if (fields.icon !== undefined) run("UPDATE builds SET icon=? WHERE id=?", [fields.icon, buildId])
    if (fields.coverImage !== undefined) run("UPDATE builds SET coverImage=? WHERE id=?", [fields.coverImage, buildId])
    if (fields.launch) {
      const settings = fields.launch
      run("UPDATE builds SET javaOverride=?,javaPath=?,javaArgs=?,memoryMin=?,memoryMax=?,windowOverride=?,windowWidth=?,windowHeight=?,defaultAccountId=? WHERE id=?", [settings.javaOverride ? 1 : 0, settings.javaPath ?? "", settings.javaArgs ?? "", settings.memoryMin ?? "", settings.memoryMax ?? "", settings.windowOverride ? 1 : 0, settings.windowWidth ?? null, settings.windowHeight ?? null, settings.defaultAccountId ?? "", buildId])
    }
  })
}
