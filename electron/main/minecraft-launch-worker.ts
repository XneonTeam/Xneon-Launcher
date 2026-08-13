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

type LaunchVarContext = {
  instName: string
  instId?: string
  gameDir: string
  javaPath: string
  mcVersion: string
  loaderType: string
  loaderVersion?: string
  javaArgs?: string
  accountName: string
  accountUuid?: string
  accountAccessToken?: string
}

/**
 * Substitutes environment-style placeholders ($VAR / ${VAR}) in
 * pre/post-launch commands, wrapper command and env values.
 * Matches the substitution semantics of the reference launcher:
 * a placeholder is replaced only when the variable has a non-empty value.
 */
function substituteLaunchVars(command: string, ctx: LaunchVarContext): string {
  const vars: Record<string, string> = {
    INST_NAME: ctx.instName,
    INST_ID: ctx.instId ?? ctx.instName,
    INST_DIR: ctx.gameDir,
    INST_MC_DIR: ctx.gameDir,
    INST_JAVA: ctx.javaPath,
    INST_JAVA_ARGS: ctx.javaArgs ?? "",
    NO_COLOR: "1",
    MINECRAFT_VERSION: ctx.mcVersion,
    MC_VERSION: ctx.mcVersion,
    LOADER_TYPE: ctx.loaderType,
    LOADER_VERSION: ctx.loaderVersion ?? "",
    AUTH_PLAYER_NAME: ctx.accountName,
    AUTH_UUID: ctx.accountUuid ?? "",
    AUTH_ACCESS_TOKEN: ctx.accountAccessToken ?? "",
  }
  return command.replace(/\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (match, braceKey, bareKey) => {
    const key = braceKey ?? bareKey
    const value = vars[key]
    return value ? value : match
  })
}

/**
 * Splits a command string into program + arguments, mirroring the
 * Commandline::splitArgs behavior of the reference launcher: whitespace
 * separates tokens, single/double quotes group tokens, backslash escapes
 * the next character inside quotes.
 */
function splitCommandLine(input: string): string[] {
  const argv: string[] = []
  let current = ""
  let escape = false
  let inQuotes: string | null = null
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (escape) {
      current += c
      escape = false
    } else if (inQuotes) {
      if (c === "\\") {
        escape = true
      } else if (c === inQuotes) {
        inQuotes = null
      } else {
        current += c
      }
    } else {
      if (c === " ") {
        if (current.length > 0) {
          argv.push(current)
          current = ""
        }
      } else if (c === '"' || c === "'") {
        inQuotes = c
      } else {
        current += c
      }
    }
  }
  if (current.length > 0) argv.push(current)
  return argv
}

function isBatchFile(program: string): boolean {
  return process.platform === "win32" && /\.(bat|cmd)$/i.test(program)
}

/**
 * Runs a command (pre/post-launch / wrapper) with placeholders substituted.
 * Like the reference launcher, the command is executed directly without a
 * shell; .bat/.cmd files on Windows are routed through cmd.exe.
 * Returns exit code and captured stderr.
 */
