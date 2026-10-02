import { ChildProcess, spawn, exec } from "child_process"
import { promisify } from "util"
import path from "path"
import fs from "fs"
import os from "os"
import type { McServerInfo, McServerState, McServerMetrics } from "@xnlc/types" with { "resolution-mode": "import" }
import iconv from "iconv-lite"
import { EULA_PROMPT_PATTERN, isStartupDoneLine, isStoppingLine } from "./startup-detection.js"

const execAsync = promisify(exec)

/** Фаза процесса сервера. `running` ставится только по маркеру готовности. */
type ServerPhase = "starting" | "running" | "stopping"

type RunningServer = {
  process: ChildProcess
  startTime: number
  stdinWriter: NodeJS.WritableStream
  logBuffer: string[]
  resolvedJarPath?: string
  phase: ServerPhase
  /** Момент, когда сервер подтвердил готовность (для логов/диагностики). */
  readyAt?: number
  /** Пишет строку в буфер и в консоль лаунчера. */
  pushLine: (line: string) => void
  /** Процесс убит лаунчером, а не завершился сам. */
  killedByLauncher?: boolean
  /** Промис текущей остановки: повторные stop() ждут его. */
  stopPromise?: Promise<void>
}

const MAX_LOG_BUFFER = 2000
const GRACEFUL_TIMEOUT_MS = 30_000
// Сколько ждём фактической смерти процесса после SIGKILL. Перезапуск не должен
// висеть вечно, но и стартовать второй процесс поверх живого нельзя.
const KILL_TIMEOUT_MS = 5_000
/**
 * Страховка от «вечного starting»: если маркер готовности так и не появился
 * (нестандартная сборка, кастомный jar), через это время считаем сервер
 * запущенным и пишем предупреждение в консоль. Без такой страховки сервер
 * оставался бы в starting навсегда — нам важнее не подвешивать UI.
 */
const STARTUP_FALLBACK_MS = 180_000

export class ServerManager {
  private running = new Map<string, RunningServer>()
  /**
   * Консоль до старта процесса: установка ядра и компиляция BuildTools.
   * Логи запущенного сервера лежат в `RunningServer.logBuffer`, но до старта его
   * ещё нет — без отдельного буфера консоль пустовала всё время установки.
   */
  private installLogs = new Map<string, string[]>()

  /**
   * Текущее состояние сервера. `running` отдаётся только после того, как сервер
   * подтвердил готовность строкой вида `Done (5.123s)! For help, type "help"`
   * (startup-маркер, как это делают панели игровых серверов) — до этого он
   * `starting`, даже если процесс уже запущен.
   */
  getState(id: string): McServerState {
    const r = this.running.get(id)
    if (!r) return { status: "stopped" }
    if (!r.process.pid || r.process.killed) return { status: "stopped" }
    if (r.phase === "starting") return { status: "starting", startTime: r.startTime }
    if (r.phase === "stopping") return { status: "stopping" }
    return { status: "running", startTime: r.startTime, pid: r.process.pid }
  }

  private metricsCache = new Map<string, McServerMetrics>()
  private metricsPending = new Map<string, Promise<McServerMetrics>>()
  /** Предыдущий замер CPU-времени процесса — база для расчёта загрузки по дельте. */
  private cpuSamples = new Map<string, { ticks: number; at: number }>()
  private samplerTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Возвращает метрики немедленно, без обращения к ОС.
   *
   * Сбор метрик на Windows — это spawn powershell (~150-250 мс), поэтому он не
   * должен выполняться в пути запроса из renderer. Значения приходят из фонового
   * сэмплера (см. startMetricsSampler), который обновляет кэш параллельно.
   */
  getMetricsSync(id: string): McServerMetrics {
    const r = this.running.get(id)
    if (!r?.process.pid) return { cpuPercent: 0, memoryMb: 0, uptimeSeconds: 0 }
    const cached = this.metricsCache.get(id)
    return {
      cpuPercent: cached?.cpuPercent ?? 0,
      memoryMb: cached?.memoryMb ?? 0,
      uptimeSeconds: Math.floor((Date.now() - r.startTime) / 1000),
    }
  }

  /**
   * Фоновый цикл сбора метрик для всех запущенных серверов.
   *
   * Один таймер на менеджер: каждый тик последовательно обновляет кэш для каждого
   * живого сервера. Останавливается, когда запущенных серверов нет, — вхолостую
   * спавнить powershell не нужно.
   */
  startMetricsSampler(intervalMs = 1000): void {
    if (this.samplerTimer !== null) return
    const tick = async () => {
      if (this.running.size === 0) {
        this.stopMetricsSampler()
        return
      }
      for (const [id, r] of this.running) {
        if (!r.process.pid) continue
        // Последовательно, чтобы не поднимать несколько powershell одновременно.
        try { await this.getMetrics(id) } catch { /* процесс мог завершиться */ }
      }
    }
    this.samplerTimer = setInterval(() => { void tick() }, intervalMs)
    this.samplerTimer.unref?.()
  }

