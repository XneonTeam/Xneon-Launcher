import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import type { ChildProcess } from "child_process"
import type { LoaderType } from "@xnlc/core" with { "resolution-mode": "import" }
import type { WorkerLaunchPayload } from "@xnlc/types" with { "resolution-mode": "import" }

let minecraftProcess: ChildProcess | null = null
let launchStarted = false

function normalizeJavaPath(javaPath?: string): string | undefined {
  if (!javaPath) return javaPath
  return javaPath.replace(/(^|[\\/])javaw\.exe$/i, "$1java.exe")
}

/**
 * Splits a raw JVM args string (e.g. "-Xmx4G -XX:+UseG1GC \"-Dfoo=bar baz\"")
 * into individual tokens, respecting double quotes.
 */
function parseExtraJvmArgs(rawArgs?: string): string[] {
  if (!rawArgs) return []
  const tokens: string[] = []
  const regex = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(rawArgs)) !== null) {
    if (match[1] !== undefined) {
      if (match[1].trim()) tokens.push(match[1].trim())
    } else if (match[2] !== undefined) {
      tokens.push(match[2])
    }
  }
  return tokens
}

function getJavaBinaryCandidates(rootDir: string): string[] {
  const isWindows = process.platform === "win32"
  return [
    path.join(rootDir, "bin", isWindows ? "java.exe" : "java"),
    path.join(rootDir, "bin", "java"),
    path.join(rootDir, "bin", "java.exe"),
  ]
}

function resolveJavaBinaryPath(rootDir: string): string | null {
  for (const candidate of getJavaBinaryCandidates(rootDir)) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function prependToPathEnv(dirPath: string): boolean {
  const normalized = path.normalize(dirPath)
  const currentPath = process.env.PATH ?? process.env.Path ?? ""
  const entries = currentPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const compare = (value: string) => process.platform === "win32"
    ? path.normalize(value).toLowerCase()
    : path.normalize(value)

  if (entries.some((entry) => compare(entry) === compare(normalized))) {
    return false
  }

  const nextPath = [normalized, ...entries].join(path.delimiter)
  process.env.PATH = nextPath
  process.env.Path = nextPath
  return true
}

function attachJavaToProcessEnv(javaPath?: string): boolean {
  const normalizedJavaPath = normalizeJavaPath(javaPath)
  if (!normalizedJavaPath || normalizedJavaPath === "java" || !fs.existsSync(normalizedJavaPath)) {
    return false
  }

  const javaBinDir = path.dirname(normalizedJavaPath)
  const javaHome = path.dirname(javaBinDir)
  const addedToPath = prependToPathEnv(javaBinDir)
  process.env.JAVA_HOME = javaHome
  return addedToPath
}

function seedKnownJavaRuntimes(gameDir: string, requestedJavaPath?: string): string[] {
  const addedSources: string[] = []

  if (attachJavaToProcessEnv(requestedJavaPath)) {
    addedSources.push("requested-java")
  }

  const runtimesDir = path.join(gameDir, "runtime")
  if (!fs.existsSync(runtimesDir)) {
    return addedSources
  }

  for (const entry of fs.readdirSync(runtimesDir)) {
    const javaBinary = resolveJavaBinaryPath(path.join(runtimesDir, entry))
    if (!javaBinary) continue
    if (attachJavaToProcessEnv(javaBinary)) {
      addedSources.push(`runtime:${entry}`)
    }
  }

  return addedSources
}

function killMinecraftProcess(): void {
  if (!minecraftProcess || minecraftProcess.killed) return

  if (process.platform === "win32" && minecraftProcess.pid) {
    try {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(minecraftProcess.pid)])
      return
    } catch {
      // fall through to .kill()
    }
  }

  try {
    minecraftProcess.kill("SIGTERM")
  } catch {
    // ignore
  }
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

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  return String(error)
}

function resolveRetroAuthServer(accountType?: string): string {
  if (accountType === "elyby") {
    return "ely.by"
  }

  return "https://skins.xneon.org"
}

async function resolveRequiredJavaVersionForPayload(xnlc: unknown, payload: WorkerLaunchPayload): Promise<number | null> {
  if (payload.options.loaderType === "custom") {
    return null
  }

  try {
    const w = xnlc as any
    const baseVersionJson = await w.versionResolver.resolveVersion(payload.options.mcVersion, w.osInfo)
    return w.getRequiredJavaVersion(baseVersionJson, {
      mcVersion: payload.options.mcVersion,
      loaderType: payload.options.loaderType,
      loaderVersion: payload.options.loaderVersion,
    })
  } catch (error) {
    debug(`Failed to resolve required Java version early: ${formatUnknownError(error)}`)
    return null
  }
}

