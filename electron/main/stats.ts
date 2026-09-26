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
import { listTrashedBuildMeta } from "./builds/trash-meta"
import type { GameSessionInfo, StatsOverview, StatsRange } from "@xnlc/types" with { "resolution-mode": "import" }

const DAY_MS = 86_400_000
const DEFAULT_RANGE_DAYS = 30

/** Inclusive [from, to] window; defaults to the last 30 days when omitted. */
function resolveRange(range?: StatsRange): { from: number; to: number } {
  const now = Date.now()
  let from = now - DEFAULT_RANGE_DAYS * DAY_MS
  let to = now
  if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
    from = Math.min(range.from, range.to)
    to = Math.max(range.from, range.to)
  }
  // Normalize to whole local days so the chart's day buckets line up.
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  return { from: start.getTime(), to: end.getTime() }
}

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

/**
 * Разовая уборка сессий сборок, которых больше нет в БД.
 *
 * Живёт здесь, а не в `initDatabase`: сборки в корзине тоже отсутствуют в таблице
 * `builds` (запись удаляется при перемещении), но они восстановимы, поэтому их
 * сессии защищаем по снапшотам корзины — статистика уходит только при очистке
 * корзины (`build:purge-trash`). Дополнительно нужен каталог инстансов, который
 * читается из настроек уже после инициализации БД.
 *
 * @returns сколько записей удалено
 */