function runLaunchCommand(
  rawCommand: string,
  ctx: LaunchVarContext,
  env: Record<string, string>,
  cwd: string,
): { code: number; error?: string } {
  const command = substituteLaunchVars(rawCommand.trim(), ctx)
  if (!command) return { code: 0 }

  const argv = splitCommandLine(command)
  const program = argv.shift()
  if (!program) return { code: 0 }

  debug(`[Command] ${command}`)

  let spawnTarget = { cmd: program, args: argv }
  if (isBatchFile(program)) {
    const comspec = process.env.ComSpec ?? "cmd.exe"
    const inner = `"${program}"${argv.map((a) => ` "${a.replace(/"/g, '""')}"`).join("")}`
    spawnTarget = { cmd: comspec, args: ["/d", "/s", "/c", `"${inner}"`] }
  }

  try {
    const result = spawnSync(spawnTarget.cmd, spawnTarget.args, {
      cwd,
      env,
      encoding: "utf-8",
      shell: false,
      timeout: 10 * 60 * 1000,
      stdio: ["inherit", "pipe", "pipe"],
    })
    if (result.status !== 0) {
      const stderr = (result.stderr ?? "").trim()
      if (stderr) debug(`[Command] stderr: ${stderr}`)
      debug(`[Command] exited with code ${result.status}`)
      return { code: result.status ?? 1, error: stderr || `Command exited with code ${result.status}` }
    }
    return { code: 0 }
  } catch (error) {
    return { code: 1, error: error instanceof Error ? error.message : String(error) }
  }
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

  const { Xnlc, createLaunchAuth, OutputRelay, applyBmclapiEnv, cleanEnvForGame } = await import("@xnlc/core")

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

  // Offline username override: allow launching with a custom nickname regardless
  // of the stored offline account name.
  const launchAccount = (payload.options.offlineUsername && payload.account.type === "offline")
    ? { ...payload.account, username: payload.options.offlineUsername }
    : payload.account

  const auth = createLaunchAuth(launchAccount)
  debug(`Auth prepared for ${launchAccount.type}:${launchAccount.username}`)
  if (payload.options.javaPath && javaPath !== payload.options.javaPath) {
    debug(`Normalized Java runtime from ${payload.options.javaPath} to ${javaPath}`)
  }
  launchStarted = true

  const extraJvmArgs = parseExtraJvmArgs((payload.options as { javaArgs?: string }).javaArgs)
  debug(`Extra JVM args (${extraJvmArgs.length}): ${extraJvmArgs.join(" ")}`)

  const launchVarContext: LaunchVarContext = {
    instName: payload.options.buildName ?? payload.options.mcVersion,
    instId: payload.options.buildId,
    gameDir: payload.gameDir,
    javaPath: javaPath || "java",
    mcVersion: payload.options.mcVersion,
    loaderType: payload.options.loaderType,
    loaderVersion: payload.options.loaderVersion,
    javaArgs: extraJvmArgs.join(" "),
    accountName: launchAccount.username,
    accountUuid: launchAccount.uuid,
    accountAccessToken: launchAccount.accessToken,
  }

  // Game process environment: system env (with JAVA_*/LAUNCHER_* stripped, as the
  // reference launcher does in CleanEnviroment()) + custom env + INST_* variables.
  const instEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries({
    INST_NAME: launchVarContext.instName,
    INST_ID: launchVarContext.instId ?? launchVarContext.instName,
    INST_DIR: launchVarContext.gameDir,
    INST_MC_DIR: launchVarContext.gameDir,
    INST_JAVA: launchVarContext.javaPath,
    INST_JAVA_ARGS: launchVarContext.javaArgs ?? "",
    NO_COLOR: "1",
  })) {
    if (value) instEnv[key] = value
  }
  const gameEnv = {
    ...cleanEnvForGame(process.env as Record<string, string>),
    ...payload.options.customEnv,
    ...instEnv,
  }

  // Pre-launch command: runs before the game process starts. Aborts launch on non-zero exit.
  const preLaunchCommand = (payload.options.preLaunchCommand ?? "").trim()
  if (preLaunchCommand) {
    debug(`[PreLaunch] Running pre-launch command`)
    const preResult = runLaunchCommand(preLaunchCommand, launchVarContext, gameEnv, payload.gameDir)
    if (preResult.code !== 0) {
      const errorMessage = `Pre-launch command failed (code ${preResult.code})${preResult.error ? `: ${preResult.error}` : ""}`
      debug(`[PreLaunch] ${errorMessage}`)
      send({ type: "error", error: errorMessage })
      process.exit(1)
      return
    }
    debug(`[PreLaunch] Pre-launch command completed successfully`)
  }

  // Quick Play: game args (NOT jvm args — Java VM doesn't recognize them)
  const extraGameArgs: string[] = []
  const quickPlayLogDir = path.join(payload.gameDir, "logs", "quick_play")
  extraGameArgs.push("--quickPlayPath", quickPlayLogDir)
  debug(`Quick Play: path=${quickPlayLogDir}`)

  const qpOptions = payload.options as { quickPlaySingleplayer?: string; quickPlayMultiplayer?: string }
  if (qpOptions.quickPlaySingleplayer) {
    extraGameArgs.push("--quickPlaySingleplayer", qpOptions.quickPlaySingleplayer)
    debug(`Quick Play: singleplayer world=${qpOptions.quickPlaySingleplayer}`)
  } else if (qpOptions.quickPlayMultiplayer) {
    extraGameArgs.push("--quickPlayMultiplayer", qpOptions.quickPlayMultiplayer)
    debug(`Quick Play: multiplayer server=${qpOptions.quickPlayMultiplayer}`)
  }

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
      gameArgs: extraGameArgs,
      env: gameEnv,
      wrapperCommand: substituteLaunchVars((payload.options.wrapperCommand ?? "").trim(), launchVarContext) || undefined,
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
    void (async () => {
      // Post-launch command: runs after the game exits (placeholders supported).
      const postLaunchCommand = (payload.options.postLaunchCommand ?? "").trim()
      if (postLaunchCommand) {
        debug(`[PostLaunch] Running post-launch command`)
        const postResult = runLaunchCommand(postLaunchCommand, launchVarContext, gameEnv, payload.gameDir)
        if (postResult.code !== 0) {
          debug(`[PostLaunch] Post-launch command exited with code ${postResult.code}${postResult.error ? `: ${postResult.error}` : ""}`)
        }
      }
      send({ type: "close", code: typeof code === "number" ? code : 0 })
      // Give IPC time to deliver before exiting
      setTimeout(() => process.exit(0), 100)
    })()
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
