import { queryAll, run, isDbAvailable, transactionImmediate } from "./core"

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
}

/**
 * Батч-версия {@link upsertFileSnapshot}: холодный скан пишет снапшот на каждый
 * новый файл, и поштучные коммиты давали столько же fsync'ов.
 */
export async function upsertFileSnapshots(snapshots: FileSnapshotRow[]): Promise<void> {
  if (!isDbAvailable() || snapshots.length === 0) return
  transactionImmediate(() => {
    for (const snapshot of snapshots) {
      run(`
        INSERT OR REPLACE INTO file_snapshots (path, size, mtime, sha1)
        VALUES (?, ?, ?, ?)
      `, [snapshot.path, snapshot.size, snapshot.mtime, snapshot.sha1])
    }
  })
}
