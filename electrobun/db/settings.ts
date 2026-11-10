import { queryAll, run, transaction, isDbAvailable, inMemorySettings } from "./core"
import { DEFAULT_SETTINGS } from "./migrations"

/**
 * Кэш настроек в памяти.
 *
 * `getSetting` — синхронное чтение SQLite, а вызывается он постоянно:
 * геттеры `config.ts`, промпты и конфиг `ai-agent.ts`, десятки обращений из
 * renderer через IPC. Настройки меняются редко, поэтому держим их в Map и
 * инвалидируем точечно в `setSetting` (единственная точка записи).
 */
const settingsCache = new Map<string, string | undefined>()

export function ensureInMemorySettingsDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!inMemorySettings.has(key)) {
      inMemorySettings.set(key, value)
    }
  }
}

export async function getSetting(key: string): Promise<string | undefined> {
  if (settingsCache.has(key)) return settingsCache.get(key)

  if (!isDbAvailable()) {
    ensureInMemorySettingsDefaults()
    const value = inMemorySettings.get(key)
    settingsCache.set(key, value)
    return value
  }

  const rows = queryAll<{ value?: string }>("SELECT value FROM settings WHERE key = ?", [key])
  const value = Array.isArray(rows) && rows.length > 0 ? rows[0].value : undefined
  settingsCache.set(key, value)
  return value
}

export async function setSetting(key: string, value: string): Promise<void> {
  settingsCache.set(key, value)
  if (!isDbAvailable()) {
    inMemorySettings.set(key, value)
    return
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value])
}


export function setSettings(values: Record<string, string>): void {
  const entries = Object.entries(values)
  if (isDbAvailable()) {
    transaction(() => {
      for (const [key, value] of entries) run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value])
    })
  } else {
    for (const [key, value] of entries) inMemorySettings.set(key, value)
  }
  for (const [key, value] of entries) settingsCache.set(key, value)
}
