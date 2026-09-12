// ============================================================
// XNLC — Game Statistics
// Aggregates game sessions (builds & vanilla Minecraft) and
// launcher-hosted MC server uptime sessions.
// ============================================================

import { ipcMain } from "electron"
import { randomUUID } from "crypto"
import { dbHelpers, type GameSessionRow } from "../db"
import { sendToRenderer } from "./runtime"
import { getActiveGameSession, getActiveServerSessions } from "./session-tracker"
import type { GameSessionInfo, StatsOverview } from "@xnlc/types" with { "resolution-mode": "import" }

const DAY_MS = 86_400_000

/** Emits an event so the Statistics page refreshes in real time. */
export function notifyStatsUpdated(): void {
  try {
    sendToRenderer("stats:updated", {})
  } catch {
    // ignore — no window yet
  }
}

function liveElapsed(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
}

function localDateKey(timestamp: number): string {
  const d = new Date(timestamp)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function sessionsFromRows(rows: GameSessionRow[]): GameSessionInfo[] {
  return rows.map((row) => ({
    id: row.id,
    buildId: row.buildId,
    buildName: row.buildName,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    duration: row.duration,
  }))
}

async function buildOverview(): Promise<StatsOverview> {
  const rows = await dbHelpers.listGameSessions()
  const sessions = sessionsFromRows(rows)

  // Real-time: include the in-progress game session so totals tick up
  // while Minecraft is running.
  const activeGame = getActiveGameSession()
  const activeGameElapsed = activeGame ? liveElapsed(activeGame.startedAt) : 0

  const totalPlaytime = sessions.reduce((sum, s) => sum + s.duration, 0) + activeGameElapsed
  // Живая сессия учитывается и в общем времени, и в количестве — иначе средняя
  // сессия скачет вверх, пока игра запущена.
  const totalSessions = sessions.length + (activeGameElapsed > 0 ? 1 : 0)
  const averageSession = totalSessions > 0 ? Math.round(totalPlaytime / totalSessions) : 0

  const builds = await dbHelpers.loadBuilds()
  const buildNames = new Map(builds.map((b) => [b.id, b.name]))
  const buildIcons = new Map(builds.map((b) => [b.id, b.icon]))

  // Per-day playtime for the last 30 days (oldest → newest for the chart).
  const dailyMap = new Map<string, number>()
  for (const session of sessions) {
    const key = localDateKey(session.startedAt)
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + session.duration)
  }
  if (activeGame && activeGameElapsed > 0) {
    const key = localDateKey(activeGame.startedAt)
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + activeGameElapsed)
  }
  const dailyPlaytime: Array<{ date: string; seconds: number }> = []
  for (let i = 29; i >= 0; i--) {
    const key = localDateKey(Date.now() - i * DAY_MS)
    dailyPlaytime.push({ date: key, seconds: dailyMap.get(key) ?? 0 })
  }

  // Top builds by playtime (includes the live in-progress session).
  const byBuild = new Map<string, { seconds: number; sessions: number; name: string; icon?: string }>()
  for (const session of sessions) {
    const entry = byBuild.get(session.buildId) ?? {
      seconds: 0,
      sessions: 0,
      name: buildNames.get(session.buildId) ?? session.buildName ?? "—",
      icon: buildIcons.get(session.buildId),
    }
    entry.seconds += session.duration
    entry.sessions += 1
    byBuild.set(session.buildId, entry)
  }
  if (activeGame && activeGameElapsed > 0) {
    const entry = byBuild.get(activeGame.buildId) ?? {
      seconds: 0,
      sessions: 0,
      name: buildNames.get(activeGame.buildId) ?? activeGame.buildName,
      icon: buildIcons.get(activeGame.buildId),
    }
    entry.seconds += activeGameElapsed
    // Живая сессия — это ещё одна сессия в рейтинге сборок (не только время)
    entry.sessions += 1
    byBuild.set(activeGame.buildId, entry)
  }
  const topBuilds = [...byBuild.entries()]
    .map(([buildId, entry]) => ({ buildId, name: entry.name, icon: entry.icon, seconds: entry.seconds, sessions: entry.sessions }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)

  // Launcher-hosted MC servers: aggregate uptime sessions (including
  // servers that are still running right now).
  const serverRows = await dbHelpers.listServerSessions()
  const serverMap = new Map<string, { seconds: number; sessions: number; name: string; icon?: string }>()
  for (const row of serverRows) {
    const entry = serverMap.get(row.serverId) ?? {
      seconds: 0,
      sessions: 0,
      name: row.serverName || "—",
      icon: row.icon ?? undefined,
    }
    entry.seconds += row.duration
    entry.sessions += 1
    serverMap.set(row.serverId, entry)
  }
  for (const active of getActiveServerSessions()) {
    const elapsed = liveElapsed(active.startedAt)
    if (elapsed <= 0) continue
    const entry = serverMap.get(active.serverId) ?? {
      seconds: 0,
      sessions: 0,
      name: active.serverName || "—",
      icon: active.icon,
    }
    entry.seconds += elapsed
    // Живой сервер — это ещё одна текущая сессия: учитываем её и в счётчике,
    // чтобы средняя сессия не была завышена (uptime с активной / сессии без неё).
    entry.sessions += 1
    serverMap.set(active.serverId, entry)
  }
  const serverTotalUptime = [...serverMap.values()].reduce((sum, e) => sum + e.seconds, 0)
  const serverTotalSessions = serverRows.length + getActiveServerSessions().filter((a) => liveElapsed(a.startedAt) > 0).length
  const serverAverageSession = serverTotalSessions > 0 ? Math.round(serverTotalUptime / serverTotalSessions) : 0

  // Server daily uptime for 30 days
  const serverDailyMap = new Map<string, number>()
  for (const row of serverRows) {
    const key = localDateKey(row.startedAt)
    serverDailyMap.set(key, (serverDailyMap.get(key) ?? 0) + row.duration)
  }
  for (const active of getActiveServerSessions()) {
    const elapsed = liveElapsed(active.startedAt)
    if (elapsed <= 0) continue
    const key = localDateKey(active.startedAt)
    serverDailyMap.set(key, (serverDailyMap.get(key) ?? 0) + elapsed)
  }
  const dailyServerUptime: Array<{ date: string; seconds: number }> = []
  for (let i = 29; i >= 0; i--) {
    const key = localDateKey(Date.now() - i * DAY_MS)
    dailyServerUptime.push({ date: key, seconds: serverDailyMap.get(key) ?? 0 })
  }

  const serverLastSession = serverRows[0] ? {
    id: serverRows[0].id,
    serverId: serverRows[0].serverId,
    serverName: serverRows[0].serverName,
    startedAt: serverRows[0].startedAt,
    endedAt: serverRows[0].endedAt,
    duration: serverRows[0].duration,
  } : null

  const topServers = [...serverMap.entries()]
    .map(([serverId, entry]) => ({ serverId, name: entry.name, icon: entry.icon, seconds: entry.seconds, sessions: entry.sessions }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)

  return {
    totalPlaytime,
    totalSessions,
    averageSession,
    lastSession: sessions[0] ?? null,
    dailyPlaytime,
    topBuilds,
    serverTotalUptime,
    serverTotalSessions,
    serverAverageSession,
    serverLastSession,
    dailyServerUptime,
    topServers,
  }
}

/** Records a finished game session (build or vanilla Minecraft). */
export async function recordGameSession(input: { buildId: string; buildName: string; startedAt: number; endedAt: number; duration: number }): Promise<void> {
  try {
    await dbHelpers.addGameSession({ id: randomUUID(), ...input })
    notifyStatsUpdated()
  } catch (error) {
    console.error("[Stats] Failed to record game session:", error)
  }
}

/** Records an uptime session of a launcher-hosted MC server. */
export async function recordServerSession(input: { serverId: string; serverName: string; icon?: string | null; startedAt: number; endedAt: number; duration: number }): Promise<void> {
  try {
    await dbHelpers.addServerSession({
      id: randomUUID(),
      serverId: input.serverId,
      serverName: input.serverName,
      icon: input.icon ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      duration: input.duration,
    })
    notifyStatsUpdated()
  } catch (error) {
    console.error("[Stats] Failed to record server session:", error)
  }
}

export function registerStatsHandlers(): void {
  ipcMain.handle("stats:overview", async (): Promise<StatsOverview> => buildOverview())
}