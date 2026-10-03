// ============================================================
// MC Server Management Types
// Types for managing Minecraft server processes from the launcher
// ============================================================

export type McServerInfo = {
  id: string
  name: string
  gameVersion: string
  modloader: string
  modloaderVersion?: string
  port: number
  xmx: number
  xms: number
  extraJavaArgs: string
  javaPath?: string
  autoRestart: boolean
  icon?: string
  relayEnabled: boolean
  onlineMode: boolean
  maxPlayers: number
  createdAt: string
  trashedAt?: string
  source: "local" | "modrinth" | "curseforge"
  /** Категория/группа сервера в списке (как группы у сборок). */
  group?: string
}

export type McServerState =
  | { status: "stopped" }
  | { status: "starting"; startTime: number }
  | { status: "running"; startTime: number; pid: number }
  | { status: "stopping" }

export type McServerMetrics = {
  cpuPercent: number
  memoryMb: number
  uptimeSeconds: number
}

export type McPlayerEntry = {
  name: string
  uuid: string
}

export type McFsEntry = {
  name: string
  isDir: boolean
  size: number
  lastModified: number
}

export type ResolvedPlugin = {
  name: string
  sha1: string
  projectId?: string
  versionId?: string
}

export type XnConnectState =
  | { status: "stopped" }
  | { status: "auth_required"; authUrl: string }
  | { status: "starting" }
  | { status: "running"; publicAddress: string; tunnelId: string }
  | { status: "limit_reached"; used: number; max: number; plan: string }

export type XnConnectUsage = {
  used: number
  max: number
  plan: string
}

/**
 * Прогресс установки модпака на сервер. `phase` — свободная строка, потому что
 * main шлёт не только `installing-pack`/`done`, но и промежуточные этапы
 * скачивания; в байтовых полях приходит фактический прогресс загрузки.
 */
export type McServerDownloadProgress = {
  id: string
  progress: {
    phase: string
    message: string
    percent?: number
    bytesTotal?: number
    bytesDownloaded?: number
  }
}

/**
 * Ответ пинга сервера (SLP). Тип живёт здесь, а не в `@xnlc/servers`, потому что
 * пересекает границу IPC: его отдают контракты (`servers:ping`), его ждёт
 * preload, а «Быстрая игра» в renderer описывает ту же структуру своей копией —
 * тянуть в рендерер пакет серверов нельзя (он тянет `net`/`dns`).
 *
 * `@xnlc/servers` реэкспортирует тип для совместимости: `import { ServerStatusResult } from "@xnlc/servers"`.
 */
export type ServerStatusResult = {
  online: boolean
  ip: string
  port: number
  players_online: number
  players_max: number
  motd_raw?: string
  motd_clean?: string
  version: string
  latency_ms: number
  icon?: string
  error?: string
}