export async function cleanupOrphanGameSessions(): Promise<number> {
  const trashed = await listTrashedBuildMeta()
  const ids = trashed.map((meta) => meta.id).filter((id): id is string => !!id)
  // Снапшоты старых записей корзины могли не сохранить id — тогда опираемся на имя.
  const names = trashed.filter((meta) => !meta.id && meta.name).map((meta) => meta.name as string)
  return dbHelpers.deleteOrphanGameSessions({ ids, names })
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

/** Собирает сводку статистики; экспортируется ради прямого вызова в проверках. */
export async function buildOverview(range?: StatsRange): Promise<StatsOverview> {
  const { from, to } = resolveRange(range)
  // Читаем только диапазон: полное чтение game_sessions + фильтрация в JS
  // становилось полным сканом таблицы на каждый вызов (а страница статистики
  // обновлялась каждые 5 с).
  const rows = await dbHelpers.listGameSessionsInRange(from, to)
  const sessions = sessionsFromRows(rows)

  // Real-time: include the in-progress game session so totals tick up
  // while Minecraft is running — but only when it started inside the range.
  const activeGameRaw = getActiveGameSession()
  const activeGame = activeGameRaw && activeGameRaw.startedAt >= from && activeGameRaw.startedAt <= to ? activeGameRaw : null
  const activeGameElapsed = activeGame ? liveElapsed(activeGame.startedAt) : 0

  const totalPlaytime = sessions.reduce((sum, s) => sum + s.duration, 0) + activeGameElapsed
  // Живая сессия учитывается и в общем времени, и в количестве — иначе средняя
  // сессия скачет вверх, пока игра запущена.
  const totalSessions = sessions.length + (activeGameElapsed > 0 ? 1 : 0)
  const averageSession = totalSessions > 0 ? Math.round(totalPlaytime / totalSessions) : 0

  // Статистике нужны только имена и иконки сборок. Полный `loadBuilds()` здесь
  // читал и разбирал JSON всего тяжёлого контента (десятки мегабайт на ~20
  // сборок) — и делал это на каждом обновлении страницы статистики (раз в 5 с).
  const builds = await dbHelpers.loadBuildsLight()
  const buildNames = new Map(builds.map((b) => [b.id, b.name]))
  const buildIcons = new Map(builds.map((b) => [b.id, b.icon]))

  // Сборки в корзине: запись в `builds` удаляется сразу при перемещении в
  // корзину, а сессии остаются до её очистки. Без снапшота метаданных у такой
  // сборки в рейтинге пропадала иконка (имя подставлялось из `buildName`
  // сессии). Снапшот лежит рядом с папкой в корзине — см. `builds/trash-meta`.
  const trashedBuilds = await listTrashedBuildMeta()
  const trashedByName = new Map<string, { name?: string; icon?: string }>()
  for (const meta of trashedBuilds) {
    if (meta.id && !buildNames.has(meta.id)) buildNames.set(meta.id, meta.name ?? "")
    if (meta.id && meta.icon && !buildIcons.has(meta.id)) buildIcons.set(meta.id, meta.icon)
    if (meta.name) trashedByName.set(meta.name, meta)
  }

  /** Иконка сборки: сначала БД, затем снапшот корзины по имени сессии. */
  const iconForBuild = (buildId: string, buildName?: string): string | undefined =>
    buildIcons.get(buildId) ?? (buildName ? trashedByName.get(buildName)?.icon : undefined)
  /** Имя сборки: БД → снапшот корзины → имя из сессии. */
  const nameForBuild = (buildId: string, buildName?: string): string =>
    buildNames.get(buildId) || (buildName ? trashedByName.get(buildName)?.name : undefined) || buildName || "—"

  // Per-day playtime across the selected range (oldest → newest for the chart).
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
  const startDay = new Date(from)
  startDay.setHours(0, 0, 0, 0)
  const endDay = new Date(to)
  endDay.setHours(0, 0, 0, 0)
  for (let t = startDay.getTime(); t <= endDay.getTime() && dailyPlaytime.length < 1000; t += DAY_MS) {
    const key = localDateKey(t)
    dailyPlaytime.push({ date: key, seconds: dailyMap.get(key) ?? 0 })
  }
  if (dailyPlaytime.length === 0) {
    dailyPlaytime.push({ date: localDateKey(Date.now()), seconds: dailyMap.get(localDateKey(Date.now())) ?? 0 })
  }

  // Top builds by playtime (includes the live in-progress session).
  const byBuild = new Map<string, { seconds: number; sessions: number; name: string; icon?: string }>()
  for (const session of sessions) {
    const entry = byBuild.get(session.buildId) ?? {
      seconds: 0,
      sessions: 0,
      name: nameForBuild(session.buildId, session.buildName),
      icon: iconForBuild(session.buildId, session.buildName),
    }
    entry.seconds += session.duration
    entry.sessions += 1
    byBuild.set(session.buildId, entry)
  }
  if (activeGame && activeGameElapsed > 0) {
    const entry = byBuild.get(activeGame.buildId) ?? {
      seconds: 0,
      sessions: 0,
      name: nameForBuild(activeGame.buildId, activeGame.buildName),
      icon: iconForBuild(activeGame.buildId, activeGame.buildName),
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
  // servers that are still running right now) inside the selected range.
  const serverRows = await dbHelpers.listServerSessionsInRange(from, to)
  const activeServers = getActiveServerSessions().filter((a) => a.startedAt >= from && a.startedAt <= to)
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
  for (const active of activeServers) {
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
  const serverTotalSessions = serverRows.length + activeServers.filter((a) => liveElapsed(a.startedAt) > 0).length
  const serverAverageSession = serverTotalSessions > 0 ? Math.round(serverTotalUptime / serverTotalSessions) : 0

  // Server daily uptime across the selected range
  const serverDailyMap = new Map<string, number>()
  for (const row of serverRows) {
    const key = localDateKey(row.startedAt)
    serverDailyMap.set(key, (serverDailyMap.get(key) ?? 0) + row.duration)
  }
  for (const active of activeServers) {
    const elapsed = liveElapsed(active.startedAt)
    if (elapsed <= 0) continue
    const key = localDateKey(active.startedAt)
    serverDailyMap.set(key, (serverDailyMap.get(key) ?? 0) + elapsed)
  }
  const dailyServerUptime: Array<{ date: string; seconds: number }> = []
  for (let t = startDay.getTime(); t <= endDay.getTime() && dailyServerUptime.length < 1000; t += DAY_MS) {
    const key = localDateKey(t)
    dailyServerUptime.push({ date: key, seconds: serverDailyMap.get(key) ?? 0 })
  }
  if (dailyServerUptime.length === 0) {
    dailyServerUptime.push({ date: localDateKey(Date.now()), seconds: 0 })
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
    rangeFrom: from,
    rangeTo: to,
    dailyPlaytime,
    topBuilds,
    serverTotalUptime,
    serverTotalSessions,
    serverAverageSession,
    serverLastSession,
    dailyServerUptime,
    topServers,
    // Флаги «что-то сейчас запущено»: по ним страница статистики решает,
    // нужен ли локальный тик (live-время) — постоянный 5-с поллинг убран.
    gameActiveStartedAt: activeGameRaw?.startedAt ?? null,
    activeServerSessions: getActiveServerSessions().length,
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
  ipcMain.handle("stats:overview", async (_event, range?: StatsRange): Promise<StatsOverview> => buildOverview(range))
}