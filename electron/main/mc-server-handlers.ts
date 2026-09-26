import { opFailure } from "./errors"
import { ipcMain, BrowserWindow, dialog, webContents } from "electron"
import { randomUUID, createHash } from "crypto"
import path from "path"
import fs from "fs"
import os from "os"
import { dbHelpers, type McServerRow } from "../db"
import { serverManager, ensureServerJar, analyzeServerJar } from "@xnlc/servers"
import type { DownloadProgress } from "@xnlc/servers"
import { xnConnectManager } from "./xn-connect-manager"
import {
  downloadBuffer,
  sanitizeFileName,
  sanitizeRelativeContentPath,
  loadAdmZip,
  copyOverrideEntries,
  getLoaderSelectionFromModrinthDeps,
  getLoaderSelectionFromCurseManifest,
  loadModsModule,
} from "./builds/helpers"
import type { ModrinthVersionDetail, ModrinthManifestFile, CurseForgeManifestFile } from "@xnlc/mods" with { "resolution-mode": "import" }
import type { McServerInfo, McServerState, McServerMetrics, McPlayerEntry, XnConnectState } from "@xnlc/types" with { "resolution-mode": "import" }
import { logRuntime, sendToRenderer } from "./runtime"
import { getGameDir, loadXnlcModule } from "./minecraft-core"
import { findJavaBinarySync } from "./system"
import { getMcServerDir } from "./paths"
import { recordServerSession } from "./stats"
import { upsertActiveServerSession, takeActiveServerSession } from "./session-tracker"

// ── Push-метрики серверов ──────────────────────────────────────────────
// Renderer раньше опрашивал getMetrics каждые 2 секунды из каждого компонента
// (детальная страница + вкладка метрик). Сбор метрик на Windows — это spawn
// PowerShell, поэтому в пути запроса его быть не должно. Здесь только рассылка:
// значения берутся из кэша фонового сэмплера @xnlc/servers (getMetricsSync),
// который наполняется параллельно, пока сервер запущен.
const METRICS_PUSH_INTERVAL_MS = 1000
const metricsSubscribers = new Map<string, Set<number>>() // serverId → webContents.id
let metricsTimer: ReturnType<typeof setInterval> | null = null

/** Старты, которые ещё готовятся: serverId → токен отмены. */
const pendingServerStarts = new Map<string, { cancelled: boolean }>()

/** Идущие остановки: serverId → промис, чтобы N stop подряд выполнились как одна. */
const pendingServerStops = new Map<string, Promise<void>>()

function pushServerMetrics(): void {
  let pruned = false
  for (const [id, subscribers] of metricsSubscribers) {
    if (subscribers.size === 0) {
      metricsSubscribers.delete(id)
      pruned = true
      continue
    }
    // Мгновенное чтение из кэша — без спавна процессов и без await.
    const metrics = serverManager.getMetricsSync(id)
    for (const webContentsId of [...subscribers]) {
      const wc = webContents.fromId(webContentsId)
      if (!wc || wc.isDestroyed()) {
        // Окно закрылось, не отписавшись: подписчика обязательно убираем, иначе
        // набор никогда не опустеет и таймер метрик будет тикать вечно.
        subscribers.delete(webContentsId)
        pruned = true
        continue
      }
      wc.send("mc-server:metrics", { id, metrics })
    }
    if (subscribers.size === 0) {
      metricsSubscribers.delete(id)
      pruned = true
    }
  }
  if (pruned) stopMetricsTimerIfIdle()
}

function ensureMetricsTimer(): void {
  if (metricsTimer !== null) return
  metricsTimer = setInterval(() => pushServerMetrics(), METRICS_PUSH_INTERVAL_MS)
  // Таймер не должен удерживать процесс при выходе.
  metricsTimer.unref?.()
}

function stopMetricsTimerIfIdle(): void {
  const hasSubscribers = [...metricsSubscribers.values()].some(s => s.size > 0)
  if (!hasSubscribers && metricsTimer !== null) {
    clearInterval(metricsTimer)
    metricsTimer = null
  }
}

// Tracks running MC servers for stats: registers the running state with the
// session tracker so an uptime session is recorded when the process stops.
function attachServerUptimeTracking(id: string, serverInfo: McServerInfo, onStateChange: (state: McServerState) => void): (state: McServerState) => void {
  return (state) => {
    onStateChange(state)
    if (state.status === "starting" || state.status === "running") {
      // `starting` тоже несёт startTime — фиксируем сессию сразу, чтобы не потерять
      // аптайм, если процесс упадёт до перехода в `running` (он эмитится с задержкой 500мс).
      upsertActiveServerSession({ kind: "server", serverId: id, serverName: serverInfo.name, icon: serverInfo.icon, startedAt: state.startTime })
    } else if (state.status === "stopped") {
      const active = takeActiveServerSession(id)
      if (active) {
        const endTime = Date.now()
        const duration = Math.floor((endTime - active.startedAt) / 1000)
        if (duration > 0) {
          void recordServerSession({
            serverId: active.serverId,
            serverName: active.serverName,
            icon: active.icon,
            startedAt: active.startedAt,
            endedAt: endTime,
            duration,
          })
        }
      }
    }
  }
}

function rowToInfo(row: McServerRow): McServerInfo {
  return {
    id: row.id,
    name: row.name,
    gameVersion: row.gameVersion,
    modloader: row.modloader,
    modloaderVersion: row.modloaderVersion ?? undefined,
    port: row.port,
    xmx: row.xmx,
    xms: row.xms,
    extraJavaArgs: row.extraJavaArgs,
    javaPath: row.javaPath ?? undefined,
    autoRestart: row.autoRestart === 1,
    icon: row.icon ?? undefined,
    relayEnabled: row.relayEnabled === 1,
    onlineMode: row.onlineMode !== 0,
    maxPlayers: row.maxPlayers ?? 20,
    createdAt: row.createdAt,
    trashedAt: row.trashedAt ?? undefined,
    source: row.source ?? "local",
    group: row.group ?? undefined,
  }
}

function getServerDir(id: string): string {
  return getMcServerDir(id)
}

/**
 * Разрешает путь внутри папки сервера.
 *
 * Раньше каждый из fs-хендлеров повторял `path.join(dir, rel)` и проверку
 * `result.startsWith(dir)`. Такая проверка ненадёжна: для папки
 * `.../mc-servers/abc` путь `.../mc-servers/abc-other/секрет` тоже начинается
 * с той же строки и проходил её. Здесь сравниваем через `path.relative` —
 * выход за пределы каталога (в том числе через `..`) отсекается, а путь
 * нормализуется.
 */
