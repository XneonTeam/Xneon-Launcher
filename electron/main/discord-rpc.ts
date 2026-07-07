import fs from "fs/promises"
import path from "path"

const CLIENT_ID = "1279183673660538972"
let rpc: any = null
let connected = false
let pendingActivity: { state?: string; largeImageKey?: string; largeImageText?: string; smallImageKey?: string; smallImageText?: string; loader?: string; startTimestamp?: number } | null = null
let gameStartTimestamp: number | undefined = undefined

export function getGameStartTimestamp(): number | undefined {
  return gameStartTimestamp
}

async function getRuntimeDirCandidates(): Promise<string[]> {
  if (process.platform === "win32") return []

  const uid = typeof process.getuid === "function" ? process.getuid() : undefined
  const runUserDir = uid !== undefined ? path.join("/run/user", String(uid)) : undefined

  const baseDirs = [
    process.env.XDG_RUNTIME_DIR,
    runUserDir,
    process.env.TMPDIR,
    process.env.TEMP,
    process.env.TMP,
    "/tmp",
  ].filter((dir): dir is string => !!dir)

  const candidates = [
    ...(runUserDir ? [
      path.join(runUserDir, "app", "com.discordapp.DiscordCanary"),
      path.join(runUserDir, ".flatpak", "com.discordapp.DiscordCanary", "xdg-run"),
      path.join(runUserDir, "app", "com.discordapp.DiscordPTB"),
      path.join(runUserDir, ".flatpak", "com.discordapp.DiscordPTB", "xdg-run"),
    ] : []),
    ...baseDirs,
  ]

  const results: string[] = []
  for (const dir of [...new Set(candidates)]) {
    try {
      await fs.access(dir)
      results.push(dir)
    } catch {}
  }
  return results
}

async function hasDiscordIpcSocket(runtimeDir: string): Promise<boolean> {
  for (let i = 0; i < 10; i += 1) {
    try {
      await fs.access(path.join(runtimeDir, `discord-ipc-${i}`))
      return true
    } catch { }
  }
  return false
}

async function loginWithRuntimeDir(runtimeDir?: string): Promise<any> {
  const { Client } = await import("discord-rpc")
  const previousRuntimeDir = process.env.XDG_RUNTIME_DIR
  const client = new Client({ transport: "ipc" })

  client.on("disconnected", () => {
    connected = false
  })

  client.on("error", (err: { code: number }) => {
    if (err.code !== 1000) {
      console.error("Discord RPC error:", err)
    }
    connected = false
  })

  client.on("ready", () => {
    connected = true
  })

  try {
    if (runtimeDir) {
      process.env.XDG_RUNTIME_DIR = runtimeDir
    }
    await client.login({ clientId: CLIENT_ID })
    return client
  } finally {
    if (previousRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = previousRuntimeDir
    }
  }
}

export async function initDiscordRpc(): Promise<void> {
  if (connected) return

  if (process.platform === "win32") {
    try {
      rpc = await loginWithRuntimeDir()
      return
    } catch { }
    return
  }

  const runtimeDirs = await getRuntimeDirCandidates()
  const preferredRuntimeDirs: string[] = []
  for (const dir of runtimeDirs) {
    if (await hasDiscordIpcSocket(dir)) {
      preferredRuntimeDirs.push(dir)
    }
  }
  const candidates = preferredRuntimeDirs.length > 0 ? preferredRuntimeDirs : runtimeDirs

  for (const runtimeDir of candidates) {
    try {
      rpc = await loginWithRuntimeDir(runtimeDir)
      return
    } catch {
      rpc = null
    }
  }
}

export function setDiscordActivity(activity: {
  state?: string
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  loader?: string
  startTimestamp?: number
}): void {
  if (activity.startTimestamp) {
    gameStartTimestamp = activity.startTimestamp
  }
  if (!connected || !rpc) {
    pendingActivity = activity
    initDiscordRpc()
    return
  }
  applyActivity(activity)
}

type DiscordActivity = {
  state?: string
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  loader?: string
  startTimestamp?: number
}

function applyActivity(activity: DiscordActivity): void {
  const {
    state = "В меню",
    largeImageKey = "logo",
    largeImageText = "Xneon Launcher",
    smallImageKey,
    smallImageText,
    loader,
    startTimestamp,
  } = activity

  const activityData: Record<string, unknown> = {
    state,
    largeImageKey,
    largeImageText,
    buttons: [
      { label: "Сайт Лаунчера", url: "https://launcher.xneon.fun" },
      { label: "Discord Сервер", url: "https://discord.gg/a9mDjtqcbQ" },
    ],
  }

if (smallImageKey) {
    activityData.smallImageKey = smallImageKey
    if (smallImageText) {
      activityData.smallImageText = smallImageText
    }
  }

  const loaderIcons: Record<string, string> = {
    fabric: "fabric_icon",
    quilt: "quilt_icon",
    optifine: "optifine_icon",
  }

  const loaderNames: Record<string, string> = {
    fabric: "Fabric",
    quilt: "Quilt",
    optifine: "OptiFine",
  }

  const finalSmallImageKey = loader ? loaderIcons[loader.toLowerCase()] : smallImageKey
  const finalSmallImageText = loader ? loaderNames[loader.toLowerCase()] : smallImageText

  if (finalSmallImageKey) {
    activityData.smallImageKey = finalSmallImageKey
    if (finalSmallImageText) {
      activityData.smallImageText = finalSmallImageText
    }
  }

  if (startTimestamp) {
    activityData.startTimestamp = startTimestamp
    gameStartTimestamp = startTimestamp
  } else if (gameStartTimestamp) {
    activityData.startTimestamp = gameStartTimestamp
  }

  console.log("[DiscordRPC] setActivity - state:", state, "timestamp:", activityData.startTimestamp)
  rpc?.setActivity(activityData).catch((err: unknown) => {
    console.error("[DiscordRPC] Failed to set activity:", err)
    connected = false
  })
}

export function clearDiscordActivity(): void {
  if (!connected || !rpc) return
  rpc.clearActivity().catch(console.error)
}

export function reconnectDiscordRpc(): void {
  connected = false
  if (rpc) {
    rpc.destroy().catch(() => {})
    rpc = null
  }
  initDiscordRpc()
}

export function isDiscordRpcConnected(): boolean {
  return connected
}

setTimeout(() => {
  initDiscordRpc()
}, 2000)
