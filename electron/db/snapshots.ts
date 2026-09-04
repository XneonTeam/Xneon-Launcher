import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

export type FileSnapshotRow = {
  path: string
  size: number
  mtime: number
  sha1: string
}

export async function getFileSnapshots(paths: string[]): Promise<FileSnapshotRow[]> {
  if (!isDbAvailable() || paths.length === 0) return []
  const placeholders = paths.map(() => "?").join(",")
  return queryAll<FileSnapshotRow>(`SELECT * FROM file_snapshots WHERE path IN (${placeholders})`, paths)
}

export async function upsertFileSnapshot(snapshot: FileSnapshotRow): Promise<void> {
  if (!isDbAvailable()) return
  run(`
    INSERT OR REPLACE INTO file_snapshots (path, size, mtime, sha1)
    VALUES (?, ?, ?, ?)
  `, [snapshot.path, snapshot.size, snapshot.mtime, snapshot.sha1])
  persistDatabase()
}