async function prepareJavaEnvironmentForInstallers(xnlc: unknown, payload: WorkerLaunchPayload, javaPath?: string): Promise<void> {
  const seeded = seedKnownJavaRuntimes(payload.gameDir, javaPath)
  if (seeded.length > 0) {
    debug(`Seeded Java PATH entries from ${seeded.join(", ")}`)
  }

  if (payload.options.loaderType === "custom") {
    return
  }

  try {
    const w = xnlc as any
    const baseVersionJson = await w.versionResolver.resolveVersion(payload.options.mcVersion, w.osInfo)
    const requiredJavaVersion = w.getRequiredJavaVersion(baseVersionJson, {
      mcVersion: payload.options.mcVersion,
      loaderType: payload.options.loaderType,
      loaderVersion: payload.options.loaderVersion,
    })
    debug(`Preparing installer Java runtime version=${requiredJavaVersion}`)

    const javaRuntime = await w.javaManager.findOrDownloadJava(
      requiredJavaVersion,
      javaPath,
      (percent: number) => send({
        type: "java-progress",
        progress: {
          type: "download",
          percent,
          message: `Preparing Java ${requiredJavaVersion}...`,
        },
      }),
    )

    if (attachJavaToProcessEnv(javaRuntime.path)) {
      debug(`Added resolved Java runtime to PATH: ${javaRuntime.path}`)
    } else {
      debug(`Resolved Java runtime ready: ${javaRuntime.path}`)
    }
  } catch (error) {
    debug(`Failed to pre-resolve Java runtime: ${formatUnknownError(error)}`)
  }
}

process.on("uncaughtException", (error) => {
  debug(`uncaughtException: ${formatUnknownError(error)}`)
})

process.on("unhandledRejection", (reason) => {
  debug(`unhandledRejection: ${formatUnknownError(reason)}`)
})

process.on("warning", (warning) => {
  debug(`process warning: ${formatUnknownError(warning)}`)
})

type XnlcLaunchProgress = {
  type?: string
  installationPhase?: string
  fileName?: string
  file?: string
  downloaded?: number
  downloadedBytes?: number
  total?: number
  percent?: number
  currentFile?: string | number
  totalFiles?: number
}

