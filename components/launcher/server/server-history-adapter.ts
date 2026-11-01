import type { ContentEntry, DiffEntry, ServerHistoryChange, ServerHistoryResponse } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { shareContentCategory, type ShareContentCategory } from "../instance/shared/share-content-category"
import { getContentType } from "./addons/utils"

export function serverContentCategories(modloader: string): ShareContentCategory[] {
  const loader = modloader.toLowerCase()
  if (["arclight", "mohist", "magma", "catserver", "ketting", "spongeforge"].includes(loader)) return ["mods", "plugins", "other"]
  const type = getContentType(loader)
  return type === "plugin" ? ["plugins", "other"] : type === "mod" ? ["mods", "other"] : ["other"]
}

export function serverChanges(changes: ServerHistoryChange[] = []): DiffEntry[] {
  return changes.map(change => {
    const category = shareContentCategory(change.path)
    const entry = (file: ServerHistoryChange["before"]): ContentEntry | undefined => file ? { ...file, path: change.path, kind: category === "mods" || category === "plugins" ? "mod" : category === "resourcepacks" ? "resourcepack" : category === "shaders" ? "shader" : "external", enabled: true } : undefined
    return { ...change, before: entry(change.before), after: entry(change.after), changes: change.path.startsWith("@settings/") ? [String(change.beforeValue ?? "—"), String(change.afterValue ?? "—")] : change.type === "modified" ? ["sha256"] : [] }
  })
}

export function serverPresentation(response?: ServerHistoryResponse): Record<string, ShareContentPresentation> {
  const result: Record<string, ShareContentPresentation> = {}
  for (const change of response?.changes ?? []) {
    const metadata = response?.presentation?.[(change.after ?? change.before)?.sha256 ?? ""]
    if (metadata) result[change.path] = metadata
  }
  return result
}
