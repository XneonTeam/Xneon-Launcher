import type { ShareContentPresentation } from "@xnlc/types"
import { dbHelpers } from "../../db"
import { loadModsModule } from "../builds/helpers"

const checked = new Map<string, number>()
const pending = new Map<string, Promise<void>>()

/** Иконки плагинов берутся по хешу версии из того же каталога и кэша, что у модов. */
export async function enrichServerContent(entries: { sha1: string; metadata: ShareContentPresentation }[]): Promise<void> {
  const candidates = entries.filter(entry => !entry.metadata.iconUrl && (checked.get(entry.sha1) ?? 0) < Date.now())
  if (!candidates.length) return
  const key = candidates.map(entry => entry.sha1).sort().join(":")
  let task = pending.get(key)
  if (!task) {
    task = (async () => {
      const hashes = [...new Set(candidates.map(entry => entry.sha1))]
      const cached = new Map((await dbHelpers.getResources(hashes)).map(row => [row.sha1, row]))
      const mods = await loadModsModule()
      const unknown = hashes.filter(hash => !cached.get(hash)?.projectId && cached.get(hash)?.source !== "curseforge")
      const matches = await mods.modrinthGetFilesByHash(unknown)
      const projects = [...new Set(hashes.flatMap(hash => {
        const row = cached.get(hash), id = row?.source === "curseforge" ? undefined : row?.projectId || matches[hash]?.projectId
        return id ? [id] : []
      }))]
      const cfIds = [...new Set(hashes.flatMap(hash => { const row = cached.get(hash); return row?.source === "curseforge" && row.modId ? [row.modId] : [] }))]
      const versions = [...new Set(Object.values(matches).map(match => match.versionId))]
      const [projectInfo, versionInfo, cfInfo] = await Promise.all([
        mods.modrinthGetProjectsByIds(projects),
        mods.modrinthGetVersionsByIds(versions),
        mods.curseforgeGetProjectsByIds(cfIds),
      ])
      const updates: Parameters<typeof dbHelpers.upsertResources>[0] = []
      for (const entry of candidates) {
        const row = cached.get(entry.sha1), match = matches[entry.sha1]
        const cf = row?.source === "curseforge", projectId = row?.projectId || match?.projectId
        const project = cf ? cfInfo[row!.modId!] : projectId ? projectInfo[projectId] : undefined
        if (!project?.iconUrl) continue
        const source = cf ? "curseforge" : "modrinth"
        updates.push({ sha1: entry.sha1, name: row?.name || entry.metadata.name || project.name, version: versionInfo[match?.versionId]?.versionNumber || row?.version || entry.metadata.version || "", description: row?.description ?? "", icon: project.iconUrl, author: row?.author || entry.metadata.author || project.author || "", source, projectId: projectId ?? null, versionId: row?.versionId || match?.versionId || null, modId: row?.modId ?? null, fileId: row?.fileId ?? null, cfChecked: row?.cfChecked ?? 0 })
      }
      await dbHelpers.upsertResources(updates)
      for (const hash of hashes) checked.set(hash, Date.now() + 5 * 60_000)
      while (checked.size > 1024) checked.delete(checked.keys().next().value!)
    })().catch(() => {}).finally(() => { pending.delete(key) })
    pending.set(key, task)
  }
  // Недоступность каталога не задерживает открытие окна надолго; успешный
  // фоновый ответ останется в общем кэше и подхватится при следующем просмотре.
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([task, new Promise<void>(resolve => { timer = setTimeout(resolve, 8000) })]) }
  finally { if (timer) clearTimeout(timer) }
  const resources = new Map((await dbHelpers.getResources(candidates.map(entry => entry.sha1))).map(row => [row.sha1, row]))
  for (const entry of candidates) {
    const row = resources.get(entry.sha1)
    if (row?.icon) Object.assign(entry.metadata, { iconUrl: row.icon, name: row.name || entry.metadata.name, version: row.version || entry.metadata.version, author: row.author || entry.metadata.author, source: row.source === "curseforge" ? "curseforge" : "modrinth" })
  }
}
