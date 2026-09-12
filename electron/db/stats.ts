import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

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
  persistDatabase()
}

export async function listGameSessions(): Promise<GameSessionRow[]> {
  if (!isDbAvailable()) {
    return [...inMemorySessions].sort((a, b) => b.startedAt - a.startedAt)
  }
  return queryAll<GameSessionRow>(
    "SELECT id, buildId, buildName, startedAt, endedAt, duration FROM game_sessions ORDER BY startedAt DESC",
  )
}

export async function deleteGameSessionsForBuild(buildId: string, buildName?: string): Promise<void> {
  if (!isDbAvailable()) {
    for (let i = inMemorySessions.length - 1; i >= 0; i--) {
      const s = inMemorySessions[i]
      if (s.buildId === buildId || (buildName && s.buildName === buildName)) {
        inMemorySessions.splice(i, 1)
      }
    }
    return
  }
  if (buildName) {
    run("DELETE FROM game_sessions WHERE buildId = ? OR buildName = ?", [buildId, buildName])
  } else {
    run("DELETE FROM game_sessions WHERE buildId = ?", [buildId])
  }
  persistDatabase()
}

export async function deleteGameSessionsForBuildNames(buildNames: string[]): Promise<void> {
  if (buildNames.length === 0) return
  const namesSet = new Set(buildNames)
  if (!isDbAvailable()) {
    for (let i = inMemorySessions.length - 1; i >= 0; i--) {
      const s = inMemorySessions[i]
      if (namesSet.has(s.buildName) || namesSet.has(s.buildId)) {
        inMemorySessions.splice(i, 1)
      }
    }
    return
  }
  // Один список плейсхолдеров используется дважды (buildName / buildId),
  // поэтому параметры передаются тоже дважды.
  const placeholders = buildNames.map(() => "?").join(",")
  run(`DELETE FROM game_sessions WHERE buildName IN (${placeholders}) OR buildId IN (${placeholders})`, [...buildNames, ...buildNames])
  persistDatabase()
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
  persistDatabase()
}

export async function listServerSessions(): Promise<ServerSessionRow[]> {
  if (!isDbAvailable()) {
    return [...inMemoryServerSessions].sort((a, b) => b.startedAt - a.startedAt)
  }
  return queryAll<ServerSessionRow>(
    "SELECT id, serverId, serverName, icon, startedAt, endedAt, duration FROM server_sessions ORDER BY startedAt DESC",
  )
}
