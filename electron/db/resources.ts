import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

export type ResourceRow = {
  sha1: string
  name: string
  version: string
  description: string
  icon: string
  author: string
  source: string
  projectId: string | null
  versionId: string | null
  modId: number | null
  fileId: number | null
  cfChecked: number
  updatedAt: number
}

export async function getResources(sha1s: string[]): Promise<ResourceRow[]> {
  if (!isDbAvailable() || sha1s.length === 0) return []
  const placeholders = sha1s.map(() => "?").join(",")
  return queryAll<ResourceRow>(`SELECT * FROM resources WHERE sha1 IN (${placeholders})`, sha1s)
}

export async function upsertResource(resource: Omit<ResourceRow, "updatedAt">): Promise<void> {
  if (!isDbAvailable()) return
  run(`
    INSERT OR REPLACE INTO resources (sha1, name, version, description, icon, author, source, projectId, versionId, modId, fileId, cfChecked, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [resource.sha1, resource.name, resource.version, resource.description, resource.icon, resource.author, resource.source, resource.projectId, resource.versionId, resource.modId, resource.fileId, resource.cfChecked ?? 0, Date.now()])
  persistDatabase()
}

export async function setResourceCurseforge(sha1: string, modId: number, fileId: number): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE resources SET modId = ?, fileId = ?, cfChecked = 1, updatedAt = ? WHERE sha1 = ?", [modId, fileId, Date.now(), sha1])
  persistDatabase()
}

export async function markResourcesCurseforgeChecked(sha1s: string[]): Promise<void> {
  if (!isDbAvailable() || sha1s.length === 0) return
  const placeholders = sha1s.map(() => "?").join(",")
  run(`UPDATE resources SET cfChecked = 1, updatedAt = ? WHERE modId IS NULL AND sha1 IN (${placeholders})`, [Date.now(), ...sha1s])
  persistDatabase()
}
