import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

export type McServerRow = {
  id: string
  name: string
  gameVersion: string
  modloader: string
  modloaderVersion: string | null
  port: number
  xmx: number
  xms: number
  extraJavaArgs: string
  javaPath: string | null
  autoRestart: number
  icon: string | null
  relayEnabled: number
  onlineMode: number
  maxPlayers: number
  createdAt: string
  trashedAt: string | null
  customJar: string | null
  source: "local" | "modrinth" | "curseforge"
  group?: string | null
}

export async function listMcServers(): Promise<McServerRow[]> {
  if (!isDbAvailable()) return []
  return queryAll<McServerRow>("SELECT * FROM mc_servers WHERE trashedAt IS NULL ORDER BY createdAt DESC")
}

export async function listTrashedMcServers(): Promise<McServerRow[]> {
  if (!isDbAvailable()) return []
  return queryAll<McServerRow>("SELECT * FROM mc_servers WHERE trashedAt IS NOT NULL ORDER BY trashedAt DESC")
}

export async function getMcServer(id: string): Promise<McServerRow | null> {
  if (!isDbAvailable()) return null
  const rows = queryAll<McServerRow>("SELECT * FROM mc_servers WHERE id = ?", [id])
  return rows[0] ?? null
}

export async function createMcServer(server: McServerRow): Promise<void> {
  if (!isDbAvailable()) return
  run(
    "INSERT INTO mc_servers (id, name, gameVersion, modloader, modloaderVersion, port, xmx, xms, extraJavaArgs, javaPath, autoRestart, icon, relayEnabled, onlineMode, maxPlayers, createdAt, customJar, source, [group]) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [server.id, server.name, server.gameVersion, server.modloader, server.modloaderVersion ?? null, server.port, server.xmx, server.xms, server.extraJavaArgs, server.javaPath ?? null, server.autoRestart, server.icon ?? null, server.relayEnabled ?? 0, server.onlineMode ?? 1, server.maxPlayers ?? 20, server.createdAt, server.customJar ?? null, server.source ?? "local", server.group ?? null]
  )
  persistDatabase()
}

export async function updateMcServer(id: string, update: Partial<McServerRow>): Promise<void> {
  if (!isDbAvailable()) return
  const fields: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(update)) {
    if (key === "id") continue
    // "group" — зарезервированное слово SQLite, экранируем скобками.
    const column = key === "group" ? "[group]" : key
    fields.push(`${column} = ?`)
    values.push(value ?? null)
  }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE mc_servers SET ${fields.join(", ")} WHERE id = ?`, values)
  persistDatabase()
}

export async function softDeleteMcServer(id: string): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE mc_servers SET trashedAt = ? WHERE id = ?", [new Date().toISOString(), id])
  persistDatabase()
}

export async function restoreMcServer(id: string): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE mc_servers SET trashedAt = NULL WHERE id = ?", [id])
  persistDatabase()
}

export async function purgeTrashedMcServers(): Promise<void> {
  if (!isDbAvailable()) return
  run("DELETE FROM mc_servers WHERE trashedAt IS NOT NULL")
  persistDatabase()
}

export async function deleteMcServer(id: string): Promise<void> {
  if (!isDbAvailable()) return
  run("DELETE FROM mc_servers WHERE id = ?", [id])
  persistDatabase()
}
