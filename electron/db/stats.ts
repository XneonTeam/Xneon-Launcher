import { queryAll, run, isDbAvailable } from "./core"

export type GameSessionRow = {
  id: string
  buildId: string
  buildName: string
  startedAt: number
  endedAt: number
  duration: number
}

export type ServerSessionRow = {
  id: string
  serverId: string
  serverName: string
  icon: string | null
  startedAt: number
  endedAt: number
  duration: number
}

// In-memory fallback when the DB file is unavailable (mirrors the pattern
// used by accounts/builds in core.ts).
const inMemorySessions: GameSessionRow[] = []
const inMemoryServerSessions: ServerSessionRow[] = []

export async function addGameSession(session: GameSessionRow): Promise<void> {
  if (!isDbAvailable()) {
    inMemorySessions.push(session)
    return
  }
  run(
    "INSERT INTO game_sessions (id, buildId, buildName, startedAt, endedAt, duration) VALUES (?, ?, ?, ?, ?, ?)",
    [session.id, session.buildId, session.buildName, session.startedAt, session.endedAt, session.duration],
  )
}

export async function listGameSessions(): Promise<GameSessionRow[]> {
  if (!isDbAvailable()) {
    return [...inMemorySessions].sort((a, b) => b.startedAt - a.startedAt)
  }
  return queryAll<GameSessionRow>(
    "SELECT id, buildId, buildName, startedAt, endedAt, duration FROM game_sessions ORDER BY startedAt DESC",
  )
}

/**
 * Только сессии в диапазоне [from, to]. Страница статистики агрегирует по
 * выбранному диапазону, и раньше читала всю таблицу, отбрасывая лишнее в JS —
 * на растущей таблице это скан на каждый вызов.
 */
export async function listGameSessionsInRange(from: number, to: number): Promise<GameSessionRow[]> {
  if (!isDbAvailable()) {
    return inMemorySessions
      .filter((s) => s.startedAt >= from && s.startedAt <= to)
      .sort((a, b) => b.startedAt - a.startedAt)
  }
  return queryAll<GameSessionRow>(
    "SELECT id, buildId, buildName, startedAt, endedAt, duration FROM game_sessions WHERE startedAt >= ? AND startedAt <= ? ORDER BY startedAt DESC",
    [from, to],
  )
}

export async function deleteGameSessionsForDeletedBuild(criteria: { ids?: string[]; names?: string[] }): Promise<void> {
  const ids = [...new Set((criteria.ids ?? []).filter(Boolean))]
  const names = [...new Set((criteria.names ?? []).filter(Boolean))]
  if (ids.length === 0 && names.length === 0) return

  if (!isDbAvailable()) {
    const idSet = new Set(ids)
    const nameSet = new Set(names)
    for (let i = inMemorySessions.length - 1; i >= 0; i--) {
      const s = inMemorySessions[i]
      if (idSet.has(s.buildId) || nameSet.has(s.buildName)) inMemorySessions.splice(i, 1)
    }
    return
  }

  // По id удаляем строго: он принадлежит именно удаляемой сборке.
  if (ids.length > 0) {
    run(`DELETE FROM game_sessions WHERE buildId IN (${ids.map(() => "?").join(",")})`, ids)
  }
  // По имени — только «осиротевшие» записи: у сборки с таким же именем,
  // созданной позже, статистику трогать нельзя.
  if (names.length > 0) {
    run(
      `DELETE FROM game_sessions WHERE buildName IN (${names.map(() => "?").join(",")}) AND buildId NOT IN (SELECT id FROM builds)`,
      names,
    )
  }
}

/**
 * Разовая уборка статистики сборок, которых больше нет в БД.
 *
 * Нужна для записей, оставшихся от удалений, сделанных до того, как удаление
 * сборки научилось чистить статистику (и для старых записей корзины без
 * снапшота метаданных). Ванильные запуски (`buildId = "minecraft:<версия>"`)
 * не трогаем — они не привязаны к сборкам.
 *
 * `protect` — сборки, которых нет в таблице `builds`, но которые ещё живы: они
 * лежат в корзине и восстановимы. Их записи в `builds` удаляются сразу при
 * перемещении в корзину, поэтому без защиты эта уборка стирала статистику
 * отправленной в корзину сборки при первом же перезапуске лаунчера.
 *
 * @returns сколько записей удалено
 */
