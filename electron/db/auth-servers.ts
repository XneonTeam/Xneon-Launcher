// ============================================================
// XNLC — DB: authlib_servers
// Persistent storage authorization servers Authlib-Injector.
// Fallback-режим (БД недоступна) держит список в памяти —
// как accounts/settings в core.ts.
// ============================================================

import type { AuthlibInjectorServer, AuthlibInjectorServerSummary } from "@xnlc/types" with { "resolution-mode": "import" }
import { queryAll, run, isDbAvailable, warnDbUnavailable } from "./core"

type AuthServerRow = {
  id: string
  url: string
  name: string
  nonEmailLogin: number
  links: string | null
  favicon: string | null
  metadataTimestamp: number | null
}

/** Fallback: список серверов в памяти при недоступной БД. */
const inMemoryServers = new Map<string, AuthlibInjectorServer>()

function rowToServer(row: AuthServerRow): AuthlibInjectorServer {
  let links: Record<string, string> = {}
  if (row.links) {
    try {
      const parsed = JSON.parse(row.links)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) links = parsed
    } catch {
      // битый JSON ссылок — не критично
    }
  }
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    nonEmailLogin: row.nonEmailLogin === 1,
    links,
    favicon: row.favicon ?? undefined,
    metadataTimestamp: row.metadataTimestamp ?? undefined,
  }
}

function toSummary(server: AuthlibInjectorServer): AuthlibInjectorServerSummary {
  return {
    id: server.id,
    url: server.url,
    name: server.name,
    nonEmailLogin: server.nonEmailLogin,
    links: server.links,
    favicon: server.favicon,
  }
}

export { toSummary as authServerToSummary }

/** Все сохранённые серверы. */
export function loadAuthServers(): AuthlibInjectorServer[] {
  if (!isDbAvailable()) {
    return Array.from(inMemoryServers.values())
  }
  const rows = queryAll<AuthServerRow>("SELECT * FROM authlib_servers ORDER BY name ASC")
  if (!Array.isArray(rows)) return []
  return rows.map(rowToServer)
}

export function getAuthServer(id: string): AuthlibInjectorServer | null {
  if (!isDbAvailable()) {
    return inMemoryServers.get(id) ?? null
  }
  const rows = queryAll<AuthServerRow>("SELECT * FROM authlib_servers WHERE id = ?", [id])
  if (Array.isArray(rows) && rows.length > 0) return rowToServer(rows[0])
  return null
}

/** Вставка/обновление сервера по id. */
export function saveAuthServer(server: AuthlibInjectorServer): void {
  if (!isDbAvailable()) {
    warnDbUnavailable("saveAuthServer")
    inMemoryServers.set(server.id, server)
    return
  }
  run(`
    INSERT OR REPLACE INTO authlib_servers (id, url, name, nonEmailLogin, links, favicon, metadataTimestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    server.id,
    server.url,
    server.name,
    server.nonEmailLogin ? 1 : 0,
    JSON.stringify(server.links ?? {}),
    server.favicon ?? null,
    server.metadataTimestamp ?? null,
  ])
}

export function deleteAuthServer(id: string): void {
  if (!isDbAvailable()) {
    inMemoryServers.delete(id)
    return
  }
  run("DELETE FROM authlib_servers WHERE id = ?", [id])
}

/**
 * Аккаунты, привязанные к серверу (type = "authlib-injector").
 * Нужно, чтобы при удалении сервера не оставить dangling references:
 * UI обязан предупредить пользователя.
 */
export function findAccountsByServer(serverId: string): Array<{ id: string; username: string }> {
  if (!isDbAvailable()) return []
  const rows = queryAll<{ id: string; username: string }>(
    "SELECT id, username FROM accounts WHERE type = 'authlib-injector' AND serverId = ?",
    [serverId],
  )
  return Array.isArray(rows) ? rows : []
}