async function launchMinecraft(payload: WorkerLaunchPayload): Promise<void> {
  debug(`Worker launch request: ${payload.options.loaderType} ${payload.options.mcVersion}${payload.options.loaderVersion ? ` (${payload.options.loaderVersion})` : ""}`)
  debug(`Worker environment: platform=${process.platform} arch=${process.arch} pid=${process.pid} cwd=${process.cwd()} node=${process.versions.node}`)
  debug(`Worker gameDir: ${payload.gameDir}`)
  debug(`Worker options: ${JSON.stringify({
    memoryMin: payload.options.memoryMin,
    memoryMax: payload.options.memoryMax,
    width: payload.options.width,
    height: payload.options.height,
    javaPath: payload.options.javaPath ?? "",
    retroauthEnabled: payload.options.retroauthEnabled ?? false,
    useBmclapi: payload.options.useBmclapi ?? false,
  })}`)

  const { Xnlc, createLaunchAuth, OutputRelay, applyBmclapiEnv } = await import("@xnlc/core")

  if (payload.options.useBmclapi) {
    debug("BMCLAPI enabled: overriding download URLs")
    applyBmclapiEnv()
  }
  const javaPath = normalizeJavaPath(payload.options.javaPath)
  const defaultJvmArgs: string[] = []
  const xnlc = new Xnlc({
    gameDir: payload.gameDir,
    defaultJvmArgs,
    javaPath,
  })
  xnlc.javaRunner.setPipeOutputToConsole(true)
  debug("XNLC instance created and java runner configured to pipe output")
  const requiredJavaVersion = await resolveRequiredJavaVersionForPayload(xnlc, payload)
  if (requiredJavaVersion !== null) {
    debug(`Early required Java version resolved: ${requiredJavaVersion}`)
  }

  if (payload.options.retroauthEnabled) {
    try {
      const { ensureRetroAuthInjector } = await import("@xnlc/core")
      const retroauthPath = await ensureRetroAuthInjector(payload.gameDir)
      const retroauthServer = resolveRetroAuthServer(payload.account?.type)
      if ((requiredJavaVersion ?? 8) >= 9) {
        defaultJvmArgs.push(
          "--add-opens=java.base/sun.net.www.protocol.https=ALL-UNNAMED",
          "--add-opens=java.base/sun.net.www.protocol.http=ALL-UNNAMED",
          "--add-opens=java.base/java.lang=ALL-UNNAMED",
          "--add-opens=java.base/java.util=ALL-UNNAMED",
        )
      }
      defaultJvmArgs.push(`-javaagent:${retroauthPath}=${retroauthServer}`)
      debug(`RetroAuth javaagent: ${retroauthPath}=${retroauthServer}`)
      if ((requiredJavaVersion ?? 8) < 9) {
        debug("Skipping RetroAuth --add-opens flags for legacy Java runtime")
      }
    } catch (error) {
      debug(`Failed to ensure RetroAuth: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  await prepareJavaEnvironmentForInstallers(xnlc, payload, javaPath)

  const auth = createLaunchAuth(payload.account)
  debug(`Auth prepared for ${payload.account.type}:${payload.account.username}`)
  if (payload.options.javaPath && javaPath !== payload.options.javaPath) {
    debug(`Normalized Java runtime from ${payload.options.javaPath} to ${javaPath}`)
  }
  launchStarted = true

  const extraJvmArgs = parseExtraJvmArgs((payload.options as { javaArgs?: string }).javaArgs)
  debug(`Extra JVM args (${extraJvmArgs.length}): ${extraJvmArgs.join(" ")}`)

  debug("Calling XNLC launch pipeline")
  const launchResult = await xnlc.launch(
    {
      mcVersion: payload.options.mcVersion,
      loaderType: payload.options.loaderType as LoaderType,
      loaderVersion: payload.options.loaderVersion,
    },
    auth,
    {
      javaPath,
      jvmArgs: extraJvmArgs,
      memoryMin: payload.options.memoryMin,
      memoryMax: payload.options.memoryMax,
      width: payload.options.width,
      height: payload.options.height,
    },
    (progress: XnlcLaunchProgress) => {
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
  minecraftProcess = launchResult?.process ?? null
  if (!minecraftProcess) {
    send({ type: "error", error: "Minecraft process was not created" })
    return
  }

  send({ type: "started", pid: minecraftProcess.pid })
  debug(`Minecraft process started with pid ${minecraftProcess.pid ?? "unknown"}`)

  const stdoutRelay = new OutputRelay("stdout", send)
  const stderrRelay = new OutputRelay("stderr", send)

  minecraftProcess.stdout?.on("data", (chunk: Buffer | string) => {
    stdoutRelay.push(chunk)
  })

  minecraftProcess.stderr?.on("data", (chunk: Buffer | string) => {
    stderrRelay.push(chunk)
  })

  minecraftProcess.once("close", (code) => {
    stdoutRelay.flush()
    stderrRelay.flush()
    debug(`Minecraft process closed with code ${typeof code === "number" ? code : 0}`)
    send({ type: "close", code: typeof code === "number" ? code : 0 })
    // Give IPC time to deliver before exiting
    setTimeout(() => process.exit(0), 100)
  })

  minecraftProcess.once("error", (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    debug(`Minecraft process error: ${errorMessage}`)
    send({ type: "error", error: errorMessage })
  })
}

process.on("message", async (msg: unknown) => {
  const message = msg as { type: string; payload?: WorkerLaunchPayload } | null
  if (!message) return

  if (message.type === "stop") {
    killMinecraftProcess()

    if (minecraftProcess && !minecraftProcess.killed) {
      // Don't exit immediately — wait for the close event to fire naturally,
      // which sends { type: "close" } to the main process so the UI updates.
      setTimeout(() => process.exit(0), 5000)
      return
    }

    // No Minecraft process to wait for — main process needs a close event.
    // Send it ourselves so the UI resets properly.
    send({ type: "close", code: -1 })
    setTimeout(() => process.exit(0), 100)
  }

  if (message.type !== "launch") {
    return
  }

  if (!message.payload) return

  try {
    await launchMinecraft(message.payload)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    debug(`Worker launch failed: ${errorMessage}`)
    send({ type: "error", error: errorMessage })
    process.exit(1)
  }
})

process.on("disconnect", () => {
  debug(`Worker disconnect received launchStarted=${String(launchStarted)} hasMinecraftProcess=${String(!!minecraftProcess)}`)
  if (!launchStarted || !minecraftProcess) {
    process.exit(0)
  }
})