export async function deleteOrphanGameSessions(protect?: { ids?: string[]; names?: string[] }): Promise<number> {
  if (!isDbAvailable()) return 0
  // Пустая таблица сборок означает, что БД ещё не наполнена — чистить нельзя.
  const buildRows = queryAll<{ id: string }>("SELECT id FROM builds")
  if (buildRows.length === 0) return 0

  const protectedIds = new Set((protect?.ids ?? []).filter(Boolean))
  const protectedNames = new Set((protect?.names ?? []).filter(Boolean))

  if (protectedIds.size === 0 && protectedNames.size === 0) {
    const result = run(
      "DELETE FROM game_sessions WHERE buildId NOT IN (SELECT id FROM builds) AND buildId NOT LIKE 'minecraft:%'",
    )
    return result.changes
  }

  const buildIds = new Set(buildRows.map((row) => row.id))
  const orphanIds = queryAll<{ id: string; buildId: string; buildName: string }>(
    "SELECT id, buildId, buildName FROM game_sessions",
  )
    .filter(
      (row) =>
        !buildIds.has(row.buildId) &&
        !row.buildId.startsWith("minecraft:") &&
        !protectedIds.has(row.buildId) &&
        !protectedNames.has(row.buildName),
    )
    .map((row) => row.id)

  let removed = 0
  // Пачками: у SQLite ограничено число плейсхолдеров в одном выражении.
  for (let i = 0; i < orphanIds.length; i += 200) {
    const chunk = orphanIds.slice(i, i + 200)
    removed += run(`DELETE FROM game_sessions WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk).changes
  }
  return removed
}

export async function addServerSession(session: ServerSessionRow): Promise<void> {
  if (!isDbAvailable()) {
    inMemoryServerSessions.push(session)
    return
  }
  run(
    "INSERT INTO server_sessions (id, serverId, serverName, icon, startedAt, endedAt, duration) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [session.id, session.serverId, session.serverName, session.icon, session.startedAt, session.endedAt, session.duration],
  )
}

export async function listServerSessions(): Promise<ServerSessionRow[]> {
  if (!isDbAvailable()) {
    return [...inMemoryServerSessions].sort((a, b) => b.startedAt - a.startedAt)
  }
  return queryAll<ServerSessionRow>(
    "SELECT id, serverId, serverName, icon, startedAt, endedAt, duration FROM server_sessions ORDER BY startedAt DESC",
  )
}

/** То же для аптайм-сессий серверов: только диапазон [from, to]. */
export async function listServerSessionsInRange(from: number, to: number): Promise<ServerSessionRow[]> {
  if (!isDbAvailable()) {
    return inMemoryServerSessions
      .filter((s) => s.startedAt >= from && s.startedAt <= to)
      .sort((a, b) => b.startedAt - a.startedAt)
  }
  return queryAll<ServerSessionRow>(
    "SELECT id, serverId, serverName, icon, startedAt, endedAt, duration FROM server_sessions WHERE startedAt >= ? AND startedAt <= ? ORDER BY startedAt DESC",
    [from, to],
  )
}

/**
 * Убирает статистику удалённых серверов.
 *
 * У `server_sessions` нет внешнего ключа на `mc_servers` (в отличие от
 * `game_sessions`, которые чистятся при удалении сборки), поэтому записи
 * оставались сиротами: сервер удалён, а его сессии вечно висят в статистике.
 * По id удаляем строго, по имени — только осиротевшие записи, чтобы не задеть
 * одноимённый сервер, созданный позже.
 */
export async function deleteServerSessionsForDeletedServer(criteria: { ids?: string[]; names?: string[] }): Promise<void> {
  const ids = [...new Set((criteria.ids ?? []).filter(Boolean))]
  const names = [...new Set((criteria.names ?? []).filter(Boolean))]
  if (ids.length === 0 && names.length === 0) return

  if (!isDbAvailable()) {
    const idSet = new Set(ids)
    const nameSet = new Set(names)
    for (let i = inMemoryServerSessions.length - 1; i >= 0; i--) {
      const session = inMemoryServerSessions[i]
      if (idSet.has(session.serverId) || nameSet.has(session.serverName)) inMemoryServerSessions.splice(i, 1)
    }
    return
  }

  if (ids.length > 0) {
    run(`DELETE FROM server_sessions WHERE serverId IN (${ids.map(() => "?").join(",")})`, ids)
  }
  if (names.length > 0) {
    run(
      `DELETE FROM server_sessions WHERE serverName IN (${names.map(() => "?").join(",")}) AND serverId NOT IN (SELECT id FROM mc_servers)`,
      names,
    )
  }
}

/**
 * Разовая уборка статистики серверов, которых больше нет в БД (записи, которые
 * остались от удалений до появления {@link deleteServerSessionsForDeletedServer}).
 */
export async function deleteOrphanServerSessions(): Promise<number> {
  if (!isDbAvailable()) return 0
  const serverRows = queryAll<{ id: string }>("SELECT id FROM mc_servers")
  if (serverRows.length === 0) {
    // Пустая таблица серверов: либо их не было, либо БД ещё не наполнена —
    // чистить статистику в этом случае рискованно.
    const sessions = queryAll<{ id: string }>("SELECT id FROM server_sessions LIMIT 1")
    if (sessions.length === 0) return 0
  }
  const result = run("DELETE FROM server_sessions WHERE serverId NOT IN (SELECT id FROM mc_servers)")
  return result.changes
}
