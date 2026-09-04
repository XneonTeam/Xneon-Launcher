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

export type McServerDownloadProgress = {
  id: string
  progress: {
    phase: "installing-pack" | "done"
    message: string
    percent?: number
  }
}
