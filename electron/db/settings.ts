import { queryAll, run, persistDatabase, isDbAvailable, inMemorySettings } from "./core"
import { DEFAULT_SETTINGS } from "./migrations"

export function ensureInMemorySettingsDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!inMemorySettings.has(key)) {
      inMemorySettings.set(key, value)
    }
  }
}

export async function getSetting(key: string): Promise<string | undefined> {
  if (!isDbAvailable()) {
    ensureInMemorySettingsDefaults()
    return inMemorySettings.get(key)
  }

  const rows = queryAll<{ value?: string }>("SELECT value FROM settings WHERE key = ?", [key])
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  return rows[0].value
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!isDbAvailable()) {
    inMemorySettings.set(key, value)
    return
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value])
  persistDatabase()
}
