import path from "path"
import { fork, type ChildProcess } from "child_process"
import type { AuthSession, LoaderType, ResolvedLaunchRequest, XnlcHandler } from "@xnlc/core" with { "resolution-mode": "import" }
import { getMainWindow, sendToRenderer } from "./runtime"
import { dbHelpers, DbAccount } from "../db"
import { getGameStartTimestamp, setDiscordActivity } from "./discord-rpc"

type LaunchAccountPayload = {
  type: "elyby" | "xnskins" | "offline"
  username: string
  uuid?: string
  accessToken?: string
}

type LaunchResultPayload = {
  success: boolean
  pid?: number
  error?: string
}

let xnlcModulePromise: Promise<any> | null = null
let handler: XnlcHandler | null = null
let launchWorker: ChildProcess | null = null
let minecraftPid: number | null = null

export function loadXnlcModule(): Promise<any> {
  if (!xnlcModulePromise) {
    xnlcModulePromise = import("@xnlc/core")
  }
  return xnlcModulePromise
}

export function clearLaunchState(): void {
  launchWorker = null
  minecraftPid = null
}

export function stopLaunchWorker(): void {
  if (!launchWorker || launchWorker.killed) {
    clearLaunchState()
    return
  }

  const worker = launchWorker

  try {
    worker.send({ type: "stop" })
  } catch {
    // ignore
  }

  setTimeout(() => {
    if (launchWorker !== worker || worker.killed) {
      return
    }

    try {
      worker.kill("SIGTERM")
    } catch {
      // ignore
    }
  }, 3000)
}

export function isLaunchActive(): boolean {
  return (!!launchWorker && !launchWorker.killed) || minecraftPid !== null
}

export async function getGameDir(): Promise<string> {
  const { getDefaultMinecraftRootFromEnv } = await loadXnlcModule()
  return getDefaultMinecraftRootFromEnv()
}

export async function getHandler(): Promise<XnlcHandler> {
  if (!handler) {
    const { createDefaultHandler } = await loadXnlcModule()
    handler = createDefaultHandler({
      memoryMax: "4G",
      memoryMin: "2G",
    })
  }

  return handler
}

function emitToMinecraft(channel: string, payload: unknown): void {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  sendToRenderer(channel, payload)
}

function emitDebug(message: string): void {
  emitToMinecraft("minecraft:debug", message)
}

function emitGameData(message: string): void {
  emitToMinecraft("minecraft:data", message)
}

function setPresencePlaying(mcVersion: string, loaderType: LoaderType): void {
  setDiscordActivity({
    state: `Играет в Minecraft ${mcVersion}`,
    loader: loaderType !== "vanilla" ? loaderType : undefined,
    startTimestamp: Math.floor(Date.now() / 1000),
  })
}

function setPresenceMenu(): void {
  setDiscordActivity({
    state: "В меню",
    startTimestamp: getGameStartTimestamp(),
  })
}

export async function callHandler<T>(
  label: string,
  fallback: T,
  action: (handler: XnlcHandler) => Promise<T>,
): Promise<T> {
  try {
    return await action(await getHandler())
  } catch (error) {
    console.error(`Failed to ${label}:`, error)
    return fallback
  }
}

export async function resolveLaunchAccount(requestAccount?: LaunchAccountPayload): Promise<DbAccount | undefined> {
  const accounts = await dbHelpers.loadAccounts()

  if (requestAccount?.username) {
    return accounts.find((account) => account.type === requestAccount.type && account.username === requestAccount.username) ?? {
      id: requestAccount.uuid ?? `${requestAccount.type}:${requestAccount.username}`,
      type: requestAccount.type,
      username: requestAccount.username,
      isActive: true,
      uuid: requestAccount.uuid,
      accessToken: requestAccount.accessToken,
    }
  }

  return accounts.find((account) => account.isActive) ?? accounts[0]
}

export async function runLaunchWorker(
  launchAccount: DbAccount,
  request: ResolvedLaunchRequest,
): Promise<LaunchResultPayload> {
  const gameDir = await getGameDir()
  const retroauthEnabled = (await dbHelpers.getSetting("retroauthInjectorEnabled")) === "true"
  const workerPath = path.join(__dirname, "minecraft-launch-worker.js")
  const worker = fork(workerPath, [], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: process.env,
  })
  launchWorker = worker
  minecraftPid = null

  return new Promise<LaunchResultPayload>((resolve) => {
    let settled = false

    const settle = (result: LaunchResultPayload): void => {
      if (settled) {
        return
      }

      settled = true
      if (!result.success) {
        clearLaunchState()
      }
      resolve(result)
    }

    worker.on("message", (message: any) => {
      const payload = message ?? {}

      switch (payload.type) {
        case "worker-debug":
          emitDebug(`[XNLC] ${payload.message ?? ""}`)
          return
        case "progress":
          emitToMinecraft("minecraft:download-progress", payload.progress)
          return
        case "started":
          minecraftPid = typeof payload.pid === "number" ? payload.pid : null
          emitGameData("[Launcher] Minecraft process started")
          settle({ success: true, pid: minecraftPid ?? undefined })
          return
        case "stdout":
          emitGameData(payload.data ?? "")
          return
        case "stderr":
          emitDebug(payload.data ?? "")
          return
        case "close":
          clearLaunchState()
          setPresenceMenu()
          emitToMinecraft("minecraft:close", typeof payload.code === "number" ? payload.code : 0)
          return
        case "error":
          settle({ success: false, error: payload.error ?? "Launch failed" })
      }
    })

    worker.once("error", (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error("Launch worker failed:", errorMessage)
      settle({ success: false, error: errorMessage })
    })

    worker.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (!settled) {
        const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
        settle({ success: false, error: `Launch worker exited unexpectedly (${reason})` })
        return
      }

      clearLaunchState()
    })

    worker.stdout?.on("data", (chunk: Buffer | string) => emitDebug(`[XNLC] ${chunk.toString()}`))
    worker.stderr?.on("data", (chunk: Buffer | string) => emitDebug(`[XNLC] ${chunk.toString()}`))

    try {
      worker.send({
        type: "launch",
        payload: {
          gameDir,
          account: launchAccount,
          options: {
            ...request,
            retroauthEnabled,
          },
        },
      })

      setPresencePlaying(request.mcVersion, request.loaderType)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error("Failed to initialize launch worker:", errorMessage)
      settle({ success: false, error: errorMessage })
    }
  })
}