function resolveInsideServer(serverDir: string, relativePath: string): string {
  const resolvedRoot = path.resolve(serverDir)
  const resolved = path.resolve(resolvedRoot, relativePath || ".")
  const relative = path.relative(resolvedRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path traversal not allowed")
  }
  return resolved
}

function escapePropertiesValue(value: string): string {
  const chars: string[] = []
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (ch === "\\") chars.push("\\\\")
    else if (ch === "\n") chars.push("\\n")
    else if (ch === "\r") chars.push("\\r")
    else if (ch === "\t") chars.push("\\t")
    else if (code > 0x7F) chars.push(`\\u${code.toString(16).padStart(4, "0")}`)
    else chars.push(ch)
  }
  return chars.join("")
}

function unescapePropertiesValue(value: string): string {
  let result = ""
  let i = 0
  while (i < value.length) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[i + 1]
      if (next === "n") { result += "\n"; i += 2 }
      else if (next === "r") { result += "\r"; i += 2 }
      else if (next === "t") { result += "\t"; i += 2 }
      else if (next === "\\") { result += "\\"; i += 2 }
      else if (next === "u" && i + 5 < value.length) {
        const hex = value.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else {
          result += value[i]; i++
        }
      } else { result += value[i]; i++ }
    } else {
      result += value[i]; i++
    }
  }
  return result
}

function loadServerProperties(propsPath: string): Record<string, string> {
  if (!fs.existsSync(propsPath)) return {}
  const content = fs.readFileSync(propsPath, "utf-8")
  const props: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    props[trimmed.slice(0, eqIdx)] = unescapePropertiesValue(trimmed.slice(eqIdx + 1))
  }
  return props
}

function saveServerProperties(propsPath: string, props: Record<string, string>): void {
  const lines = ["#Minecraft server properties"]
  for (const [key, value] of Object.entries(props)) {
    lines.push(`${key}=${escapePropertiesValue(value)}`)
  }
  fs.writeFileSync(propsPath, lines.join("\n") + "\n", "utf-8")
}

/**
 * Поля, которые живут одновременно и в server.properties, и в записи сервера.
 * Если их не синхронизировать, старт сервера перезаписывает файл значениями из
 * БД и правки пользователя «откатываются».
 */
function mirroredFieldsFromProperties(props: Record<string, string>): Partial<McServerRow> {
  const fields: Partial<McServerRow> = {}

  const port = Number.parseInt(props["server-port"] ?? "", 10)
  if (Number.isInteger(port) && port > 0 && port <= 65535) fields.port = port

  const onlineMode = props["online-mode"]
  if (onlineMode !== undefined) fields.onlineMode = onlineMode.trim().toLowerCase() === "true" ? 1 : 0

  const maxPlayers = Number.parseInt(props["max-players"] ?? "", 10)
  if (Number.isInteger(maxPlayers) && maxPlayers >= 0) fields.maxPlayers = maxPlayers

  return fields
}

function applyMirroredFieldsToProps(props: Record<string, string>, row: McServerRow): void {
  props["server-port"] = String(row.port)
  props["online-mode"] = row.onlineMode !== 0 ? "true" : "false"
  props["max-players"] = String(row.maxPlayers ?? 20)
}

// Запись в server.properties идёт из нескольких мест (вкладка Properties,
// настройки сервера, старт). Очередь на сервер исключает «гонку», когда два
// чтения-изменения-записи накладываются и последняя запись теряет чужую правку.
const serverFileLocks = new Map<string, Promise<void>>()

function withServerFileLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = serverFileLocks.get(id) ?? Promise.resolve()
  const run = previous.then(task, task)
  const chain = run.then(() => undefined, () => undefined)
  serverFileLocks.set(id, chain)
  void chain.then(() => {
    if (serverFileLocks.get(id) === chain) serverFileLocks.delete(id)
  })
  return run
}

