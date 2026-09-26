import { queryAll, run, isDbAvailable, warnDbUnavailable } from "./core"
import { deleteServerSessionsForDeletedServer } from "./stats"

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
  if (!isDbAvailable()) { warnDbUnavailable("listMcServers"); return [] }
  return queryAll<McServerRow>("SELECT * FROM mc_servers WHERE trashedAt IS NULL ORDER BY createdAt DESC")
}

export async function listTrashedMcServers(): Promise<McServerRow[]> {
  if (!isDbAvailable()) { warnDbUnavailable("listTrashedMcServers"); return [] }
  return queryAll<McServerRow>("SELECT * FROM mc_servers WHERE trashedAt IS NOT NULL ORDER BY trashedAt DESC")
}

export async function getMcServer(id: string): Promise<McServerRow | null> {
  if (!isDbAvailable()) { warnDbUnavailable("getMcServer"); return null }
  const rows = queryAll<McServerRow>("SELECT * FROM mc_servers WHERE id = ?", [id])
  return rows[0] ?? null
}

export async function createMcServer(server: McServerRow): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("createMcServer"); return }
  run(
    "INSERT INTO mc_servers (id, name, gameVersion, modloader, modloaderVersion, port, xmx, xms, extraJavaArgs, javaPath, autoRestart, icon, relayEnabled, onlineMode, maxPlayers, createdAt, customJar, source, [group]) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [server.id, server.name, server.gameVersion, server.modloader, server.modloaderVersion ?? null, server.port, server.xmx, server.xms, server.extraJavaArgs, server.javaPath ?? null, server.autoRestart, server.icon ?? null, server.relayEnabled ?? 0, server.onlineMode ?? 1, server.maxPlayers ?? 20, server.createdAt, server.customJar ?? null, server.source ?? "local", server.group ?? null]
  )
}

export async function updateMcServer(id: string, update: Partial<McServerRow>): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("updateMcServer"); return }
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
}

export async function softDeleteMcServer(id: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("softDeleteMcServer"); return }
  run("UPDATE mc_servers SET trashedAt = ? WHERE id = ?", [new Date().toISOString(), id])
}

export async function restoreMcServer(id: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("restoreMcServer"); return }
  run("UPDATE mc_servers SET trashedAt = NULL WHERE id = ?", [id])
}

export async function purgeTrashedMcServers(): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("purgeTrashedMcServers"); return }
  // Сначала запоминаем удаляемые серверы: у server_sessions нет FK с каскадом,
  // поэтому статистику нужно убрать вручную, иначе она останется сиротами.
  const trashed = queryAll<{ id: string; name: string }>("SELECT id, name FROM mc_servers WHERE trashedAt IS NOT NULL")
  run("DELETE FROM mc_servers WHERE trashedAt IS NOT NULL")
  if (trashed.length > 0) {
    await deleteServerSessionsForDeletedServer({
      ids: trashed.map((row) => row.id),
      names: trashed.map((row) => row.name),
    })
  }
}

export async function deleteMcServer(id: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("deleteMcServer"); return }
  const [row] = queryAll<{ id: string; name: string }>("SELECT id, name FROM mc_servers WHERE id = ?", [id])
  run("DELETE FROM mc_servers WHERE id = ?", [id])
  await deleteServerSessionsForDeletedServer({ ids: [id], names: row ? [row.name] : [] })
}
