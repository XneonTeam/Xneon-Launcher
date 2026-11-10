// ============================================================
// XNLC — Active Session Tracker
// Tracks the currently running Minecraft game and launcher-hosted
// MC servers so the Statistics page can show real-time playtime
// / uptime while sessions are still in progress.
// ============================================================

export type ActiveGameSession = {
  kind: "game"
  /** build.id for builds, "minecraft:<version>" for vanilla launches */
  buildId: string
  buildName: string
  startedAt: number
  mcVersion?: string
}

export type ActiveServerSession = {
  kind: "server"
  serverId: string
  serverName: string
  icon?: string
  startedAt: number
}

let activeGame: ActiveGameSession | null = null
const activeServers = new Map<string, ActiveServerSession>()

export function setActiveGameSession(session: ActiveGameSession | null): void {
  activeGame = session
}

export function getActiveGameSession(): ActiveGameSession | null {
  return activeGame
}

export function upsertActiveServerSession(session: ActiveServerSession): void {
  activeServers.set(session.serverId, session)
}

/** Returns the active server session (if any) and removes it from the tracker. */
export function takeActiveServerSession(serverId: string): ActiveServerSession | null {
  const session = activeServers.get(serverId) ?? null
  if (session) activeServers.delete(serverId)
  return session
}

export function getActiveServerSessions(): ActiveServerSession[] {
  return [...activeServers.values()]
}