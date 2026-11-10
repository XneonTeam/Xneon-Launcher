import { queryAll, run, isDbAvailable, warnDbUnavailable } from "./core"

export async function getCloudConfig(provider: string): Promise<string | null> {
  if (!isDbAvailable()) { warnDbUnavailable("getCloudConfig"); return null }

  const rows = queryAll<{ data?: string }>("SELECT data FROM cloud_configs WHERE provider = ?", [provider])
  if (!Array.isArray(rows) || rows.length === 0) return null
  return rows[0].data ?? null
}

export async function setCloudConfig(provider: string, data: string): Promise<void> {
  if (!isDbAvailable()) throw new Error("Cloud credential database is unavailable")

  run("INSERT OR REPLACE INTO cloud_configs (provider, data) VALUES (?, ?)", [provider, data])
}

export async function removeCloudConfig(provider: string): Promise<void> {
  if (!isDbAvailable()) throw new Error("Cloud credential database is unavailable")

  run("DELETE FROM cloud_configs WHERE provider = ?", [provider])
}

export async function replaceCloudConfig(provider: string, previous: string, data: string): Promise<boolean> {
  if (!isDbAvailable()) throw new Error("Cloud credential database is unavailable")
  return Number(run("UPDATE cloud_configs SET data = ? WHERE provider = ? AND data = ?", [data, provider, previous]).changes) === 1
}
