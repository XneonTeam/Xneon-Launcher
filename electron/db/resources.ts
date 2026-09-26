import { queryAll, run, isDbAvailable, transactionImmediate } from "./core"

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
}

/**
 * Батч-версия {@link upsertResource}: одна транзакция на весь набор вместо
 * коммита (и fsync в WAL) на каждую запись. Скан контента пишет сотни ресурсов
 * подряд — поштучные коммиты были основной причиной «fsync-шторма».
 */
export async function upsertResources(resources: Array<Omit<ResourceRow, "updatedAt">>): Promise<void> {
  if (!isDbAvailable() || resources.length === 0) return
  const updatedAt = Date.now()
  transactionImmediate(() => {
    for (const resource of resources) {
      run(`
        INSERT OR REPLACE INTO resources (sha1, name, version, description, icon, author, source, projectId, versionId, modId, fileId, cfChecked, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [resource.sha1, resource.name, resource.version, resource.description, resource.icon, resource.author, resource.source, resource.projectId, resource.versionId, resource.modId, resource.fileId, resource.cfChecked ?? 0, updatedAt])
    }
  })
}

export async function setResourceCurseforge(sha1: string, modId: number, fileId: number): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE resources SET modId = ?, fileId = ?, cfChecked = 1, updatedAt = ? WHERE sha1 = ?", [modId, fileId, Date.now(), sha1])
}

/** Батч-версия {@link setResourceCurseforge}: один проход в транзакции. */
export async function setResourcesCurseforge(matches: Array<{ sha1: string; modId: number; fileId: number }>): Promise<void> {
  if (!isDbAvailable() || matches.length === 0) return
  const updatedAt = Date.now()
  transactionImmediate(() => {
    for (const { sha1, modId, fileId } of matches) {
      run("UPDATE resources SET modId = ?, fileId = ?, cfChecked = 1, updatedAt = ? WHERE sha1 = ?", [modId, fileId, updatedAt, sha1])
    }
  })
}

export async function markResourcesCurseforgeChecked(sha1s: string[]): Promise<void> {
  if (!isDbAvailable() || sha1s.length === 0) return
  const placeholders = sha1s.map(() => "?").join(",")
  run(`UPDATE resources SET cfChecked = 1, updatedAt = ? WHERE modId IS NULL AND sha1 IN (${placeholders})`, [Date.now(), ...sha1s])
}