  stopMetricsSampler(): void {
    if (this.samplerTimer !== null) {
      clearInterval(this.samplerTimer)
      this.samplerTimer = null
    }
  }

  async getMetrics(id: string): Promise<McServerMetrics> {
    const r = this.running.get(id)
    if (!r?.process.pid) {
      this.metricsCache.delete(id)
      this.metricsPending.delete(id)
      this.cpuSamples.delete(id)
      return { cpuPercent: 0, memoryMb: 0, uptimeSeconds: 0 }
    }

    const pending = this.metricsPending.get(id)
    if (pending) return pending

    const job = this.collectMetrics(id, r)
    this.metricsPending.set(id, job)
    try {
      const result = await job
      this.metricsCache.set(id, result)
      return result
    } finally {
      this.metricsPending.delete(id)
    }
  }

  private async collectMetrics(id: string, r: RunningServer): Promise<McServerMetrics> {
    const pid = r.process.pid
    if (!pid) return this.metricsCache.get(id) ?? { cpuPercent: 0, memoryMb: 0, uptimeSeconds: 0 }

    let cpuPercent = this.metricsCache.get(id)?.cpuPercent ?? 0
    let memoryMb = this.metricsCache.get(id)?.memoryMb ?? 0
    let cpuTicks: number | null = null

    try {
      if (process.platform === "win32") {
        // Get-Process заметно дешевле Get-CimInstance (нет запроса к WMI):
        // ~250 мс против ~480 мс на замер. CPU здесь — суммарное время процесса
        // в секундах, WorkingSet64 — рабочий набор в байтах.
        const { stdout } = await execAsync(
          `powershell -NoProfile -NonInteractive -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object WorkingSet64,CPU | ConvertTo-Json"`,
          { timeout: 2500, windowsHide: true, encoding: "utf-8" },
        )
        const trimmed = stdout.trim()
        if (trimmed) {
          const json = JSON.parse(trimmed)
          memoryMb = Math.round(parseInt(json.WorkingSet64 || "0", 10) / 1024 / 1024)
          const cpuSeconds = parseFloat(json.CPU || "0")
          if (Number.isFinite(cpuSeconds)) cpuTicks = cpuSeconds * 1000
        }
      } else {
        try {
          const stat = await fs.promises.readFile(`/proc/${pid}/stat`, "utf-8")
          // comm может содержать пробелы в скобках — режем по последней ')'.
          const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
          const utime = parseInt(rest[11], 10)
          const stime = parseInt(rest[12], 10)
          if (Number.isFinite(utime) && Number.isFinite(stime)) {
            // Тики -> миллисекунды CPU-времени (USER_HZ обычно 100).
            cpuTicks = ((utime + stime) / 100) * 1000
          }
        } catch {}

        try {
          const status = await fs.promises.readFile(`/proc/${pid}/status`, "utf-8")
          const vmRSS = status.split("\n").find(l => l.startsWith("VmRSS:"))
          if (vmRSS) memoryMb = Math.round(parseInt(vmRSS.split(/\s+/)[1], 10) / 1024)
        } catch {}
      }
    } catch {}

    // CPU считаем по дельте между двумя замерами, а не от старта процесса:
    // деление накопленного CPU-времени на аптайм давало ложные 100% на старте
    // (аптайм крошечный, знаменатель почти ноль) и не отражало текущую нагрузку.
    if (cpuTicks !== null) {
      const now = Date.now()
      const prev = this.cpuSamples.get(id)
      this.cpuSamples.set(id, { ticks: cpuTicks, at: now })
      if (prev && now > prev.at) {
        const deltaCpuMs = cpuTicks - prev.ticks
        const deltaWallMs = now - prev.at
        const cores = Math.max(1, os.cpus().length)
        if (deltaCpuMs >= 0 && deltaWallMs > 0) {
          // Нормализуем на число ядер, чтобы 100% означало «занято всё ядро».
          const raw = (deltaCpuMs / deltaWallMs) * 100 / cores
          cpuPercent = Math.max(0, Math.min(100, Math.round(raw)))
        }
      } else {
        // Первый замер — данных для дельты ещё нет, honest-значение неизвестно.
        cpuPercent = 0
      }
    }

    return {
      cpuPercent,
      memoryMb,
      uptimeSeconds: Math.floor((Date.now() - r.startTime) / 1000),
    }
  }