export function registerMcServerHandlers() {
  ipcMain.handle("mc-server:list", async () => {
    const rows = await dbHelpers.listMcServers()
    return rows.map(rowToInfo)
  })

  ipcMain.handle("mc-server:get", async (_event, id: string) => {
    const row = await dbHelpers.getMcServer(id)
    return row ? rowToInfo(row) : null
  })

  ipcMain.handle("mc-server:create", async (_event, data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string; extraJavaArgs?: string }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const server: McServerRow = {
      id,
      name: data.name,
      gameVersion: data.gameVersion,
      modloader: data.modloader ?? "vanilla",
      modloaderVersion: data.modloaderVersion ?? null,
      port: data.port ?? 25565,
      xmx: data.xmx ?? 2048,
      xms: data.xms ?? 1024,
      extraJavaArgs: data.extraJavaArgs ?? "",
      javaPath: data.javaPath ?? null,
      autoRestart: 0,
      icon: data.icon ?? null,
      relayEnabled: data.relayEnabled ? 1 : 0,
      onlineMode: data.onlineMode !== false ? 1 : 0,
      maxPlayers: data.maxPlayers ?? 20,
      createdAt: now,
      trashedAt: null,
      customJar: data.customJarPath ? "custom-server.jar" : null,
      source: "local",
    }
    await dbHelpers.createMcServer(server)

    // Create server directory
    const serverDir = getServerDir(id)
    fs.mkdirSync(serverDir, { recursive: true })

    // Copy custom JAR if provided
    if (data.customJarPath && fs.existsSync(data.customJarPath)) {
      const jarDest = path.join(serverDir, "custom-server.jar")
      fs.copyFileSync(data.customJarPath, jarDest)
    }

    return rowToInfo(server)
  })

  ipcMain.handle("mc-server:analyze-jar", async (_event, jarPath: string) => {
    if (!jarPath) return { minecraftVersion: null, loaderId: null, loaderLabel: null, modId: null, mainClass: null, error: "Путь не указан" }
    try {
      return analyzeServerJar(jarPath)
    } catch (err: any) {
      return { minecraftVersion: null, loaderId: null, loaderLabel: null, modId: null, mainClass: null, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle("mc-server:update", async (_event, id: string, update: Record<string, unknown>) => {
    // ВАЖНО: список — единственный шлюз между renderer и БД. Поле категории
    // ([group]) обязано быть здесь, иначе назначение/переименование/удаление
    // категории молча теряется: UI обновляется оптимистично, а в БД ничего
    // не пишется, и после перезагрузки серверы снова «Без категории».
    const allowed = ["name", "gameVersion", "modloader", "modloaderVersion", "port", "xmx", "xms", "extraJavaArgs", "javaPath", "autoRestart", "icon", "relayEnabled", "onlineMode", "maxPlayers", "group"]
    const safe: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(update)) {
      if (!allowed.includes(key)) continue
      // Категория хранится как TEXT; пустая строка означает «без категории»,
      // поэтому нормализуем её в NULL, чтобы rowToInfo вернул undefined.
      if (key === "group") {
        safe[key] = typeof value === "string" && value.trim() ? value.trim() : null
        continue
      }
      safe[key] = value
    }
    await dbHelpers.updateMcServer(id, safe)

    // Порт, online-mode и max-players живут ещё и в server.properties. Если их
    // туда не продублировать, файл и лаунчер разъедутся, и при следующем старте
    // сервер поднимется со старыми значениями.
    const mirroredKeys = ["port", "onlineMode", "maxPlayers"]
    if (mirroredKeys.some(key => update[key] !== undefined)) {
      await withServerFileLock(id, async () => {
        const propsPath = path.join(getServerDir(id), "server.properties")
        if (!fs.existsSync(propsPath)) return
        const row = await dbHelpers.getMcServer(id)
        if (!row) return
        const props = loadServerProperties(propsPath)
        applyMirroredFieldsToProps(props, row)
        saveServerProperties(propsPath, props)
      })
    }
  })

  ipcMain.handle("mc-server:delete", async (_event, id: string) => {
    xnConnectManager.stop(id).catch(() => {})
    serverManager.kill(id).catch(() => {})
    await dbHelpers.softDeleteMcServer(id)
  })

  ipcMain.handle("mc-server:restore", async (_event, id: string) => {
    await dbHelpers.restoreMcServer(id)
  })

  // ── Export server to zip (like instance export, with category filter) ───
  ipcMain.handle("mc-server:export-zip", async (_event, id: string, serverName: string, categories?: string[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
      if (!win) return { success: false, error: "Окно недоступно" }
      const serverDir = getServerDir(id)
      try { await fs.promises.access(serverDir) } catch {
        return { success: false, error: "Папка сервера пуста" }
      }
      const picked = await dialog.showSaveDialog(win, {
        title: "Экспорт сервера",
        defaultPath: `${sanitizeFileName(serverName || id)}.zip`,
        filters: [{ name: "Zip архив", extensions: ["zip"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: "Экспорт отменён" }

      // Category → top-level entries of a server directory (Prism-style filter).
      const CATEGORY_ENTRIES: Record<string, Set<string>> = {
        world: new Set(["world", "world_nether", "world_the_end"]),
        mods: new Set(["mods"]),
        plugins: new Set(["plugins"]),
        configs: new Set(["config", "eula.txt", "server.properties", "whitelist.json", "ops.json", "banned-players.json", "banned-ips.json", "usercache.json"]),
        logs: new Set(["logs", "crash-reports", "cache", ".cache"]),
      }
      const DEFAULT_EXCLUDED = new Set(["logs", "crash-reports", "cache", ".cache", "jars"])
      const includeLogs = !categories || categories.includes("logs")

      const AdmZip = await loadAdmZip()
      const zip = new AdmZip()
      zip.addLocalFolder(serverDir, path.basename(picked.filePath, ".zip"), (filename: string) => {
        const top = filename.split(/[\\/]/)[1]
        if (categories == null) return !DEFAULT_EXCLUDED.has(top)
        // Root-level loose files (server.properties etc.) live in configs;
        // `top` is undefined only for the folder itself — always included.
        if (top === undefined) return true
        for (const [catId, entries] of Object.entries(CATEGORY_ENTRIES)) {
          if (catId === "logs") continue
          if (categories.includes(catId) && entries.has(top)) return true
        }
        return includeLogs && CATEGORY_ENTRIES.logs.has(top)
      })
      await fs.promises.writeFile(picked.filePath, zip.toBuffer())
      return { success: true, path: picked.filePath }
    } catch (error) {
      return opFailure(error)
    }
  })

  // ── Duplicate server: copy DB row and files under a new name ────────────
  ipcMain.handle("mc-server:duplicate", async (_event, id: string): Promise<McServerInfo | null> => {
    const row = await dbHelpers.getMcServer(id)
    if (!row) return null

    const newId = randomUUID()
    const now = new Date().toISOString()
    // Find a free "Name (copy)" suffix
    const existing = await dbHelpers.listMcServers()
    let name = `${row.name} (копия)`
    let n = 2
    while (existing.some(s => s.name === name)) {
      name = `${row.name} (копия ${n})`
      n++
    }

    await dbHelpers.createMcServer({
      ...row,
      id: newId,
      name,
      // Pick a free port so the copy can run alongside the original
      port: (() => {
        const taken = new Set(existing.map(s => s.port))
        let p = row.port
        while (taken.has(p) && p < 65535) p++
        return p
      })(),
      createdAt: now,
      trashedAt: null,
    })

    // Copy server files (world, configs, mods...) when the source dir exists
    const srcDir = getServerDir(id)
    try {
      await fs.promises.access(srcDir)
      const destDir = getServerDir(newId)
      await fs.promises.mkdir(destDir, { recursive: true })
      await fs.promises.cp(srcDir, destDir, { recursive: true, verbatimSymlinks: true })
    } catch { /* fresh server without files is fine */ }

    return rowToInfo({ ...row, id: newId, name, createdAt: now, trashedAt: null })
  })

  ipcMain.handle("mc-server:list-trash", async () => {
    const rows = await dbHelpers.listTrashedMcServers()
    return rows.map(rowToInfo)
  })

  ipcMain.handle("mc-server:purge-trash", async (_event, deleteTunnel = true) => {
    // Delete XN Connect tunnels for every server being purged (best-effort)
    if (deleteTunnel) {
      try {
        const rows = await dbHelpers.listTrashedMcServers()
        for (const row of rows) {
          xnConnectManager.stop(row.id).catch(() => {})
          await xnConnectManager.deleteTunnelForServer(row.name, row.port).catch(() => false)
        }
      } catch { /* tunnel cleanup is optional */ }
    }
    await dbHelpers.purgeTrashedMcServers()
  })

  ipcMain.handle("mc-server:permanent-delete", async (_event, id: string, deleteTunnel = true) => {    xnConnectManager.stop(id).catch(() => {})
    serverManager.kill(id).catch(() => {})
    // Best-effort: remove the XN Connect tunnel belonging to this server so it
    // stops consuming the account's tunnel quota. Failures are non-fatal.
    if (deleteTunnel) {
      try {
        const row = await dbHelpers.getMcServer(id)
        if (row) await xnConnectManager.deleteTunnelForServer(row.name, row.port)
      } catch { /* tunnel cleanup is optional */ }
    }
    await dbHelpers.deleteMcServer(id)
  })

  ipcMain.handle("mc-server:start", async (_event, id: string) => {
    // Повторный клик по «Запустить» не поднимает второй процесс.
    if (pendingServerStarts.has(id) || serverManager.isRunning(id)) return

    const token = { cancelled: false }
    pendingServerStarts.set(id, token)
    try {
      await startMcServer(id, token)
    } finally {
      pendingServerStarts.delete(id)
    }
  })

  async function startMcServer(id: string, token: { cancelled: boolean }): Promise<void> {
    const currentRow = await dbHelpers.getMcServer(id)
    if (!currentRow) throw new Error("Server not found")

    const serverDir = getServerDir(id)

    // server.properties — источник правды для порта, online-mode и max-players:
    // переносим его значения в запись сервера, иначе старт откатил бы правки,
    // сделанные во вкладке Properties (или руками в файле).
    let row = await withServerFileLock(id, async () => {
      const propsPath = path.join(serverDir, "server.properties")
      const fromFile = mirroredFieldsFromProperties(loadServerProperties(propsPath))
      if (Object.keys(fromFile).length > 0) {
        await dbHelpers.updateMcServer(id, fromFile)
      }
      return (await dbHelpers.getMcServer(id)) ?? currentRow
    })

    const serverInfo = rowToInfo(row)

    /** Стоп пришёл во время подготовки старта: процесс не поднимаем. */
    const cancelledByStop = () => token.cancelled
    const finishCancelled = () => {
      sendToRenderer("mc-server:state-change", { id, state: { status: "stopped" } satisfies McServerState })
    }
    if (cancelledByStop()) return finishCancelled()

    // Прогресс подготовки: нужен уже на этапе Java (её скачивание может быть
    // первым шагом, до загрузки ядра).
    const sendProgress = (progress: DownloadProgress) => {
      sendToRenderer("mc-server:download-progress", { id, progress })
    }

    // Auto-detect Java from settings or system
    const storedJava = row.javaPath && row.javaPath !== "auto" ? row.javaPath : null
    let javaPath: string | undefined = storedJava ?? (await dbHelpers.getSetting("javaPath")) ?? undefined
    if (!javaPath) {
      // Try to find java in common locations
      javaPath = findJavaBinarySync() ?? undefined
    }
    if (!javaPath) {
      // Java на машине нет и вручную не выбрана — скачиваем рантайм Mojang
      // (как это делает запуск клиента). Без этого сервер не стартовал вовсе:
      // путь к Java нужен и для установки ядра (инсталляторы Forge/NeoForge).
      const required = requiredJavaForMcVersion(serverInfo.gameVersion)
      sendProgress({ phase: "downloading", message: `Java не найдена — скачиваю рантайм (Java ${required})...`, percent: 0 })
      try {
        const runtime = await ensureServerJava(serverInfo.gameVersion, (percent) => {
          sendProgress({ phase: "downloading", message: `Скачивание Java ${required}...`, percent })
        })
        javaPath = runtime.path
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Java не найдена, и не удалось скачать рантайм: ${message}`)
      }
    }

    // Ensure server JAR exists — download if needed
    let resolvedJarPath: string
    try {
      resolvedJarPath = await ensureServerJar(
        serverDir,
        serverInfo.modloader,
        serverInfo.gameVersion,
        serverInfo.modloaderVersion,
        javaPath,
        sendProgress,
        row.customJar,
      )
    } catch (err: any) {
      sendProgress({ phase: "error", message: `Ошибка загрузки: ${err.message}` })
      throw new Error(`Failed to download server JAR: ${err.message}`)
    }

    // Accept EULA if needed — check eula.txt on disk
    const eulaPath = path.join(serverDir, "eula.txt")
    if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, "utf-8").includes("eula=true")) {
      fs.writeFileSync(eulaPath, "eula=true\n")
    }

    // Дописываем в server.properties то, чего в нём ещё нет (первый запуск):
    // значения приходят из записи сервера, которая уже синхронизирована с файлом.
    await withServerFileLock(id, async () => {
      const propsPath = path.join(serverDir, "server.properties")
      const props = loadServerProperties(propsPath)
      applyMirroredFieldsToProps(props, row)
      saveServerProperties(propsPath, props)
    })

    // Ещё раз проверяем отмену прямо перед спавном.
    if (cancelledByStop()) return finishCancelled()

    serverManager.start(
      id,
      serverInfo,
      javaPath,
      serverDir,
      (line) => sendToRenderer("mc-server:log", { id, line }),
      attachServerUptimeTracking(id, serverInfo, (state) => {
        sendToRenderer("mc-server:state-change", { id, state })
        // Туннель поднимаем только когда сервер действительно запустился
        // (маркер готовности в консоли): до этого порт ещё закрыт, и relay
        // молотил бы ошибки подключения.
        if (state.status === "running" && row.relayEnabled === 1) {
          xnConnectManager.start(id, serverInfo.name, serverInfo.port).catch((err: any) => {
            logRuntime(`[XN-Connect] Failed to start relay: ${err.message}`)
          })
        }
        // Сервер умер сам (crash, /stop из консоли, закрытие процесса) —
        // туннель тоже должен уйти, иначе он остаётся висеть без сервера.
        if (state.status === "stopped" || state.status === "stopping") {
          xnConnectManager.stop(id).catch(() => {})
        }
      }),
      resolvedJarPath,
    )
  }

  ipcMain.handle("mc-server:stop", async (_event, id: string) => {
    // Старт ещё готовится — отменяем его.
    const pendingStart = pendingServerStarts.get(id)
    if (pendingStart) pendingStart.cancelled = true

    // Повторные stop не шлют команду и события заново.
    const inFlight = pendingServerStops.get(id)
    if (inFlight) return inFlight

    if (!serverManager.isRunning(id)) {
      // Гасить нечего — просто подтверждаем остановленное состояние.
      sendToRenderer("mc-server:state-change", { id, state: { status: "stopped" } satisfies McServerState })
      return
    }

    const task = (async () => {
      sendToRenderer("mc-server:state-change", { id, state: { status: "stopping" } satisfies McServerState })
      xnConnectManager.stop(id).catch(() => {})
      await serverManager.stop(id)
      sendToRenderer("mc-server:state-change", { id, state: { status: "stopped" } satisfies McServerState })
    })()
    pendingServerStops.set(id, task)
    try {
      await task
    } finally {
      pendingServerStops.delete(id)
    }
  })

  ipcMain.handle("mc-server:kill", async (_event, id: string) => {
    xnConnectManager.stop(id).catch(() => {})
    await serverManager.kill(id)
    sendToRenderer("mc-server:state-change", { id, state: { status: "stopped" } satisfies McServerState })
  })

  ipcMain.handle("mc-server:send-command", async (_event, id: string, command: string) => {
    await serverManager.sendCommand(id, command)
  })

  ipcMain.handle("mc-server:status", async (_event, id: string) => {
    return serverManager.getState(id)
  })

  ipcMain.handle("mc-server:metrics", async (_event, id: string) => {
    // Мгновенный ответ из кэша фонового сэмплера.
    return serverManager.getMetricsSync(id)
  })

  ipcMain.handle("mc-server:metrics-subscribe", async (event, id: string) => {
    const senderId = event.sender.id
    let subscribers = metricsSubscribers.get(id)
    if (!subscribers) {
      subscribers = new Set()
      metricsSubscribers.set(id, subscribers)
    }
    subscribers.add(senderId)
    ensureMetricsTimer()
    // Сразу отдаём текущее значение из кэша — без ожидания тика таймера.
    pushServerMetrics()
  })

  ipcMain.handle("mc-server:metrics-unsubscribe", async (event, id: string) => {
    const senderId = event.sender.id
    const subscribers = metricsSubscribers.get(id)
    if (subscribers) {
      subscribers.delete(senderId)
      if (subscribers.size === 0) metricsSubscribers.delete(id)
    }
    stopMetricsTimerIfIdle()
  })

  ipcMain.handle("mc-server:logs", async (_event, id: string) => {
    return serverManager.getLogBuffer(id)
  })

  ipcMain.handle("mc-server:open-folder", async (_event, id: string) => {
    const serverDir = getServerDir(id)
    if (fs.existsSync(serverDir)) {
      const { shell } = await import("electron")
      shell.openPath(serverDir)
    }
  })

  ipcMain.handle("mc-server:read-properties", async (_event, id: string) => {
    const serverDir = getServerDir(id)
    const propsPath = path.join(serverDir, "server.properties")
    if (!fs.existsSync(propsPath)) return null
    return loadServerProperties(propsPath)
  })

  ipcMain.handle("mc-server:check-eula", async (_event, id: string): Promise<boolean> => {
    const eulaPath = path.join(getServerDir(id), "eula.txt")
    if (!fs.existsSync(eulaPath)) return false
    return fs.readFileSync(eulaPath, "utf-8").includes("eula=true")
  })

  ipcMain.handle("mc-server:accept-eula", async (_event, id: string) => {
    const eulaPath = path.join(getServerDir(id), "eula.txt")
    fs.writeFileSync(eulaPath, "eula=true\n")
  })

  ipcMain.handle("mc-server:write-properties", async (_event, id: string, properties: Record<string, string>) => {
    await withServerFileLock(id, async () => {
      const serverDir = getServerDir(id)
      fs.mkdirSync(serverDir, { recursive: true })
      const propsPath = path.join(serverDir, "server.properties")
      saveServerProperties(propsPath, properties)

      // Файл — источник правды для этих полей: сразу переносим их в запись
      // сервера, иначе старт сервера вернёт прежние значения из БД.
      const mirrored = mirroredFieldsFromProperties(properties)
      if (Object.keys(mirrored).length > 0) {
        await dbHelpers.updateMcServer(id, mirrored)
      }
    })
  })

  // ── Player lists (whitelist, ops, banned, banned-ips) ───

  function readJsonList(filePath: string): any[] {
    try {
      if (!fs.existsSync(filePath)) return []
      const raw = fs.readFileSync(filePath, "utf-8").trim()
      if (!raw) return []
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  function writeJsonList(filePath: string, list: any[]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2) + "\n", "utf-8")
  }

  function getServerJsonPath(id: string, filename: string): string {
    return path.join(getServerDir(id), filename)
  }

  /**
   * Списки игроков (whitelist, ops, banned, banned-ips) устроены одинаково:
   * прочитать JSON, изменить запись, записать файл и — если сервер запущен —
   * отправить ту же операцию командой в консоль. Раньше это были 11 отдельных
   * хендлеров с дословно скопированным каркасом, поэтому любая правка (сверка
   * по UUID, формат записи) вносилась в каждый из них.
   *
   * Теперь список описывается один раз: имена каналов, файл, поле-идентификатор
   * и команды серверу. `keyField` — поле для сверки и удаления (uuid у игроков,
   * ip у адресов), `nameField` — отображаемое имя.
   */
  type PlayerListSpec = {
    file: string
    keyField: "uuid" | "ip"
    nameField: "name" | "ip"
    channels: { get: string; add: string; remove: string }
    commands: { add: (name: string) => string; remove: (name: string) => string }
    /** Дополнительные поля новой записи (уровень оператора, причина бана...). */
    extraFields?: () => Record<string, unknown>
  }

  const PLAYER_LISTS: PlayerListSpec[] = [
    {
      file: "whitelist.json",
      keyField: "uuid",
      nameField: "name",
      channels: { get: "mc-server:get-whitelist", add: "mc-server:add-whitelist", remove: "mc-server:remove-whitelist" },
      commands: { add: (name) => `whitelist add ${name}`, remove: (name) => `whitelist remove ${name}` },
    },
    {
      file: "ops.json",
      keyField: "uuid",
      nameField: "name",
      channels: { get: "mc-server:get-ops", add: "mc-server:add-op", remove: "mc-server:remove-op" },
      commands: { add: (name) => `op ${name}`, remove: (name) => `deop ${name}` },
      extraFields: () => ({ level: 4, bypassesPlayerLimit: false }),
    },
    {
      file: "banned-players.json",
      keyField: "uuid",
      nameField: "name",
      channels: { get: "mc-server:get-banned", add: "mc-server:ban-player", remove: "mc-server:unban-player" },
      commands: { add: (name) => `ban ${name}`, remove: (name) => `pardon ${name}` },
      extraFields: () => ({ created: new Date().toISOString(), reason: "", expires: "", source: "Xneon Launcher" }),
    },
    {
      file: "banned-ips.json",
      keyField: "ip",
      nameField: "ip",
      channels: { get: "mc-server:get-banned-ips", add: "mc-server:ban-ip", remove: "mc-server:unban-ip" },
      commands: { add: (ip) => `ban-ip ${ip}`, remove: (ip) => `pardon-ip ${ip}` },
      extraFields: () => ({ created: new Date().toISOString(), reason: "", expires: "", source: "Xneon Launcher" }),
    },
  ]

  /** Отправляет команду серверу, если он запущен (иначе правки файла достаточно). */
  async function runPlayerListCommand(id: string, command: string): Promise<void> {
    if (!command) return
    if (serverManager.isRunning(id)) {
      await serverManager.sendCommand(id, command)
    }
  }

  for (const spec of PLAYER_LISTS) {
    ipcMain.handle(spec.channels.get, async (_event, id: string): Promise<McPlayerEntry[]> => {
      const list = readJsonList(getServerJsonPath(id, spec.file))
      return list.map((entry: any) => ({
        name: entry[spec.nameField] ?? "",
        uuid: spec.keyField === "uuid" ? (entry.uuid ?? "") : "",
      }))
    })

    ipcMain.handle(spec.channels.add, async (_event, id: string, value: string) => {
      const filePath = getServerJsonPath(id, spec.file)
      const list = readJsonList(filePath)
      // Дубликат по имени/адресу не добавляем (как и ванильный сервер).
      if (list.some((entry: any) => entry[spec.nameField]?.toLowerCase() === value.toLowerCase())) return
      list.push({
        [spec.keyField]: spec.keyField === "uuid" ? randomUUID() : value,
        [spec.nameField]: value,
        ...(spec.extraFields?.() ?? {}),
      })
      writeJsonList(filePath, list)
      await runPlayerListCommand(id, spec.commands.add(value))
    })

    ipcMain.handle(spec.channels.remove, async (_event, id: string, value: string) => {
      const filePath = getServerJsonPath(id, spec.file)
      const list = readJsonList(filePath)
      // У игроков приходит uuid, у адресов — сам ip; в обоих случаях это
      // значение keyField.
      const entry = list.find((item: any) => item[spec.keyField] === value)
      writeJsonList(filePath, list.filter((item: any) => item[spec.keyField] !== value))
      await runPlayerListCommand(id, entry ? spec.commands.remove(entry[spec.nameField]) : "")
    })
  }


  ipcMain.handle("mc-server:get-addresses", async (_event, id: string) => {
    const row = await dbHelpers.getMcServer(id)
    if (!row) return null
    const port = row.port

    // Local address — first non-internal IPv4
    const nets = os.networkInterfaces()
    let localIp = "127.0.0.1"
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === "IPv4" && !net.internal) {
          localIp = net.address
          break
        }
      }
      if (localIp !== "127.0.0.1") break
    }

    // Public address — try to fetch from external service
    let publicIp = ""
    try {
      const { default: http } = await import("http")
      publicIp = await new Promise<string>((resolve) => {
        const req = http.get("http://api.ipify.org?format=json", { timeout: 3000 }, (res) => {
          let data = ""
          res.on("data", (chunk: Buffer) => { data += chunk.toString() })
          res.on("end", () => {
            try { resolve(JSON.parse(data).ip ?? "") }
            catch { resolve("") }
          })
        })
        req.on("error", () => resolve(""))
        req.on("timeout", () => { req.destroy(); resolve("") })
      })
    } catch {}

    // Адрес XN Connect отдаём только если функция реально включена у сервера:
    // иначе в шапке висел бы чип «XNEON» без адреса (или с адресом выключенной
    // функции). Пока сервер остановлен, берём адрес уже созданного туннеля из
    // API, чтобы его было видно и можно было скопировать.
    let relayAddress: string | null = null
    if (row.relayEnabled === 1) {
      const relayState = xnConnectManager.getState(id)
      relayAddress = relayState.status === "running" ? relayState.publicAddress : null
      if (!relayAddress) {
        relayAddress = await xnConnectManager.getTunnelAddress(row.name, port)
      }
    }

    return {
      local: `${localIp}:${port}`,
      public: publicIp ? `${publicIp}:${port}` : null,
      custom: relayAddress,
    }
  })

  // ── Server Files ─────────────────────────────────────────

  ipcMain.handle("mc-server:fs-list", async (_event, id: string, relativePath: string) => {
    const targetDir = resolveInsideServer(getServerDir(id), relativePath)
    if (!fs.existsSync(targetDir)) return []
    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
    return entries.map(entry => {
      const fullPath = path.join(targetDir, entry.name)
      const stat = fs.statSync(fullPath)
      return {
        name: entry.name,
        isDir: entry.isDirectory(),
        size: stat.size,
        lastModified: stat.mtimeMs,
      }
    })
  })

  ipcMain.handle("mc-server:fs-read", async (_event, id: string, relativePath: string) => {
    const filePath = resolveInsideServer(getServerDir(id), relativePath)
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (stat.size > 2 * 1024 * 1024) return { error: "File too large (>2MB)" }
    return fs.readFileSync(filePath, "utf-8")
  })

  ipcMain.handle("mc-server:fs-write", async (_event, id: string, relativePath: string, content: string) => {
    const filePath = resolveInsideServer(getServerDir(id), relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, "utf-8")
  })

  ipcMain.handle("mc-server:fs-delete", async (_event, id: string, relativePath: string) => {
    const targetPath = resolveInsideServer(getServerDir(id), relativePath)
    if (!fs.existsSync(targetPath)) return
    const stat = fs.statSync(targetPath)
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(targetPath)
    }
  })

  ipcMain.handle("mc-server:fs-rename", async (_event, id: string, oldPath: string, newPath: string) => {
    const serverDir = getServerDir(id)
    const fullOld = resolveInsideServer(serverDir, oldPath)
    const fullNew = resolveInsideServer(serverDir, newPath)
    if (!fs.existsSync(fullOld)) throw new Error("Source path does not exist")
    fs.renameSync(fullOld, fullNew)
  })

  ipcMain.handle("mc-server:fs-mkdir", async (_event, id: string, relativePath: string) => {
    fs.mkdirSync(resolveInsideServer(getServerDir(id), relativePath), { recursive: true })
  })

  ipcMain.handle("mc-server:fs-stat", async (_event, id: string, relativePath: string) => {
    const targetPath = resolveInsideServer(getServerDir(id), relativePath)
    if (!fs.existsSync(targetPath)) return null
    const stat = fs.statSync(targetPath)
    return {
      name: path.basename(targetPath),
      isDir: stat.isDirectory(),
      size: stat.size,
      lastModified: stat.mtimeMs,
    }
  })

  ipcMain.handle("mc-server:fs-download", async (_event, id: string, relativePath: string, url: string, fileName: string) => {
    const targetDir = resolveInsideServer(getServerDir(id), relativePath)
    try {
      await fs.promises.mkdir(targetDir, { recursive: true })
      const safeFileName = sanitizeFileName(fileName)
      const filePath = path.join(targetDir, safeFileName)
      const buffer = await downloadBuffer(url, undefined, safeFileName)
      await fs.promises.writeFile(filePath, buffer)
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle("mc-server:resolve-installed", async (_event, id: string, relativePath: string) => {
    const targetDir = resolveInsideServer(getServerDir(id), relativePath)
    if (!fs.existsSync(targetDir)) return []
    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
    const jars = entries.filter(e => !e.isDirectory() && /\.(jar|zip)$/i.test(e.name))
    const hashes: { name: string; sha1: string }[] = []
    for (const entry of jars) {
      const fullPath = path.join(targetDir, entry.name)
      try {
        const hash = createHash("sha1")
        const handle = fs.openSync(fullPath, "r")
        try {
          const buf = Buffer.alloc(65536)
          let bytesRead: number
          while ((bytesRead = fs.readSync(handle, buf)) > 0) {
            hash.update(buf.subarray(0, bytesRead))
          }
        } finally {
          fs.closeSync(handle)
        }
        hashes.push({ name: entry.name, sha1: hash.digest("hex") })
      } catch {}
    }
    if (hashes.length === 0) return []
    const sha1Map = new Map<string, string>()
    const sha1List = hashes.map(h => { sha1Map.set(h.sha1, h.name); return h.sha1 })
    try {
      const res = await fetch("https://api.modrinth.com/v2/version_files", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "XNeon-Launcher/1.0 (launcher@xneon.fun)" },
        body: JSON.stringify({ hashes: sha1List, algorithm: "sha1" }),
      })
      if (!res.ok) return hashes.map(h => ({ name: h.name, sha1: h.sha1 }))
      const data = await res.json() as Record<string, { project_id?: string; version_id?: string }>
      return sha1List.map(sha1 => ({
        name: sha1Map.get(sha1) ?? "",
        sha1,
        projectId: data[sha1]?.project_id,
        versionId: data[sha1]?.version_id,
      }))
    } catch {
      return hashes.map(h => ({ name: h.name, sha1: h.sha1 }))
    }
  })

  // ── Install server modpack from Modrinth / CurseForge ───

  ipcMain.handle("mc-server:install-pack", async (_event, params: {
    source: "modrinth" | "curseforge"
    projectSlug?: string
    versionId?: string
    modId?: number
    fileId?: number
    name?: string
    icon?: string
    port?: number
    xmx?: number
    xms?: number
    extraJavaArgs?: string
    javaPath?: string
    relayEnabled?: boolean
    onlineMode?: boolean
    maxPlayers?: number
  }): Promise<McServerInfo> => {
    const mods = await loadModsModule()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-pack-"))
    let zipBuffer: Buffer | null = null
    try {
      const modType = params.source
      let packName = params.name
      let packIcon = params.icon ?? null
      let zipUrl: string

      if (modType === "modrinth") {
        if (!params.projectSlug) throw new Error("Slug проекта не указан")
        const versions = await mods.modrinthGetRawVersions(params.projectSlug) as ModrinthVersionDetail[]
        let version = params.versionId ? versions.find((v) => v.id === params.versionId) : undefined
        if (!version) version = versions.find((v) => v.version_type === "release") ?? versions[0]
        if (!version) throw new Error("Версии не найдены")
        const mrpackFile = version.files?.find((f) => f.filename?.endsWith(".mrpack"))
        if (!mrpackFile?.url) throw new Error(".mrpack файл не найден")
        zipUrl = mrpackFile.url
        if (!packName) packName = version.name ?? version.version_number ?? params.projectSlug
      } else {
        if (!params.modId || !params.fileId) throw new Error("Модификация CurseForge не указана")
        const url = await mods.curseforgeGetDownloadUrl(params.modId, params.fileId)
        if (!url) throw new Error("Ссылка на скачивание недоступна")
        zipUrl = url
        if (!packName) packName = `CurseForge модпак #${params.modId}`
      }

      sendToRenderer("mc-server:download-progress", {
        id: "install",
        progress: { phase: "installing-pack", message: "Скачивание модпака..." },
      })
      const buff = await downloadBuffer(zipUrl, undefined, "modpack.zip")
      zipBuffer = buff
      const AdmZip = await loadAdmZip()
      const zip = new AdmZip(buff)

      let gameVersion = ""
      let modLoader = "vanilla"
      let loaderVersion: string | undefined
      let modrinthFiles: ModrinthManifestFile[] = []
      let cfFiles: CurseForgeManifestFile[] = []

      const mrIndexEntry = zip.getEntry("modrinth.index.json")
      const cfManifestEntry = zip.getEntry("manifest.json")

      if (mrIndexEntry) {
        const index = JSON.parse(mrIndexEntry.getData().toString("utf-8"))
        gameVersion = index.dependencies?.minecraft ?? ""
        const deps = index.dependencies ?? {}
        const sel = getLoaderSelectionFromModrinthDeps(deps)
        modLoader = sel.modLoader
        loaderVersion = sel.loaderVersion
        if (deps.forge) {
          modLoader = "forge"
          loaderVersion = deps.forge
        } else if (deps["fabric-loader"]) {
          modLoader = "fabric"
        } else if (deps["quilt-loader"]) {
          modLoader = "quilt"
        } else if (deps.neoforge) {
          modLoader = "neoforge"
        }
        modrinthFiles = ((index.files as ModrinthManifestFile[] | undefined) ?? []).filter((f) => f.env?.server !== "unsupported")
        if (!packName) packName = index.name ?? index.slug ?? "Серверный модпак"
      } else if (cfManifestEntry) {
        const manifest = JSON.parse(cfManifestEntry.getData().toString("utf-8"))
        gameVersion = manifest.minecraft?.version ?? ""
        const loaderRaw = manifest.minecraft?.modLoaders?.find((m: any) => m.primary)?.id ?? ""
        const sel = getLoaderSelectionFromCurseManifest(loaderRaw)
        modLoader = sel.modLoader
        loaderVersion = sel.loaderVersion
        if (loaderRaw.startsWith("fabric")) modLoader = "fabric"
        else if (loaderRaw.startsWith("quilt")) modLoader = "quilt"
        else if (loaderRaw.startsWith("neoforge")) modLoader = "neoforge"
        else if (loaderRaw.startsWith("forge")) modLoader = "forge"
        cfFiles = ((manifest.files as CurseForgeManifestFile[] | undefined) ?? []).filter((f) => f.projectID && f.fileID)
      } else {
        throw new Error("Манифест модпака не найден (нет modrinth.index.json или manifest.json)")
      }

      if (!gameVersion) throw new Error("Не удалось определить версию Minecraft")
      if (!packName) packName = "Серверный модпак"

      const id = randomUUID()
      const now = new Date().toISOString()
      const server: McServerRow = {
        id,
        name: packName,
        gameVersion,
        modloader: modLoader,
        modloaderVersion: loaderVersion ?? null,
        port: params.port ?? 25565,
        xmx: params.xmx ?? 2048,
        xms: params.xms ?? 1024,
        extraJavaArgs: params.extraJavaArgs ?? "",
        javaPath: params.javaPath && params.javaPath !== "auto" ? params.javaPath : null,
        autoRestart: 0,
        icon: packIcon,
        relayEnabled: params.relayEnabled ? 1 : 0,
        onlineMode: params.onlineMode !== undefined ? (params.onlineMode ? 1 : 0) : 1,
        maxPlayers: params.maxPlayers ?? 20,
        createdAt: now,
        trashedAt: null,
        customJar: null,
        source: params.source,
      }
      await dbHelpers.createMcServer(server)
      const serverDir = getServerDir(id)
      fs.mkdirSync(serverDir, { recursive: true })

      const sendPackProgress = (message: string, current?: number, total?: number) => {
        sendToRenderer("mc-server:download-progress", {
          id,
          progress: {
            phase: "installing-pack",
            message,
            percent: total ? Math.round(((current ?? 0) / total) * 100) : undefined,
          },
        })
      }

      if (modType === "modrinth") {
        const total = modrinthFiles.length
        let downloaded = 0
        for (const f of modrinthFiles) {
          const rel = f.path ?? ""
          const url = f.downloads?.[0]
          if (!rel || !url) continue
          const safeRel = sanitizeRelativeContentPath(rel)
          let targetPath: string
          try {
            targetPath = resolveInsideServer(serverDir, safeRel)
          } catch {
            // Запись за пределами папки сервера — пропускаем такой файл.
            continue
          }
          const fileName = path.basename(safeRel)
          fs.mkdirSync(path.dirname(targetPath), { recursive: true })
          sendPackProgress(`${downloaded}/${total} файлов`, downloaded, total)
          try { await fs.promises.access(targetPath) } catch {
            const buffer = await downloadBuffer(url, undefined, fileName)
            await fs.promises.writeFile(targetPath, buffer)
          }
          downloaded++
          sendPackProgress(`${downloaded}/${total} файлов`, downloaded, total)
        }
        sendPackProgress("Распаковка overrides...", total, total)
        await copyOverrideEntries(zip, serverDir)
        await applyServerOverrides(zip, serverDir)
      } else {
        const total = cfFiles.length
        let downloaded = 0
        const modsDir = path.join(serverDir, "mods")
        fs.mkdirSync(modsDir, { recursive: true })

        // Пакетный запрос информации о всех файлах сборки (POST /v1/mods/files)
        const fileIds = cfFiles.map((f) => f.fileID).filter((id): id is number => typeof id === "number" && id > 0)
        let filesBatch: Record<number, { downloadUrl: string; fileName: string }> = {}
        try {
          filesBatch = await mods.curseforgeGetFiles(fileIds)
        } catch (err) {
          console.warn("[mc-server] CurseForge batch getFiles failed, using fallback:", err)
        }

        for (const f of cfFiles) {
          if (!f.projectID || !f.fileID) continue
          try {
            const batchInfo = filesBatch[f.fileID]
            let fileUrl: string | null = batchInfo?.downloadUrl ?? null
            let fileName = batchInfo?.fileName

            if (!fileUrl) {
              fileUrl = await mods.curseforgeGetDownloadUrl(f.projectID, f.fileID)
            }
            if (!fileUrl) continue

            const extractedName = fileUrl.split("/").pop()?.split("?")[0]
            fileName = sanitizeFileName(fileName || (extractedName ?? `mod-${f.fileID}.jar`))
            const targetPath = path.join(modsDir, fileName)
            sendPackProgress(`${downloaded}/${total} модов`, downloaded, total)
            try { await fs.promises.access(targetPath) } catch {
              const buffer = await downloadBuffer(fileUrl, undefined, fileName)
              await fs.promises.writeFile(targetPath, buffer)
            }
          } catch (err) {
            console.error("[mc-server] Pack mod download failed:", err)
          }
          downloaded++
          sendPackProgress(`${downloaded}/${total} модов`, downloaded, total)
        }
        sendPackProgress("Распаковка overrides...", total, total)
        await copyOverrideEntries(zip, serverDir)
      }

      sendToRenderer("mc-server:download-progress", {
        id,
        progress: { phase: "done", percent: 100, message: "Модпак установлен" },
      })
      return rowToInfo(server)
    } catch (err: any) {
      console.error("[mc-server] Install pack error:", err)
      throw err
    } finally {
      if (zipBuffer) zipBuffer = null
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

}

async function applyServerOverrides(zip: {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
}, serverDir: string) {
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("server-overrides/") && !entry.isDirectory) {
      const relPath = entry.entryName.replace(/^server-overrides\//, "")
      let destPath: string
      try {
        destPath = resolveInsideServer(serverDir, relPath)
      } catch {
        // Запись за пределами папки сервера — пропускаем.
        continue
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.writeFileSync(destPath, entry.getData())
    }
  }
}

/**
 * Требуемая версия Java для версии Minecraft (как в манифесте Mojang):
 * ≤ 1.16.5 → 8, 1.17 → 16, 1.18–1.20.4 → 17, 1.20.5+ → 21.
 * Снапшоты и нестандартные id трактуем как современные.
 */
export function requiredJavaForMcVersion(mcVersion: string): number {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec((mcVersion ?? "").trim())
  if (!match) return 21
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] ?? 0)
  if (major !== 1) return 21
  if (minor <= 16) return 8
  if (minor === 17) return 16
  if (minor < 20 || (minor === 20 && patch < 5)) return 17
  return 21
}

/**
 * Java для запуска сервера.
 *
 * Если на машине нет ни одной Java и вручную она не выбрана, рантайм
 * скачивается тем же механизмом, что и при запуске клиента (`JavaManager` из
 * @xnlc/core) — в общий каталог `<gameDir>/runtime`, поэтому клиент и сервер
 * переиспользуют одну установку. Раньше старт сервера в этой ситуации просто
 * падал с «Java not found. Please set Java path in settings», из-за чего без
 * установленной вручную Java сервер нельзя было запустить вообще (ядро даже не
 * начинало скачиваться, потому что путь к Java нужен уже для инсталляторов).
 */
export async function ensureServerJava(
  mcVersion: string,
  onProgress: (percent: number) => void,
): Promise<{ path: string; version?: number }> {
  const core = await loadXnlcModule()
  const manager = new core.JavaManager(new core.Downloader(), await getGameDir())
  const required = requiredJavaForMcVersion(mcVersion)
  logRuntime(`[Server] Java не найдена — скачиваю рантайм (Java ${required})`)
  const runtime = await manager.findOrDownloadJava(required, undefined, onProgress)
  return { path: runtime.path, version: runtime.version }
}

