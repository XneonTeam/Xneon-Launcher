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
export { ensureRuntimeDir, ensureRuntimeTempDir }

configureRuntimePaths()

if (process.platform === "linux" && isDev) {
  cleanupRuntimeCaches()
}

let mainWindow: BrowserWindow | null = null

function appendRuntimeLog(line: string) {
  try {
    const dir = ensureRuntimeDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, "launcher-main.log"), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // ignore logging failures
  }
}

export function logRuntime(line: string) {
  console.log(line)
  appendRuntimeLog(line)
}

export function getMainWindow() {
  return mainWindow
}

export function setMainWindow(window: BrowserWindow | null) {
  mainWindow = window
}

export function sendToRenderer(channel: string, data: unknown) {
  mainWindow?.webContents.send(channel, data)
}
