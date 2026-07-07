import type { ServerEntry, ServerStatus } from "./types"

export function createOfflineStatus(ip: string): ServerStatus {
  return {
    online: false,
    ip,
    port: 0,
    players_online: 0,
    players_max: 0,
    motd_clean: "",
    version: "",
    latency_ms: 0,
  }
}

export function normalizeServerStatus(ip: string, payload: unknown): ServerStatus {
  const value = payload && typeof payload === "object" ? payload as Partial<ServerStatus> : {}

  return {
    online: typeof value.online === "boolean" ? value.online : false,
    ip: typeof value.ip === "string" && value.ip.trim() ? value.ip : ip,
    port: typeof value.port === "number" ? value.port : 0,
    players_online: typeof value.players_online === "number" ? value.players_online : 0,
    players_max: typeof value.players_max === "number" ? value.players_max : 0,
    motd_raw: typeof value.motd_raw === "string" ? value.motd_raw : undefined,
    motd_clean: typeof value.motd_clean === "string" ? value.motd_clean : "",
    version: typeof value.version === "string" ? value.version : "",
    latency_ms: typeof value.latency_ms === "number" ? value.latency_ms : 0,
    icon: typeof value.icon === "string" ? value.icon : undefined,
  }
}

export function formatPlayers(value: number) {
  return value.toLocaleString("ru-RU")
}

export function buildServerEntry(server: { name: string; ip: string; isFavorite?: boolean }): ServerEntry {
  return {
    name: server.name,
    ip: server.ip,
    status: null,
    loading: true,
    error: null,
    isFavorite: server.isFavorite ?? false,
  }
}
