import path from "node:path"
import type { ShareContentPresentation } from "@xnlc/types"
import { normalizePath } from "@xnlc/share"
import { resolveContentEntries } from "../builds/content-resolver"
import { dbHelpers } from "../../db"
import { getResourceForSource } from "../../db/resources"
import type { ContentEntry } from "@xnlc/share"
import { ShareWorktree } from "./worktree"

/** Тот же разбор архивов и кэш метаданных, что используются вкладкой установленного контента. */
export async function describeShareContent(directory: string, relativePaths: string[]): Promise<Record<string, ShareContentPresentation>> {
  const paths = [...new Set(relativePaths)]
    .map(normalizePath)
    .filter(relative => /^(mods|resourcepacks|shaderpacks)\//.test(relative) && /\.(jar|zip|litemod)(\.disabled)?$/i.test(relative))
  const absolute = paths.map(relative => path.join(directory, relative))
  const resolved = await resolveContentEntries(absolute)
  // Удалённый файл уже не разобрать; используем прежние метаданные по сохранённому хешу.
  const snapshots = await dbHelpers.getFileSnapshots(absolute.filter(file => !resolved[file]))
  const sha1ByPath = new Map(snapshots.map(snapshot => [snapshot.path, snapshot.sha1]))
  const cached = new Map((await dbHelpers.getResources([...new Set(snapshots.map(snapshot => snapshot.sha1))])).map(resource => [resource.sha1, resource]))
  const result: Record<string, ShareContentPresentation> = {}
  for (const [index, relative] of paths.entries()) {
    const file = absolute[index]
    const current = resolved[file]
    const previous = cached.get(sha1ByPath.get(file) ?? "")
    const metadata = current ?? previous
    if (!metadata) continue
    result[relative] = {
      // У pack.mcmeta нет обязательного названия: сохраняем иконку даже без него.
      name: metadata.name || path.basename(relative).replace(/\.(jar|zip|litemod)(\.disabled)?$/i, ""),
      version: metadata.version || undefined,
      author: metadata.author || undefined,
      iconUrl: current?.icon_url || previous?.icon || undefined,
      source: metadata.source === "modrinth" || metadata.source === "curseforge" ? metadata.source : "local",
    }
  }
  return result
}

/** Исторические данные привязаны к хешу: текущая версия файла не подменяет прежнюю. */
export async function describeShareHistory(directory: string, entries: ContentEntry[]): Promise<Record<string, ShareContentPresentation>> {
  const unique = [...new Map(entries.map(entry => [entry.sha256, entry])).values()]
    .filter(entry => /^(mods|resourcepacks|shaderpacks)\//.test(entry.path))
  const files = new ShareWorktree(directory)
  const local = await describeShareContent(directory, unique.map(entry => entry.path))
  const result: Record<string, ShareContentPresentation> = {}
  for (const entry of unique) {
    const cached = entry.source ? getResourceForSource(entry.source) : undefined
    if (cached?.name) {
      result[entry.sha256] = { name: cached.name, version: cached.version, author: cached.author, iconUrl: cached.icon || undefined, source: entry.source!.provider as "modrinth" | "curseforge" }
    } else if (local[entry.path] && await files.hash(entry.path).then(hashes => hashes.sha256 === entry.sha256).catch(() => false)) {
      result[entry.sha256] = local[entry.path]
    }
  }
  return result
}