  getLogBuffer(id: string): string[] {
    const install = this.installLogs.get(id) ?? []
    const live = this.running.get(id)?.logBuffer ?? []
    return install.length > 0 ? [...install, ...live] : live
  }

  /**
   * Дописать строку в консоль сервера вне его жизненного цикла. Нужно установке
   * ядра: Spigot и CraftBukkit компилируются BuildTools минутами, Forge и NeoForge
   * гоняют свой инсталлер — и без этого консоль всё это время пуста, хотя там
   * самый полезный вывод. У запущенного сервера строка идёт в его буфер.
   */
  appendConsoleLine(id: string, line: string): void {
    const target = this.running.get(id)?.logBuffer ?? this.installLogs.get(id) ?? []
    target.push(line)
    if (target.length > MAX_LOG_BUFFER) target.shift()
    if (!this.running.has(id)) this.installLogs.set(id, target)
  }

  /**
   * Забыть вывод установки ядра. Вызывается перед стартом процесса: в консоли
   * должна остаться только жизнь самого сервера, иначе при возврате на страницу
   * подтягивался бы ещё и лог BuildTools/инсталлера (`getLogBuffer` склеивает
   * историю установки с живым буфером).
   */
  clearInstallLogs(id: string): void {
    this.installLogs.delete(id)
  }

