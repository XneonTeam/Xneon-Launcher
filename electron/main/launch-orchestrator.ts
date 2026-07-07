// ============================================================
// XNLC — Launch Orchestrator
// Encapsulates the Minecraft launch worker lifecycle
// Extracted from minecraft-core.ts
// ============================================================

import path from "path"
import { fork, type ChildProcess } from "child_process"
import type { LoaderType, ResolvedLaunchRequest } from "@xnlc/core" with { "resolution-mode": "import" }
import { getMainWindow, sendToRenderer, logRuntime, logRuntimeDebug } from "./runtime"
import { dbHelpers, type DbAccount } from "../db"
import { getGameStartTimestamp, setDiscordActivity } from "./discord-rpc"
import { getBuildIntentPath } from "./builds"

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

/**
 * Orchestrates the Minecraft launch process:
 * - Resolves the launch account
 * - Forks and manages the launch worker process
 * - Tracks playtime per build
 * - Emits IPC events to the renderer
 */
export class LaunchOrchestrator {
  private launchWorker: ChildProcess | null = null
  private minecraftPid: number | null = null
  private buildLaunchTimestamps = new Map<string, number>()

  // ---------- State queries ----------

  isActive(): boolean {
    return (!!this.launchWorker && !this.launchWorker.killed) || this.minecraftPid !== null
  }

  clearState(): void {
    this.launchWorker = null
    this.minecraftPid = null
    this.buildLaunchTimestamps = new Map<string, number>()
  }

  stop(): void {
    if (!this.launchWorker || this.launchWorker.killed) {
      this.clearState()
      return
    }

    const worker = this.launchWorker

    try {
      worker.send({ type: "stop" })
    } catch {
      // ignore
    }

    setTimeout(() => {
      if (this.launchWorker !== worker || worker.killed) {
        return
      }

      try {
        worker.kill("SIGTERM")
      } catch {
        // ignore
      }
    }, 3000)
  }

  // ---------- Account Resolution ----------

  async resolveLaunchAccount(requestAccount?: LaunchAccountPayload): Promise<DbAccount | undefined> {
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

  // ---------- Worker Lifecycle ----------

  async runLaunch(
    launchAccount: DbAccount,
    request: ResolvedLaunchRequest & { buildName?: string; gameDir?: string },
  ): Promise<LaunchResultPayload> {
    let gameDir = request.gameDir ?? await getDefaultGameDir()
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

    const retroauthEnabled = (launchAccount.type === "xnskins" || launchAccount.type === "elyby")
      && (await dbHelpers.getSetting("retroauthInjectorEnabled")) === "true"
    const useBmclapi = (await dbHelpers.getSetting("useBmclapi")) === "true"
    const workerPath = path.join(__dirname, "minecraft-launch-worker.js")
    logRuntimeDebug(`[Minecraft] Starting launch worker path=${workerPath}`)
    logRuntime(`[Minecraft] Launch request mc=${request.mcVersion} loader=${request.loaderType} loaderVersion=${request.loaderVersion ?? ""} gameDir=${gameDir} account=${launchAccount.type}:${launchAccount.username} retroauth=${String(retroauthEnabled)}`)

    const worker = fork(workerPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: process.env,
    })
    this.launchWorker = worker
    this.minecraftPid = null

    return new Promise<LaunchResultPayload>((resolve) => {
      let settled = false

      const settle = (result: LaunchResultPayload): void => {
        if (settled) return
        settled = true
        if (!result.success) {
          this.clearState()
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
            this.emitDebug(`[XNLC] ${payload.message ?? ""}`)
            return
          case "progress":
            this.emitToRenderer("minecraft:download-progress", payload.progress)
            return
          case "java-progress":
            this.emitToRenderer("minecraft:java-progress", payload.progress)
            return
          case "started":
            this.minecraftPid = typeof payload.pid === "number" ? payload.pid : null
            logRuntime(`[Minecraft] Worker reported started pid=${this.minecraftPid ?? 0}`)
            if (request.buildName) {
              this.buildLaunchTimestamps.set(request.buildName, Date.now())
            }
            this.emitGameData("[Launcher] Minecraft process started")
            settle({ success: true, pid: this.minecraftPid ?? undefined })
            return
          case "stdout":
            this.emitGameData(payload.data ?? "")
            return
          case "stderr":
            this.emitDebug(payload.data ?? "")
            return
          case "close":
            logRuntime(`[Minecraft] Worker reported close code=${typeof payload.code === "number" ? payload.code : 0}`)
            if (request.buildName) {
              const startTime = this.buildLaunchTimestamps.get(request.buildName)
              if (startTime) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000)
                this.buildLaunchTimestamps.delete(request.buildName)
                if (elapsed > 0) {
                  dbHelpers.loadBuilds().then(builds => {
                    const build = builds.find(b => b.name === request.buildName)
                    if (build) {
                      dbHelpers.updateBuildPlaytime(build.id, elapsed)
                    }
                  })
                }
              }
            }
            this.clearState()
            this.setPresenceMenu()
            this.emitToRenderer("minecraft:close", typeof payload.code === "number" ? payload.code : 0)
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
        this.clearState()
      })

      const decodeChunk = async (chunk: Buffer | string): Promise<string> => {
        if (typeof chunk === "string") return chunk
        const iconv = await import("iconv-lite")
        return iconv.default.decode(chunk, "cp866")
      }

      worker.stdout?.on("data", (chunk: Buffer | string) => {
        decodeChunk(chunk).then(text => this.emitDebug(`[XNLC] ${text}`))
      })
      worker.stderr?.on("data", (chunk: Buffer | string) => {
        decodeChunk(chunk).then(text => this.emitDebug(`[XNLC] ${text}`))
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
        this.setPresencePlaying(request.mcVersion, request.loaderType, request.buildName)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logRuntime(`[Minecraft] Failed to initialize launch worker ${errorMessage}`)
        console.error("Failed to initialize launch worker:", errorMessage)
        settle({ success: false, error: errorMessage })
      }
    })
  }

  // ---------- Private Helpers ----------

  private emitToRenderer(channel: string, payload: unknown): void {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    sendToRenderer(channel, payload)
  }

  private emitDebug(message: string): void {
    logRuntimeDebug(`[MinecraftDebug] ${message}`)
    this.emitToRenderer("minecraft:debug", message)
  }

  private emitGameData(message: string): void {
    this.emitToRenderer("minecraft:data", message)
  }

  private setPresencePlaying(mcVersion: string, loaderType: LoaderType, buildName?: string): void {
    const state = buildName
      ? `Играет в ${buildName}`
      : `Играет в Minecraft ${mcVersion}`;
    setDiscordActivity({
      state,
      loader: loaderType !== "vanilla" ? loaderType : undefined,
      startTimestamp: Math.floor(Date.now() / 1000),
    })
  }

  private setPresenceMenu(): void {
    setDiscordActivity({
      state: "В меню",
      startTimestamp: getGameStartTimestamp(),
    })
  }
}

// ---------- Module-level helpers ----------

async function getDefaultGameDir(): Promise<string> {
  const { getDefaultMinecraftRootFromEnv } = await import("@xnlc/core")
  return getDefaultMinecraftRootFromEnv()
}

/** Singleton orchestrator instance */
let orchestrator: LaunchOrchestrator | null = null

export function getLaunchOrchestrator(): LaunchOrchestrator {
  if (!orchestrator) orchestrator = new LaunchOrchestrator()
  return orchestrator
}
