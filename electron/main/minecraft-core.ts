import path from "path"
import { fork, type ChildProcess } from "child_process"
import iconv from "iconv-lite"
import type * as XnlcCoreNS from "@xnlc/core" with { "resolution-mode": "import" }
import type { AuthSession, LoaderType, ResolvedLaunchRequest, XnlcHandler } from "@xnlc/core" with { "resolution-mode": "import" }
import { getMainWindow, sendToRenderer, logRuntime, logRuntimeDebug } from "./runtime"
import { dbHelpers, DbAccount } from "../db"
import { getGameStartTimestamp, setDiscordActivity } from "./discord-rpc"
import { getBuildIntentPath } from "./builds.js"

type LaunchAccountPayload = {
  type: "elyby" | "xnskins" | "microsoft" | "offline"
  username: string
  uuid?: string
  accessToken?: string
}

type LaunchResultPayload = {
  success: boolean
  pid?: number
  error?: string
}

type XnlcModule = typeof XnlcCoreNS

let xnlcModulePromise: Promise<XnlcModule> | null = null
let handler: XnlcHandler | undefined
let launchWorker: ChildProcess | null = null
let minecraftPid: number | null = null

export function loadXnlcModule(): Promise<XnlcModule> {
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
  logRuntimeDebug(`[MinecraftDebug] ${message}`)
  emitToMinecraft("minecraft:debug", message)
}

function emitGameData(message: string): void {
  emitToMinecraft("minecraft:data", message)
}

function setPresencePlaying(mcVersion: string, loaderType: LoaderType, buildName?: string): void {
  const state = buildName
    ? `Играет в ${buildName}`
    : `Играет в Minecraft ${mcVersion}`;
  setDiscordActivity({
    state,
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
  request: ResolvedLaunchRequest & { buildName?: string; gameDir?: string },
): Promise<LaunchResultPayload> {
  // If buildName is provided, use the build's intentPath as gameDir
  // Or if gameDir is directly provided (from use-home-launch.ts)
  let gameDir = request.gameDir ?? await getGameDir()
  if (request.buildName && !request.gameDir) {
    try {
      const buildIntentPath = getBuildIntentPath(request.buildName)
      if (buildIntentPath) {
        gameDir = buildIntentPath
        logRuntimeDebug(`[Minecraft] Using build intentPath: ${gameDir}`)
      }
    } catch (error) {
      logRuntime(`[Minecraft] Failed to get build intent path: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  const supportsSkinInjector = launchAccount.type === "xnskins" || launchAccount.type === "elyby"
  const retroauthEnabled = supportsSkinInjector
    && (await dbHelpers.getSetting("retroauthInjectorEnabled")) === "true"
  const useBmclapi = (await dbHelpers.getSetting("useBmclapi")) === "true"
  const workerPath = path.join(__dirname, "minecraft-launch-worker.js")
  logRuntimeDebug(`[Minecraft] Starting launch worker path=${workerPath}`)
  logRuntime(`[Minecraft] Launch request mc=${request.mcVersion} loader=${request.loaderType} loaderVersion=${request.loaderVersion ?? ""} gameDir=${gameDir} account=${launchAccount.type}:${launchAccount.username} retroauth=${String(retroauthEnabled)}`)
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

    type WorkerMessage = { type: string; message?: string; progress?: Record<string, unknown>; pid?: number; code?: number; error?: string; data?: string }
    worker.on("message", (raw: unknown) => {
      const payload = raw as WorkerMessage | null
      if (!payload) return
      logRuntimeDebug(`[Minecraft] Worker message type=${payload.type ?? "unknown"}`)

      switch (payload.type) {
        case "worker-debug":
          emitDebug(`[XNLC] ${payload.message ?? ""}`)
          return
        case "progress":
          emitToMinecraft("minecraft:download-progress", payload.progress)
          return
        case "java-progress":
          emitToMinecraft("minecraft:java-progress", payload.progress)
          return
        case "started":
          minecraftPid = typeof payload.pid === "number" ? payload.pid : null
          logRuntime(`[Minecraft] Worker reported started pid=${minecraftPid ?? 0}`)
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
          logRuntime(`[Minecraft] Worker reported close code=${typeof payload.code === "number" ? payload.code : 0}`)
          clearLaunchState()
          setPresenceMenu()
          emitToMinecraft("minecraft:close", typeof payload.code === "number" ? payload.code : 0)
          return
        case "error":
          logRuntime(`[Minecraft] Worker reported error ${payload.error ?? "Launch failed"}`)
          settle({ success: false, error: payload.error ?? "Launch failed" })
      }
    })

    worker.once("error", (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logRuntime(`[Minecraft] Worker process error ${errorMessage}`)
      console.error("Launch worker failed:", errorMessage)
      settle({ success: false, error: errorMessage })
    })

    worker.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      logRuntimeDebug(`[Minecraft] Worker process exit code=${code ?? 0} signal=${signal ?? ""} settled=${String(settled)}`)
      if (!settled) {
        const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
        settle({ success: false, error: `Launch worker exited unexpectedly (${reason})` })
        return
      }

      clearLaunchState()
    })

    worker.stdout?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : iconv.decode(chunk, "cp866")
      emitDebug(`[XNLC] ${text}`)
    })
    worker.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : iconv.decode(chunk, "cp866")
      emitDebug(`[XNLC] ${text}`)
    })

    try {
      worker.send({
        type: "launch",
        payload: {
          gameDir,
          account: launchAccount,
          options: {
            ...request,
            retroauthEnabled,
            useBmclapi,
          },
        },
      })
      logRuntimeDebug("[Minecraft] Launch payload sent to worker")

      setPresencePlaying(request.mcVersion, request.loaderType, request.buildName)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logRuntime(`[Minecraft] Failed to initialize launch worker ${errorMessage}`)
      console.error("Failed to initialize launch worker:", errorMessage)
      settle({ success: false, error: errorMessage })
    }
  })
}
