import { app, BrowserWindow } from "electron"
import fs from "fs"
import path from "path"
import { configureRuntimePaths, ensureRuntimeDir, ensureRuntimeTempDir, cleanupRuntimeCaches } from "./runtime-paths"

try { process.loadEnvFile?.() } catch {}

const isProtonWindows = process.platform === "win32" && !!process.env.STEAM_COMPAT_DATA_PATH

if (isProtonWindows) {
  app.commandLine.appendSwitch("disable-gpu")
  app.commandLine.appendSwitch("disable-gpu-compositing")
  app.commandLine.appendSwitch("disable-software-rasterizer")
  app.commandLine.appendSwitch("in-process-gpu")
  app.commandLine.appendSwitch("no-sandbox")
}

export const isDev = !app.isPackaged || process.env.NODE_ENV === "development"
const isVerboseRuntimeLogging = process.env.XN_VERBOSE_LOGS === "true"
export { ensureRuntimeDir, ensureRuntimeTempDir }

configureRuntimePaths()

if (process.platform === "linux" && isDev) {
  cleanupRuntimeCaches()
}

let mainWindow: BrowserWindow | null = null
let pendingRuntimeLogs: string[] = []
let runtimeLogFlushTimer: NodeJS.Timeout | null = null

function flushRuntimeLogs() {
  runtimeLogFlushTimer = null
  if (pendingRuntimeLogs.length === 0) return
  try {
    const dir = ensureRuntimeDir()
    fs.mkdirSync(dir, { recursive: true })
    const chunk = pendingRuntimeLogs.join("")
    pendingRuntimeLogs = []
    fs.appendFile(path.join(dir, "launcher-main.log"), chunk, () => {})
  } catch {
    // ignore logging failures
  }
}

function appendRuntimeLog(line: string) {
  pendingRuntimeLogs.push(`[${new Date().toISOString()}] ${line}\n`)
  if (runtimeLogFlushTimer) return
  runtimeLogFlushTimer = setTimeout(flushRuntimeLogs, 50)
}

export function logRuntime(line: string) {
  console.log(line)
  appendRuntimeLog(line)
}

export function logRuntimeDebug(line: string) {
  if (!isVerboseRuntimeLogging) {
    return
  }

  logRuntime(line)
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  return String(error)
}

process.on("uncaughtException", (error) => {
  logRuntime(`[Runtime] uncaughtException ${formatUnknownError(error)}`)
})

process.on("unhandledRejection", (reason) => {
  logRuntime(`[Runtime] unhandledRejection ${formatUnknownError(reason)}`)
})

process.on("warning", (warning) => {
  logRuntime(`[Runtime] warning ${formatUnknownError(warning)}`)
})

logRuntime(`[Runtime] bootstrap platform=${process.platform} arch=${process.arch} electron=${process.versions.electron ?? "unknown"} node=${process.versions.node} packaged=${String(app.isPackaged)}`)

export function getMainWindow() {
  return mainWindow
}

export function setMainWindow(window: BrowserWindow | null) {
  mainWindow = window
}

export function sendToRenderer(channel: string, data: unknown) {
  if (!mainWindow) {
    if (channel.startsWith("p2p:")) {
      console.warn(`[Runtime] sendToRenderer(${channel}): mainWindow is null — log dropped`)
    }
    return
  }
  mainWindow.webContents.send(channel, data)
}
