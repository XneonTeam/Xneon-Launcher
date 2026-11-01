import type { DiffEntry } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"

export interface PluginChangeGroup {
  key: string; name: string; path: string; metadata?: ShareContentPresentation
  artifacts: DiffEntry[]; files: DiffEntry[]
}
const identity = (name: string) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

export function groupPluginChanges(changes: DiffEntry[], presentation: Record<string, ShareContentPresentation>): PluginChangeGroup[] {
  const groups = new Map<string, PluginChangeGroup>()
  for (const change of changes.filter(change => /^plugins\/[^/]+\//i.test(change.path))) {
    const folder = change.path.split("/")[1], key = identity(folder)
    let group = groups.get(key)
    if (!group) { group = { key, name: folder, path: `plugins/${folder}`, artifacts: [], files: [] }; groups.set(key, group) }
    group.files.push(change)
  }
  for (const change of changes.filter(change => /^plugins\/[^/]+\.jar(\.disabled)?$/i.test(change.path))) {
    const metadata = presentation[(change.after ?? change.before)?.sha256 ?? ""] ?? presentation[change.path] ?? presentation[change.before?.path ?? ""]
    const filename = change.path.split("/").pop()!.replace(/\.jar(\.disabled)?$/i, "")
    const stem = filename.replace(/[-_]v?\d.*$/i, "")
    const keys = [metadata?.name, stem, filename].filter((name): name is string => !!name).map(identity)
    let group = keys.map(key => groups.get(key)).find((group): group is PluginChangeGroup => !!group)
    if (!group) { const key = keys[0]; group = { key, name: metadata?.name || stem, path: change.path, artifacts: [], files: [] }; groups.set(key, group) }
    group.artifacts.push(change)
    if (!group.metadata || change.after) group.metadata = metadata
  }
  return [...groups.values()]
}
