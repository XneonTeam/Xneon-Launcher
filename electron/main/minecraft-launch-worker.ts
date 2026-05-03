import type { ChildProcess } from "child_process"

let minecraftProcess: ChildProcess | null = null
let launchStarted = false

function normalizeJavaPath(javaPath?: string): string | undefined {
  if (!javaPath) return javaPath
  return javaPath.replace(/(^|[\\/])javaw\.exe$/i, "$1java.exe")
}

function send(message: Record<string, unknown>): void {
  try {
    process.send?.(message)
  } catch {
    // ignore
  }
}

function debug(message: string): void {
  send({ type: "worker-debug", message })
}

async function launchMinecraft(payload: any): Promise<void> {
  debug(`Worker launch request: ${payload.options.loaderType} ${payload.options.mcVersion}${payload.options.loaderVersion ? ` (${payload.options.loaderVersion})` : ""}`)

  const defaultJvmArgs: string[] = []
  if (payload.options.retroauthEnabled) {
    try {
      const { ensureRetroAuthInjector } = await import("@xnlc/core")
      const retroauthPath = await ensureRetroAuthInjector(payload.gameDir)
      defaultJvmArgs.push(
        "--add-opens=java.base/sun.net.www.protocol.https=ALL-UNNAMED",
        "--add-opens=java.base/sun.net.www.protocol.http=ALL-UNNAMED",
        "--add-opens=java.base/java.lang=ALL-UNNAMED",
        "--add-opens=java.base/java.util=ALL-UNNAMED",
        `-javaagent:${retroauthPath}=https://skins.xneon.org`,
      )
      debug(`RetroAuth javaagent: ${retroauthPath}=https://skins.xneon.org`)
    } catch (error) {
      debug(`Failed to ensure RetroAuth: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const { Xnlc, createLaunchAuth } = await import("@xnlc/core")
  const javaPath = normalizeJavaPath(payload.options.javaPath)
  const xnlc = new Xnlc({
    gameDir: payload.gameDir,
    defaultJvmArgs,
    javaPath,
  })
  xnlc.javaRunner.setPipeOutputToConsole(true)

  const auth = createLaunchAuth(payload.account)
  debug(`Auth prepared for ${payload.account.type}:${payload.account.username}`)
  if (payload.options.javaPath && javaPath !== payload.options.javaPath) {
    debug(`Normalized Java runtime from ${payload.options.javaPath} to ${javaPath}`)
  }
  launchStarted = true

  debug("Calling XNLC launch pipeline")
  const launchResult = await xnlc.launch(
    {
      mcVersion: payload.options.mcVersion,
      loaderType: payload.options.loaderType,
      loaderVersion: payload.options.loaderVersion,
    },
    auth as any,
    {
      javaPath,
      memoryMin: payload.options.memoryMin,
      memoryMax: payload.options.memoryMax,
      width: payload.options.width,
      height: payload.options.height,
    },
    (progress: any) => {
      send({
        type: "progress",
        progress: {
          type: progress.type,
          installationPhase: progress.installationPhase,
          fileName: progress.fileName ?? progress.file ?? "",
          downloaded: progress.downloaded ?? progress.downloadedBytes ?? 0,
          total: progress.total ?? 0,
          percent: progress.percent,
          downloadedBytes: progress.downloadedBytes,
          currentFile: progress.currentFile,
          totalFiles: progress.totalFiles,
        },
      })
    },
  )

  debug("XNLC launch pipeline resolved")
  minecraftProcess = launchResult?.process ?? xnlc.javaRunner.getCurrentProcess?.() ?? null
  if (!minecraftProcess) {
    send({ type: "error", error: "Minecraft process was not created" })
    return
  }

  if (launchResult?.command) {
    debug(`Launch command prepared: ${launchResult.command}`)
  }
  send({ type: "started", pid: minecraftProcess.pid })
  debug(`Minecraft process started with pid ${minecraftProcess.pid ?? "unknown"}`)

  minecraftProcess.stdout?.on("data", (chunk: Buffer | string) => {
    send({ type: "stdout", data: chunk.toString() })
  })

  minecraftProcess.stderr?.on("data", (chunk: Buffer | string) => {
    send({ type: "stderr", data: chunk.toString() })
  })

  minecraftProcess.once("close", (code) => {
    debug(`Minecraft process closed with code ${typeof code === "number" ? code : 0}`)
    send({ type: "close", code: typeof code === "number" ? code : 0 })
    process.exit(0)
  })

  minecraftProcess.once("error", (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    debug(`Minecraft process error: ${errorMessage}`)
    send({ type: "error", error: errorMessage })
  })
}

process.on("message", async (message: any) => {
  const payload = message ?? {}

  if (payload.type === "stop") {
    if (minecraftProcess && !minecraftProcess.killed) {
      try {
        minecraftProcess.kill("SIGTERM")
      } catch {
        // ignore
      }
      return
    }

    process.exit(0)
  }

  if (payload.type !== "launch") {
    return
  }

  try {
    await launchMinecraft(payload.payload)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    debug(`Worker launch failed: ${errorMessage}`)
    send({ type: "error", error: errorMessage })
    process.exit(1)
  }
})

process.on("disconnect", () => {
  if (!launchStarted || !minecraftProcess) {
    process.exit(0)
  }
})
