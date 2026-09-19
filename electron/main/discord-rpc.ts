import fs from "fs/promises"
import path from "path"

const CLIENT_ID = "1279183673660538972"
const RETRY_DELAY_MS = 15_000
let rpc: any = null
let connected = false
let connecting = false
let retryTimer: NodeJS.Timeout | null = null
let pendingActivity: DiscordActivity | null = null
let lastActivity: DiscordActivity | null = null
let gameStartTimestamp: number | undefined = undefined

export function getGameStartTimestamp(): number | undefined {
  return gameStartTimestamp
}

export function resetGameStartTimestamp(): void {
  gameStartTimestamp = undefined
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
    rpc = null
    scheduleRetry()
  })

  client.on("error", (err: { code: number }) => {
    if (err.code !== 1000) {
      console.error("Discord RPC error:", err)
    }
    connected = false
    rpc = null
    scheduleRetry()
  })

  client.on("ready", () => {
    connected = true
    flushPendingActivity()
  })

  try {
    if (runtimeDir) {
      process.env.XDG_RUNTIME_DIR = runtimeDir
    }
    await client.login({ clientId: CLIENT_ID })
    // discord-rpc resolves login() once the READY frame arrived, so a pending
    // activity must be flushed here even if the "ready" event raced us.
    connected = true
    return client
  } finally {
    if (previousRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = previousRuntimeDir
    }
  }
}

function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (!connected) {
      void initDiscordRpc()
    }
  }, RETRY_DELAY_MS)
  // Never keep the Electron process alive just for the retry timer.
  retryTimer.unref?.()
}

function flushPendingActivity(): void {
  if (!connected || !rpc) return
  const activity = pendingActivity ?? lastActivity
  if (!activity) return
  pendingActivity = null
  applyActivity(activity)
}

export async function initDiscordRpc(): Promise<void> {
  if (connected || connecting) return
  connecting = true

  try {
    if (process.platform === "win32") {
      try {
        rpc = await loginWithRuntimeDir()
      } catch {
        rpc = null
      }
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
  } finally {
    connecting = false
    if (connected) {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      flushPendingActivity()
    } else {
      // Discord may simply not be running yet — keep retrying in the background
      // so the presence shows up without requiring a game launch first.
      scheduleRetry()
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
  lastActivity = activity
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
      { label: "Сайт Лаунчера", url: "https://launcher.xneon.org" },
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
    rpc = null
    scheduleRetry()
  })
}

export function clearDiscordActivity(): void {
  lastActivity = null
  pendingActivity = null
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

// Launcher just started — publish the "in menu" presence right away instead of
// waiting for the first game launch to set any activity.
setTimeout(() => {
  setDiscordActivity({ state: "В меню" })
}, 1500)
