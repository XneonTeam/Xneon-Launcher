import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

export async function getCloudConfig(provider: string): Promise<string | null> {
  if (!isDbAvailable()) return null

  const rows = queryAll<{ data?: string }>("SELECT data FROM cloud_configs WHERE provider = ?", [provider])
  if (!Array.isArray(rows) || rows.length === 0) return null
  return rows[0].data ?? null
}

export async function setCloudConfig(provider: string, data: string): Promise<void> {
  if (!isDbAvailable()) return

  run("INSERT OR REPLACE INTO cloud_configs (provider, data) VALUES (?, ?)", [provider, data])
  persistDatabase()
}

export async function removeCloudConfig(provider: string): Promise<void> {
  if (!isDbAvailable()) return

  run("DELETE FROM cloud_configs WHERE provider = ?", [provider])
  persistDatabase()
}