  async start(
    id: string,
    server: McServerInfo,
    javaPath: string,
    serverDir: string,
    onLog: (line: string) => void,
    onStateChange: (state: McServerState) => void,
    resolvedJarPath?: string,
  ): Promise<void> {
    if (this.running.has(id)) {
      throw new Error("Server is already running")
    }

    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true })
    }

    const jarPath = resolvedJarPath || this.resolveServerJar(serverDir, server.modloader)
    const xmx = server.xmx
    const xms = server.xms

    const isArgsFile = jarPath.toLowerCase().endsWith(".txt")

    let args: string[]
    if (isArgsFile) {
      // NeoForge/Forge 1.17+ install via win_args.txt / unix_args.txt.
      // The file contains the full launch command (classpath + main class + fml args),
      // so we read it and pass its tokens to java instead of using `-jar path nogui`.
      const fullPath = path.isAbsolute(jarPath) ? jarPath : path.join(serverDir, jarPath)
      const content = fs.readFileSync(fullPath, "utf-8")
      const parsed = tokenizeArgs(content)
      args = [
        `-Dfile.encoding=UTF-8`,
        `-Dsun.jnu.encoding=UTF-8`,
        `-Xmx${xmx}m`,
        `-Xms${xms}m`,
        ...parsed,
        "nogui",
      ]
    } else {
      args = [
        `-Dfile.encoding=UTF-8`,
        `-Dsun.jnu.encoding=UTF-8`,
        `-Xmx${xmx}m`,
        `-Xms${xms}m`,
        `-jar`, jarPath,
        "nogui",
      ]
    }

    if (server.extraJavaArgs) {
      const extra = this.parseExtraArgs(server.extraJavaArgs)
      if (isArgsFile) {
        args.push(...extra)
      } else {
        args.splice(args.length - 1, 0, ...extra)
      }
    }

    const child = spawn(javaPath, args, {
      cwd: serverDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: false,
    })

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error("Failed to open stdio pipes")
    }

    const logBuffer: string[] = []
    const pushLog = (line: string) => {
      logBuffer.push(line)
      if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift()
      onLog(line)
    }
    const running: RunningServer = {
      process: child,
      startTime: Date.now(),
      stdinWriter: child.stdin,
      logBuffer,
      resolvedJarPath,
      phase: "starting",
      pushLine: pushLog,
    }
    this.running.set(id, running)

    // Метрики собираются в фоне, а не по запросу из renderer: спавн powershell
    // занимает сотни миллисекунд, и держать его в пути запроса нельзя.
    this.startMetricsSampler()

    onStateChange({ status: "starting", startTime: running.startTime })

    let readyFallbackTimer: NodeJS.Timeout | undefined
    let readyLogged = false

    /**
     * Сервер реально поднялся. Вызывается по маркеру готовности из консоли
     * или, в крайнем случае, по таймауту.
     */
    const markStarted = (reason: string) => {
      if (running.phase !== "starting") return
      running.phase = "running"
      running.readyAt = Date.now()
      if (readyFallbackTimer) {
        clearTimeout(readyFallbackTimer)
        readyFallbackTimer = undefined
      }
      if (readyLogged) return
      readyLogged = true
      const seconds = ((running.readyAt - running.startTime) / 1000).toFixed(1)
      pushLog(`[XNL] Server is up in ${seconds}s — ${reason}`)
      if (child.pid) {
        onStateChange({ status: "running", startTime: running.startTime, pid: child.pid })
      }
    }

    readyFallbackTimer = setTimeout(() => {
      readyFallbackTimer = undefined
      pushLog(`[XNL] Startup marker not seen in ${Math.round(STARTUP_FALLBACK_MS / 1000)}s — marking the server as running`)
      markStarted("startup marker timeout")
    }, STARTUP_FALLBACK_MS)

    /** Консоль → лог + детект состояния (тот же принцип, что в egg-конфиге). */
    const handleLine = (line: string) => {
      pushLog(line)
      if (running.phase === "starting") {
        if (isStartupDoneLine(line)) {
          markStarted("startup marker matched")
        } else if (EULA_PROMPT_PATTERN.test(line)) {
          pushLog("[XNL] Сервер требует согласия с EULA — примите его в лаунчере и запустите заново")
        }
      } else if (running.phase === "running" && isStoppingLine(line)) {
        running.phase = "stopping"
        onStateChange({ status: "stopping" })
      }
    }

    child.stdout.on("data", (data: Buffer) => {
      const text = decodeOutput(data)
      for (const line of text.split("\n")) {
        if (line.trim()) handleLine(line.trimEnd())
      }
    })

    child.stderr.on("data", (data: Buffer) => {
      const text = decodeOutput(data)
      for (const line of text.split("\n")) {
        if (line.trim()) pushLog(`[STDERR] ${line.trimEnd()}`)
      }
    })

    child.on("error", (err) => {
      pushLog(`[XNL] Process error: ${err.message}`)
      this.cleanup(id)
      onStateChange({ status: "stopped" })
    })

    child.on("close", (code, signal) => {
      // Убитый процесс отдаёт code = null, поэтому показываем сигнал.
      const how = signal ? `signal ${signal}` : `code ${code}`
      // Краш на старте — только если это не наша остановка.
      if (running.phase === "starting" && !running.killedByLauncher && code !== 0) {
        pushLog(`[XNL] Server crashed during startup (${how}) — see the log above`)
      }
      if (readyFallbackTimer) clearTimeout(readyFallbackTimer)
      if (running.killedByLauncher) {
        pushLog(`[XNL] Server process stopped by the launcher${signal ? ` (${how})` : ""}`)
      } else {
        pushLog(`[XNL] Server exited with ${how}`)
      }
      this.cleanup(id)
      this.running.delete(id)
      onStateChange({ status: "stopped" })
    })
  }

  async stop(id: string): Promise<void> {
    const r = this.running.get(id)
    if (!r) return

    // Повторные stop() ждут текущую остановку, а не шлют команду снова.
    if (r.stopPromise) return r.stopPromise

    r.phase = "stopping"

    // Неготовому серверу stop слать нельзя: команда падает с NPE. Такой убиваем.
    const ready = r.readyAt !== undefined

    if (ready) {
      // Одна команда stop — graceful shutdown.
      try {
        r.stdinWriter.write("stop\n")
      } catch {}
    } else {
      r.pushLine('[XNL] Stop requested during startup — killing the process (no "stop" command sent)')
    }

    const stopPromise = new Promise<void>((resolve) => {
      let settled = false
      let graceTimer: NodeJS.Timeout | undefined
      let killTimer: NodeJS.Timeout | undefined

      // Запись убираем здесь, до resolve(): иначе следующий start() увидит её.
      const finish = () => {
        if (settled) return
        settled = true
        if (graceTimer) clearTimeout(graceTimer)
        if (killTimer) clearTimeout(killTimer)
        if (this.running.get(id) === r) this.running.delete(id)
        resolve()
      }

      if (!ready) {
        // Команду не слали, сохранять нечего — гасим сразу.
        r.killedByLauncher = true
        try { r.process.kill("SIGKILL") } catch {}
        killTimer = setTimeout(finish, KILL_TIMEOUT_MS)
      } else {
        graceTimer = setTimeout(() => {
          r.killedByLauncher = true
          try { r.process.kill("SIGKILL") } catch {}
          // Не дождались close — выходим по таймауту, чтобы не висеть.
          killTimer = setTimeout(finish, KILL_TIMEOUT_MS)
        }, GRACEFUL_TIMEOUT_MS)
      }

      r.process.once("close", finish)
    })

    r.stopPromise = stopPromise
    return stopPromise
  }

  async kill(id: string): Promise<void> {
    const r = this.running.get(id)
    if (!r) return
    r.phase = "stopping"
    r.killedByLauncher = true
    try { r.process.kill("SIGKILL") } catch {}
  }

  async sendCommand(id: string, command: string): Promise<void> {
    const r = this.running.get(id)
    if (!r) throw new Error("Server is not running")
    // Неготовому серверу команда не дойдёт: её выполнит первый тик консоли.
    if (r.phase !== "running") {
      r.pushLine(`[XNL] Command "${command}" was not sent: the server is still starting`)
      throw new Error("Server is still starting — the command was not sent")
    }
    const line = command.endsWith("\n") ? command : `${command}\n`
    r.stdinWriter.write(line)
  }

  /** Процесс сервера жив (в том числе пока он ещё грузится). */
  isRunning(id: string): boolean {
    const r = this.running.get(id)
    return !!r && !!r.process.pid && !r.process.killed
  }

  /** Сервер подтвердил готовность — можно считать его запущенным. */
  isStarted(id: string): boolean {
    return this.running.get(id)?.phase === "running"
  }

  private cleanup(id: string): void {
    this.running.delete(id)
    this.metricsCache.delete(id)
    this.metricsPending.delete(id)
    this.cpuSamples.delete(id)
    // Запущенных серверов не осталось — фоновый сбор больше не нужен.
    if (this.running.size === 0) this.stopMetricsSampler()
  }

  resolveServerJar(serverDir: string, modloader: string): string {
    if (!fs.existsSync(serverDir)) {
      return path.join(serverDir, "server.jar")
    }

    const files = fs.readdirSync(serverDir).filter(f => f.endsWith(".jar"))

    // Priority order depends on modloader
    const knownJars: string[] = []
    if (modloader === "fabric") {
      knownJars.push("fabric-server-launch.jar")
    } else if (modloader === "quilt") {
      knownJars.push("quilt-server-launch.jar")
    } else if (modloader === "forge") {
      // Forge 1.17+ uses args file, but check for shim/universal jars
      knownJars.push("forge-*-shim.jar", "forge-*-server.jar", "forge-*-universal.jar")
    } else if (modloader === "neoforge") {
      knownJars.push("neoforge-*-server.jar")
    }
    knownJars.push("server.jar")

    for (const name of knownJars) {
      if (name.includes("*")) {
        // Glob match: split on *, match prefix and suffix
        const [prefix, suffix] = name.split("*")
        const match = files.find(f => f.startsWith(prefix) && f.endsWith(suffix))
        if (match) return path.join(serverDir, match)
      } else {
        if (files.includes(name)) return path.join(serverDir, name)
      }
    }

    // Fallback: any jar file
    if (files.length > 0) {
      return path.join(serverDir, files[0])
    }

    return path.join(serverDir, "server.jar")
  }

  private parseExtraArgs(raw: string): string[] {
    const tokens: string[] = []
    const regex = /"([^"]*)"|(\S+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(raw)) !== null) {
      if (match[1] !== undefined) {
        if (match[1].trim()) tokens.push(match[1].trim())
      } else if (match[2] !== undefined) {
        tokens.push(match[2])
      }
    }
    return tokens
  }

  stopAll(): void {
    for (const [id] of this.running) {
      this.kill(id).catch(() => {})
    }
    this.running.clear()
  }
}

// Singleton
export const serverManager = new ServerManager()

// ── Output decoder ───────────────────────────────────
// Minecraft server outputs CP1251 on Russian Windows, but with
// -Dfile.encoding=UTF-8 most output is UTF-8. Try UTF-8 first,
// fall back to CP1251 if replacement chars detected.
function decodeOutput(data: Buffer): string {
  const utf8 = data.toString("utf-8")
  // If no replacement characters (U+FFFD), UTF-8 decoded fine
  if (!utf8.includes("\uFFFD")) return utf8

  // Try CP1251 decode
  try {
    return iconv.decode(data, "cp1251")
  } catch {
    return utf8
  }
}

// Splits a command-line string into tokens, respecting double quotes. Used to
// parse win_args.txt / unix_args.txt contents. Semicolons inside a quoted
// classpath are preserved as a single token.
function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuotes = false
  let started = false

  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes
      started = true
      continue
    }
    if ((ch === " " || ch === "\t" || ch === "\r" || ch === "\n") && !inQuotes) {
      if (started) {
        tokens.push(current)
        current = ""
        started = false
      }
      continue
    }
    current += ch
    started = true
  }

  if (started) tokens.push(current)
  return tokens
}
