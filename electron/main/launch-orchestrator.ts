import { toErrorMessage } from "./errors"
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
import { resetGameStartTimestamp, setDiscordActivity } from "./discord-rpc"
import { getBuildIntentPath } from "./builds"
import { pruneStaleLoaderProfiles } from "./builds/loader-profiles"
import { recordGameSession } from "./stats"
import { setActiveGameSession } from "./session-tracker"
import { detectMinecraftCrash } from "./crash-detect"
import { syncMinecraftLanguage } from "./mc-language"

type LaunchAccountPayload = {
  type: "elyby" | "xnskins" | "microsoft" | "offline" | "authlib-injector"
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
  private vanillaLaunchTimestamp: number | null = null
  /** Игру остановили мы сами (Стоп/новый запуск) — это не краш. */
  private stoppedWorkers = new WeakSet<ChildProcess>()
  /**
   * Идёт подготовка запуска: до форка воркера выполняются сетевые операции
   * (метаданные/сессия authlib, скачивание JAR). Пока флаг стоит, запуск
   * считается активным, а «Стоп» отменяет подготовку.
   */
  private launchInProgress = false
  private launchAbort: AbortController | null = null

  // ---------- State queries ----------

  isActive(): boolean {
    return this.launchInProgress || (!!this.launchWorker && !this.launchWorker.killed) || this.minecraftPid !== null
  }

  clearState(): void {
    this.launchWorker = null
    this.minecraftPid = null
    this.buildLaunchTimestamps = new Map<string, number>()
    this.vanillaLaunchTimestamp = null
    this.launchInProgress = false
    this.launchAbort = null
  }

  stop(): void {
    this.cancelPreparation()
    this.stopWorker()
  }

  /** Отмена подготовки запуска: «Стоп» до появления воркера тоже должен работать. */
  private cancelPreparation(): void {
    if (!this.launchInProgress) return
    try {
      this.launchAbort?.abort()
    } catch {
      // ignore
    }
    logRuntime("[Minecraft] Launch preparation cancelled")
  }

  private stopWorker(): void {
    // Остановка — намеренная: процесс игры убивается через taskkill, и это тоже
    // даёт ненулевой код выхода. Без пометки воркера автопереход в логи считал
    // бы нажатие «Стоп» крашем игры.
    if (this.launchWorker) this.stoppedWorkers.add(this.launchWorker)

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
    request: ResolvedLaunchRequest & { buildName?: string; buildId?: string; gameDir?: string },
  ): Promise<LaunchResultPayload> {
    if (this.launchInProgress) {
      return { success: false, error: "Minecraft is already launching or running" }
    }

    // Флаг ставим до первой сетевой операции: иначе кнопка «Запустить» снова
    // доступна, и два запуска делят один JAR и один gameDir.
    this.launchInProgress = true
    const launchController = new AbortController()
    this.launchAbort = launchController
    const signal = launchController.signal

    /** Подготовка сорвалась/отменена — освобождаем флаг и возвращаем ошибку. */
    const failPending = (message: string): LaunchResultPayload => {
      if (this.launchAbort === launchController) {
        this.launchAbort = null
        this.launchInProgress = false
      }
      return { success: false, error: message }
    }

    let gameDir = request.gameDir ?? await getDefaultGameDir()
    if (request.buildName && !request.gameDir) {
      try {
        const buildIntentPath = getBuildIntentPath(request.buildName)
        if (buildIntentPath) {
          gameDir = buildIntentPath
          logRuntimeDebug(`[Minecraft] Using build intentPath: ${gameDir}`)
        }
      } catch (error) {
        logRuntime(`[Minecraft] Failed to get build intent path: ${toErrorMessage(error)}`)
      }
    }

    // Профили старых загрузчиков в папке сборки удаляются прямо перед запуском:
    // если пользователь сменил загрузчик/версию, оставшийся профиль конфликтует
    // с новым. Для обычного Minecraft (без сборки) папка общая — не трогаем.
    if (request.buildName) {
      const pruned = pruneStaleLoaderProfiles(gameDir, request.loaderType, request.loaderVersion)
      if (pruned.removed.length > 0) {
        logRuntime(`[Minecraft] Removed stale loader profiles: ${pruned.removed.join(", ")}`)
        // Удаление показываем отдельным шагом прогресса: при смене загрузчика
        // иначе видно только «устанавливается загрузчик», а старый профиль
        // исчезает молча.
        this.emitToRenderer("minecraft:download-progress", {
          installationPhase: "removing-previous-loader",
          removedLoaders: pruned.removed,
        })
      }
    }

    // Тумблер «язык Minecraft по языку лаунчера»: дописываем lang в options.txt
    // до старта игры. Внутри тумблер читается сам, ошибки не прерывают запуск.
    await syncMinecraftLanguage(gameDir, request.mcVersion)
    if (signal.aborted) return failPending("Launch cancelled")

    const retroauthEnabled = (launchAccount.type === "xnskins" || launchAccount.type === "elyby")
      && (await dbHelpers.getSetting("retroauthInjectorEnabled")) === "true"
    const useBmclapi = (await dbHelpers.getSetting("useBmclapi")) === "true"

    let authlibInjectorPayload: import("@xnlc/types").WorkerAuthlibInjectorPayload | undefined
    if (launchAccount.type === "authlib-injector") {
      const { ensureSession, buildWorkerAuthlibPayload } = await import("./authlib/index.js")
      const sessionOutcome = await ensureSession(launchAccount.id, signal)
      if (signal.aborted) return failPending("Launch cancelled")
      if (sessionOutcome.status === "expired") {
        return failPending(sessionOutcome.message ?? "Authorization token expired. Please sign in again.")
      }
      if (sessionOutcome.status === "refreshed") {
        const freshAccounts = await dbHelpers.loadAccounts()
        const refreshed = freshAccounts.find((a) => a.id === launchAccount.id)
        if (refreshed) {
          launchAccount = refreshed
        }
      }

      let server = launchAccount.serverId ? dbHelpers.getAuthServer(launchAccount.serverId) : null
      if (!server && launchAccount.serverUrl) {
        server = {
          id: launchAccount.serverId ?? "custom",
          url: launchAccount.serverUrl,
          name: launchAccount.serverName ?? "Custom Auth Server",
          nonEmailLogin: false,
          links: {},
        }
      }
      if (!server) {
        return failPending("Authorization server for this account not found")
      }

      try {
        logRuntime(`[AuthlibInjector] Preparing Minecraft launch for ${launchAccount.username} on ${server.url}`)
        authlibInjectorPayload = await buildWorkerAuthlibPayload(gameDir, server, undefined, signal)
      } catch (error) {
        if (signal.aborted) return failPending("Launch cancelled")
        return failPending(toErrorMessage(error))
      }
      if (signal.aborted) return failPending("Launch cancelled")
    }

    const workerPath = path.join(__dirname, "minecraft-launch-worker.js")
    logRuntimeDebug(`[Minecraft] Starting launch worker path=${workerPath}`)
    logRuntime(`[Minecraft] Launch request mc=${request.mcVersion} loader=${request.loaderType} loaderVersion=${request.loaderVersion ?? ""} gameDir=${gameDir} account=${launchAccount.type}:${launchAccount.username} retroauth=${String(retroauthEnabled)}`)

    // Воркер не форкаем, если запуск уже отменён: иначе отменённый запуск
    // всё равно стартовал бы игру.
    if (signal.aborted) return failPending("Launch cancelled")

    // Два JVM на один инстанс конфликтуют за файлы игры, поэтому прошлый запуск
    // гасим явно (и помечаем его как остановленный, а не упавший). Проверяем
    // именно воркер: isActive() учитывает и нашу собственную подготовку.
    if (this.launchWorker && !this.launchWorker.killed) {
      logRuntime(`[Minecraft] Previous launch is still active — stopping it before the new one`)
      this.stopWorker()
    }

    const worker = fork(workerPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: process.env,
    })
    this.launchWorker = worker
    this.minecraftPid = null

    return new Promise<LaunchResultPayload>((resolve) => {
      let settled = false
      // Момент запуска: по нему отличаем crash-report этой сессии от старых.
      const launchStartedAt = Date.now()

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
            } else {
              this.vanillaLaunchTimestamp = Date.now()
            }
            setActiveGameSession({
              kind: "game",
              buildId: request.buildId ?? `minecraft:${request.mcVersion}`,
              buildName: request.buildName ?? `Minecraft ${request.mcVersion}`,
              startedAt: Date.now(),
              mcVersion: request.mcVersion,
            })
            this.emitGameData("[Launcher] Minecraft process started")
            settle({ success: true, pid: this.minecraftPid ?? undefined })
            return
          case "stdout":
            this.emitGameData(payload.data ?? "")
            return
          case "stderr":
            this.emitDebug(payload.data ?? "")
            return
          case "close": {
            const exitCode = typeof payload.code === "number" ? payload.code : 0
            // Краш — это ненулевой код выхода ИЛИ свежий crash-report. Обычный
            // выход из игры (крестик, «Выйти в меню») сюда не попадает, поэтому
            // на него лаунчер не будет перекидывать во вкладку логов.
            // Намеренную остановку тоже не считаем крашем: taskkill даёт код 1.
            const stoppedByUs = this.stoppedWorkers.has(worker)
            const crash = stoppedByUs
              ? { crashed: false, crashReport: null }
              : detectMinecraftCrash(gameDir, launchStartedAt, exitCode)
            if (stoppedByUs) {
              logRuntime(`[Minecraft] Process stopped from the launcher (code=${exitCode})`)
            } else if (crash.crashed) {
              logRuntime(`[Minecraft] Crash detected code=${exitCode} report=${crash.crashReport ?? "none"}`)
            }
            logRuntime(`[Minecraft] Worker reported close code=${exitCode}`)
            if (request.buildName) {
              const startTime = this.buildLaunchTimestamps.get(request.buildName)
              if (startTime) {
                const endTime = Date.now()
                const elapsed = Math.floor((endTime - startTime) / 1000)
                this.buildLaunchTimestamps.delete(request.buildName)
                if (elapsed > 0) {
                  const sessionBuildName = request.buildName
                  // Точечный поиск id по имени: раньше здесь читался полный
                  // список сборок вместе с JSON-контентом (десятки мегабайт)
                  // на каждый выход из игры.
                  dbHelpers.findBuildByName(sessionBuildName).then(build => {
                    if (build) {
                      dbHelpers.updateBuildPlaytime(build.id, elapsed)
                      void recordGameSession({
                        buildId: build.id,
                        buildName: build.name,
                        startedAt: startTime,
                        endedAt: endTime,
                        duration: elapsed,
                      })
                    }
                  }).catch(() => {})
                }
              }
            } else {
              // Vanilla Minecraft (no build/instance) — record the session so
              // regular Minecraft also shows up in statistics.
              const startTime = this.vanillaLaunchTimestamp
              this.vanillaLaunchTimestamp = null
              if (startTime) {
                const endTime = Date.now()
                const elapsed = Math.floor((endTime - startTime) / 1000)
                if (elapsed > 0) {
                  void recordGameSession({
                    buildId: `minecraft:${request.mcVersion}`,
                    buildName: `Minecraft ${request.mcVersion}`,
                    startedAt: startTime,
                    endedAt: endTime,
                    duration: elapsed,
                  })
                }
              }
            }
            setActiveGameSession(null)
            this.clearState()
            this.setPresenceMenu()
            this.emitToRenderer("minecraft:close", {
              code: exitCode,
              crashed: crash.crashed,
              stoppedByLauncher: stoppedByUs,
              ...(crash.crashReport ? { crashReport: crash.crashReport } : {}),
            })
            return
          }
          case "error":
            logRuntime(`[Minecraft] Worker reported error ${payload.error ?? "Launch failed"}`)
            settle({ success: false, error: payload.error ?? "Launch failed" })
        }
      })

      worker.once("error", (error: Error) => {
        const errorMessage = toErrorMessage(error)
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
              ...(authlibInjectorPayload ? { authlibInjector: authlibInjectorPayload } : {}),
            },
          },
        })
        logRuntimeDebug("[Minecraft] Launch payload sent to worker")
        this.setPresencePlaying(request.mcVersion, request.loaderType, request.buildName)
      } catch (error) {
        const errorMessage = toErrorMessage(error)
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
    // A finished game must not leave its elapsed timer running in the menu.
    resetGameStartTimestamp()
    setDiscordActivity({
      state: "В меню",
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
