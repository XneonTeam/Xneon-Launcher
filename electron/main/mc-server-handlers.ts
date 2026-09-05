import { ipcMain, BrowserWindow, dialog } from "electron"
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
import type { McServerInfo, McServerState, McServerMetrics, McPlayerEntry } from "@xnlc/types" with { "resolution-mode": "import" }
import { logRuntime } from "./runtime"

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
  }
}

function getServerDir(id: string): string {
  const dataDir = path.join(
    process.platform === "win32"
      ? path.join(process.env.APPDATA || "", "xneonlauncher")
      : process.platform === "darwin"
        ? path.join(process.env.HOME || "", "Library", "Application Support", "xneonlauncher")
        : path.join(process.env.HOME || "", ".xneonlauncher"),
    "mc-servers",
    id,
  )
  return dataDir
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
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

export function registerMcServerHandlers() {
  ipcMain.handle("mc-server:list", async () => {
    const rows = await dbHelpers.listMcServers()
    return rows.map(rowToInfo)
  })

  ipcMain.handle("mc-server:get", async (_event, id: string) => {
    const row = await dbHelpers.getMcServer(id)
    return row ? rowToInfo(row) : null
  })

  ipcMain.handle("mc-server:create", async (_event, data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string }) => {
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
      extraJavaArgs: "",
      javaPath: data.javaPath ?? null,
      autoRestart: 0,
      icon: null,
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
    const allowed = ["name", "gameVersion", "modloader", "modloaderVersion", "port", "xmx", "xms", "extraJavaArgs", "javaPath", "autoRestart", "icon", "relayEnabled", "onlineMode", "maxPlayers"]
    const safe: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(update)) {
      if (allowed.includes(key)) safe[key] = value
    }
    await dbHelpers.updateMcServer(id, safe)

    // If port changed, update server.properties
    if (update.port !== undefined) {
      const serverDir = getServerDir(id)
      const propsPath = path.join(serverDir, "server.properties")
      if (fs.existsSync(propsPath)) {
        let props: Record<string, string> = {}
        const content = fs.readFileSync(propsPath, "utf-8")
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith("#")) continue
          const eqIdx = trimmed.indexOf("=")
          if (eqIdx === -1) continue
          props[trimmed.slice(0, eqIdx)] = unescapePropertiesValue(trimmed.slice(eqIdx + 1))
        }
        props["server-port"] = String(update.port)
        const propsLines = ["#Minecraft server properties"]
        for (const [key, value] of Object.entries(props)) {
          propsLines.push(`${key}=${escapePropertiesValue(value)}`)
        }
        fs.writeFileSync(propsPath, propsLines.join("\n") + "\n", "utf-8")
      }
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
      return { success: false, error: error instanceof Error ? error.message : String(error) }
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
    const row = await dbHelpers.getMcServer(id)
    if (!row) throw new Error("Server not found")

    const serverInfo = rowToInfo(row)
    const serverDir = getServerDir(id)

    // Auto-detect Java from settings or system
    const storedJava = row.javaPath && row.javaPath !== "auto" ? row.javaPath : null
    let javaPath: string | undefined = storedJava ?? (await dbHelpers.getSetting("javaPath")) ?? undefined
    if (!javaPath) {
      // Try to find java in common locations
      javaPath = findJavaPath() ?? undefined
    }
    if (!javaPath) {
      throw new Error("Java not found. Please set Java path in settings.")
    }

    // Ensure server JAR exists — download if needed
    const sendProgress = (progress: DownloadProgress) => {
      sendToRenderer("mc-server:download-progress", { id, progress })
    }

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

    // Write port to server.properties
    const propsPath = path.join(serverDir, "server.properties")
    let props: Record<string, string> = {}
    if (fs.existsSync(propsPath)) {
      const content = fs.readFileSync(propsPath, "utf-8")
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eqIdx = trimmed.indexOf("=")
        if (eqIdx === -1) continue
        props[trimmed.slice(0, eqIdx)] = unescapePropertiesValue(trimmed.slice(eqIdx + 1))
      }
    }
    props["server-port"] = String(serverInfo.port)
    if (row.onlineMode !== undefined) props["online-mode"] = row.onlineMode ? "true" : "false"
    if (row.maxPlayers) props["max-players"] = String(row.maxPlayers)
    const propsLines = ["#Minecraft server properties"]
    for (const [key, value] of Object.entries(props)) {
      propsLines.push(`${key}=${escapePropertiesValue(value)}`)
    }
    fs.writeFileSync(propsPath, propsLines.join("\n") + "\n", "utf-8")

    serverManager.start(
      id,
      serverInfo,
      javaPath,
      serverDir,
      (line) => sendToRenderer("mc-server:log", { id, line }),
      (state) => sendToRenderer("mc-server:state-change", { id, state }),
      resolvedJarPath,
    )

    // Start relay if enabled
    if (row.relayEnabled === 1) {
      try {
        await xnConnectManager.start(id, serverInfo.name, serverInfo.port)
      } catch (err: any) {
        logRuntime(`[XN-Connect] Failed to start relay: ${err.message}`)
      }
    }
  })

  ipcMain.handle("mc-server:stop", async (_event, id: string) => {
    sendToRenderer("mc-server:state-change", { id, state: { status: "stopping" } satisfies McServerState })
    xnConnectManager.stop(id).catch(() => {})
    await serverManager.stop(id)
    sendToRenderer("mc-server:state-change", { id, state: { status: "stopped" } satisfies McServerState })
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
    return serverManager.getMetrics(id)
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
    const content = fs.readFileSync(propsPath, "utf-8")
    const props: Record<string, string> = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx)
      const value = unescapePropertiesValue(trimmed.slice(eqIdx + 1))
      props[key] = value
    }
    return props
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
    const serverDir = getServerDir(id)
    fs.mkdirSync(serverDir, { recursive: true })
    const propsPath = path.join(serverDir, "server.properties")
    const lines = ["#Minecraft server properties"]
    for (const [key, value] of Object.entries(properties)) {
      lines.push(`${key}=${escapePropertiesValue(value)}`)
    }
    fs.writeFileSync(propsPath, lines.join("\n") + "\n", "utf-8")
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

  ipcMain.handle("mc-server:get-whitelist", async (_event, id: string): Promise<McPlayerEntry[]> => {
    const list = readJsonList(getServerJsonPath(id, "whitelist.json"))
    return list.map((e: any) => ({ name: e.name ?? "", uuid: e.uuid ?? "" }))
  })

  ipcMain.handle("mc-server:add-whitelist", async (_event, id: string, username: string) => {
    const filePath = getServerJsonPath(id, "whitelist.json")
    const list = readJsonList(filePath)
    if (list.some((e: any) => e.name?.toLowerCase() === username.toLowerCase())) return
    list.push({ uuid: randomUUID(), name: username })
    writeJsonList(filePath, list)
    if (serverManager.getState(id).status === "running") {
      await serverManager.sendCommand(id, `whitelist add ${username}`)
    }
  })

  ipcMain.handle("mc-server:remove-whitelist", async (_event, id: string, uuid: string) => {
    const filePath = getServerJsonPath(id, "whitelist.json")
    const list = readJsonList(filePath)
    const entry = list.find((e: any) => e.uuid === uuid)
    const filtered = list.filter((e: any) => e.uuid !== uuid)
    writeJsonList(filePath, filtered)
    if (serverManager.getState(id).status === "running" && entry) {
      await serverManager.sendCommand(id, `whitelist remove ${entry.name}`)
    }
  })

  ipcMain.handle("mc-server:get-ops", async (_event, id: string): Promise<McPlayerEntry[]> => {
    const list = readJsonList(getServerJsonPath(id, "ops.json"))
    return list.map((e: any) => ({ name: e.name ?? "", uuid: e.uuid ?? "" }))
  })

  ipcMain.handle("mc-server:add-op", async (_event, id: string, username: string) => {
    const filePath = getServerJsonPath(id, "ops.json")
    const list = readJsonList(filePath)
    if (list.some((e: any) => e.name?.toLowerCase() === username.toLowerCase())) return
    list.push({ uuid: randomUUID(), name: username, level: 4, bypassesPlayerLimit: false })
    writeJsonList(filePath, list)
    if (serverManager.getState(id).status === "running") {
      await serverManager.sendCommand(id, `op ${username}`)
    }
  })

  ipcMain.handle("mc-server:remove-op", async (_event, id: string, uuid: string) => {
    const filePath = getServerJsonPath(id, "ops.json")
    const list = readJsonList(filePath)
    const entry = list.find((e: any) => e.uuid === uuid)
    const filtered = list.filter((e: any) => e.uuid !== uuid)
    writeJsonList(filePath, filtered)
    if (serverManager.getState(id).status === "running" && entry) {
      await serverManager.sendCommand(id, `deop ${entry.name}`)
    }
  })

  ipcMain.handle("mc-server:get-banned", async (_event, id: string): Promise<McPlayerEntry[]> => {
    const list = readJsonList(getServerJsonPath(id, "banned-players.json"))
    return list.map((e: any) => ({ name: e.name ?? "", uuid: e.uuid ?? "" }))
  })

  ipcMain.handle("mc-server:ban-player", async (_event, id: string, username: string) => {
    const filePath = getServerJsonPath(id, "banned-players.json")
    const list = readJsonList(filePath)
    if (list.some((e: any) => e.name?.toLowerCase() === username.toLowerCase())) return
    list.push({ uuid: randomUUID(), name: username, created: new Date().toISOString(), reason: "", expires: "", source: "Xneon Launcher" })
    writeJsonList(filePath, list)
    if (serverManager.getState(id).status === "running") {
      await serverManager.sendCommand(id, `ban ${username}`)
    }
  })

  ipcMain.handle("mc-server:unban-player", async (_event, id: string, uuid: string) => {
    const filePath = getServerJsonPath(id, "banned-players.json")
    const list = readJsonList(filePath)
    const entry = list.find((e: any) => e.uuid === uuid)
    const filtered = list.filter((e: any) => e.uuid !== uuid)
    writeJsonList(filePath, filtered)
    if (serverManager.getState(id).status === "running" && entry) {
      await serverManager.sendCommand(id, `pardon ${entry.name}`)
    }
  })

  ipcMain.handle("mc-server:get-banned-ips", async (_event, id: string): Promise<McPlayerEntry[]> => {
    const list = readJsonList(getServerJsonPath(id, "banned-ips.json"))
    return list.map((e: any) => ({ name: e.ip ?? "", uuid: "" }))
  })

  ipcMain.handle("mc-server:ban-ip", async (_event, id: string, ip: string) => {
    const filePath = getServerJsonPath(id, "banned-ips.json")
    const list = readJsonList(filePath)
    if (list.some((e: any) => e.ip?.toLowerCase() === ip.toLowerCase())) return
    list.push({ ip, created: new Date().toISOString(), reason: "", expires: "", source: "Xneon Launcher" })
    writeJsonList(filePath, list)
    if (serverManager.getState(id).status === "running") {
      await serverManager.sendCommand(id, `ban-ip ${ip}`)
    }
  })

  ipcMain.handle("mc-server:unban-ip", async (_event, id: string, ip: string) => {
    const filePath = getServerJsonPath(id, "banned-ips.json")
    const list = readJsonList(filePath).filter((e: any) => e.ip !== ip)
    writeJsonList(filePath, list)
    if (serverManager.getState(id).status === "running") {
      await serverManager.sendCommand(id, `pardon-ip ${ip}`)
    }
  })

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

    // XN-Connect relay address
    const relayState = xnConnectManager.getState(id)
    const relayAddress = relayState.status === "running" ? relayState.publicAddress : null

    return {
      local: `${localIp}:${port}`,
      public: publicIp ? `${publicIp}:${port}` : null,
      custom: relayAddress,
    }
  })

  // ── Server Files ─────────────────────────────────────────

  ipcMain.handle("mc-server:fs-list", async (_event, id: string, relativePath: string) => {
    const serverDir = getServerDir(id)
    const targetDir = path.join(serverDir, relativePath)
    if (!targetDir.startsWith(serverDir)) throw new Error("Path traversal not allowed")
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
    const serverDir = getServerDir(id)
    const filePath = path.join(serverDir, relativePath)
    if (!filePath.startsWith(serverDir)) throw new Error("Path traversal not allowed")
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (stat.size > 2 * 1024 * 1024) return { error: "File too large (>2MB)" }
    return fs.readFileSync(filePath, "utf-8")
  })

  ipcMain.handle("mc-server:fs-write", async (_event, id: string, relativePath: string, content: string) => {
    const serverDir = getServerDir(id)
    const filePath = path.join(serverDir, relativePath)
    if (!filePath.startsWith(serverDir)) throw new Error("Path traversal not allowed")
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, "utf-8")
  })

  ipcMain.handle("mc-server:fs-delete", async (_event, id: string, relativePath: string) => {
    const serverDir = getServerDir(id)
    const targetPath = path.join(serverDir, relativePath)
    if (!targetPath.startsWith(serverDir)) throw new Error("Path traversal not allowed")
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
    const fullOld = path.join(serverDir, oldPath)
    const fullNew = path.join(serverDir, newPath)
    if (!fullOld.startsWith(serverDir) || !fullNew.startsWith(serverDir)) throw new Error("Path traversal not allowed")
    if (!fs.existsSync(fullOld)) throw new Error("Source path does not exist")
    fs.renameSync(fullOld, fullNew)
  })

  ipcMain.handle("mc-server:fs-mkdir", async (_event, id: string, relativePath: string) => {
    const serverDir = getServerDir(id)
    const targetDir = path.join(serverDir, relativePath)
    if (!targetDir.startsWith(serverDir)) throw new Error("Path traversal not allowed")
    fs.mkdirSync(targetDir, { recursive: true })
  })

  ipcMain.handle("mc-server:fs-stat", async (_event, id: string, relativePath: string) => {
    const serverDir = getServerDir(id)
    const targetPath = path.join(serverDir, relativePath)
    if (!targetPath.startsWith(serverDir)) throw new Error("Path traversal not allowed")
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
    const serverDir = getServerDir(id)
    const targetDir = path.join(serverDir, relativePath)
    if (!targetDir.startsWith(serverDir)) throw new Error("Path traversal not allowed")
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
    const serverDir = getServerDir(id)
    const targetDir = path.join(serverDir, relativePath)
    if (!targetDir.startsWith(serverDir)) throw new Error("Path traversal not allowed")
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
          const targetPath = path.join(serverDir, safeRel)
          if (!targetPath.startsWith(serverDir)) continue
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
        for (const f of cfFiles) {
          if (!f.projectID || !f.fileID) continue
          try {
            const fileUrl = await mods.curseforgeGetDownloadUrl(f.projectID, f.fileID)
            if (!fileUrl) continue
            const fileName = sanitizeFileName(fileUrl.split("/").pop()?.split("?")[0] ?? `mod-${f.fileID}.jar`)
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

  // ── XN-Connect Relay ────────────────────────────────────

  ipcMain.handle("xn-connect:authorize", async () => {
    return xnConnectManager.authorize((state) => {
      sendToRenderer("xn-connect:auth-state", { state })
    })
  })

  ipcMain.handle("xn-connect:start", async (_event, serverId: string) => {
    const row = await dbHelpers.getMcServer(serverId)
    if (!row) throw new Error("Server not found")
    return xnConnectManager.start(serverId, row.name, row.port)
  })

  ipcMain.handle("xn-connect:stop", async (_event, serverId: string) => {
    await xnConnectManager.stop(serverId)
  })

  ipcMain.handle("xn-connect:status", async (_event, serverId: string) => {
    return xnConnectManager.getState(serverId)
  })

  ipcMain.handle("xn-connect:usage", async () => {
    // Always fetch fresh data from the API so limit checks are accurate;
    // fall back to cache when the API is unreachable
    try {
      return await xnConnectManager.refreshUsage()
    } catch {
      return xnConnectManager.getUsage()
    }
  })
}

async function applyServerOverrides(zip: {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
}, serverDir: string) {
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("server-overrides/") && !entry.isDirectory) {
      const relPath = entry.entryName.replace(/^server-overrides\//, "")
      const destPath = path.join(serverDir, relPath)
      if (!destPath.startsWith(serverDir)) continue
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.writeFileSync(destPath, entry.getData())
    }
  }
}

function findJavaPath(): string | null {
  const isWin = process.platform === "win32"
  const javaExe = isWin ? "java.exe" : "java"

  // Check JAVA_HOME
  const javaHome = process.env.JAVA_HOME
  if (javaHome) {
    const candidate = path.join(javaHome, "bin", javaExe)
    if (fs.existsSync(candidate)) return candidate
  }

  // Check common locations
  if (isWin) {
    const bases = [
      "C:\\Program Files\\Java",
      "C:\\Program Files\\Eclipse Adoptium",
      "C:\\Program Files\\Microsoft",
      "C:\\Program Files\\Zulu",
      "C:\\Program Files\\BellSoft",
      "C:\\Program Files\\Amazon Corretto",
      "C:\\Program Files\\OpenJDK",
    ]
    for (const base of bases) {
      if (!fs.existsSync(base)) continue
      try {
        const dirs = fs.readdirSync(base)
        for (const dir of dirs) {
          const candidate = path.join(base, dir, "bin", javaExe)
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {}
    }
  } else if (process.platform === "darwin") {
    const candidates = [
      "/Library/Java/JavaVirtualMachines",
      "/opt/homebrew/opt/openjdk/bin/java",
      "/usr/local/opt/openjdk/bin/java",
    ]
    for (const p of candidates) {
      if (p.endsWith("java")) {
        if (fs.existsSync(p)) return p
      } else if (fs.existsSync(p)) {
        try {
          const dirs = fs.readdirSync(p)
          for (const dir of dirs) {
            const candidate = path.join(p, dir, "Contents", "Home", "bin", "java")
            if (fs.existsSync(candidate)) return candidate
          }
        } catch {}
      }
    }
  } else {
    const bases = ["/usr/lib/jvm", "/usr/local/sdkman/candidates/java/current"]
    for (const base of bases) {
      if (!fs.existsSync(base)) continue
      try {
        const dirs = fs.readdirSync(base)
        for (const dir of dirs) {
          const candidate = path.join(base, dir, "bin", "java")
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {}
    }
  }

  return null
}
