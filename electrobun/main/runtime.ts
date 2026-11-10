import type { LauncherEvent } from "../platform/schema"
import type { IpcEventMap } from "@xnlc/types"
import { getLauncherDataRoot } from "./paths"
import { app, DesktopWindow } from "../platform/desktop"
import { initializeMinecraftStorageSync } from "./shared-game-cache"
import fs from "fs/promises"
import path from "path"
import { configureRuntimePaths, ensureRuntimeDir, ensureRuntimeTempDir, cleanupRuntimeCaches } from "./runtime-paths"

try { process.loadEnvFile?.() } catch {}

export const isDev = !app.isPackaged || process.env.NODE_ENV === "development"
const isVerboseRuntimeLogging = process.env.XN_VERBOSE_LOGS === "true"
export { ensureRuntimeDir, ensureRuntimeTempDir }

process.env.XNLC_META_CACHE_DIR = path.join(getLauncherDataRoot(), "cache", "meta")

let mainWindow: DesktopWindow | null = null
let pendingRuntimeLogs: string[] = []
let runtimeLogFlushTimer: NodeJS.Timeout | null = null

async function flushRuntimeLogs() {
  runtimeLogFlushTimer = null
  if (pendingRuntimeLogs.length === 0) return
  try {
    const dir = await ensureRuntimeDir()
    await fs.mkdir(dir, { recursive: true })
    const chunk = pendingRuntimeLogs.join("")
    pendingRuntimeLogs = []
    await fs.appendFile(path.join(dir, "launcher-main.log"), chunk)
  } catch {
    // ignore logging failures
  }
}

function appendRuntimeLog(line: string) {
  pendingRuntimeLogs.push(`[${new Date().toISOString()}] ${line}\n`)
  if (runtimeLogFlushTimer) return
  runtimeLogFlushTimer = setTimeout(() => { flushRuntimeLogs() }, 50)
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

logRuntime(`[Runtime] bootstrap platform=${process.platform} arch=${process.arch} bun=${process.versions.bun} node=${process.versions.node} packaged=${String(app.isPackaged)}`)

export function getMainWindow() {
  return mainWindow
}

export function setMainWindow(window: DesktopWindow | null) {
  mainWindow = window
}

export function sendToRenderer<C extends keyof IpcEventMap>(channel: C, payload: IpcEventMap[C]) {
  const windows = DesktopWindow.getAllWindows().filter(w => !w.isDestroyed())
  for (const win of windows) {
    win.viewSession.send({ channel, payload } as LauncherEvent)
  }
}

// Lazy deferred configureRuntimePaths — called from window.ts after app.whenReady
export let runtimePathsConfigured: Promise<void> | null = null

export function initRuntimePaths(): Promise<void> {
  if (!runtimePathsConfigured) {
    runtimePathsConfigured = Promise.resolve().then(() => {
      initializeMinecraftStorageSync(getLauncherDataRoot())
      return configureRuntimePaths()
    })
    if (process.platform === "linux" && isDev) {
      runtimePathsConfigured = runtimePathsConfigured.then(() => cleanupRuntimeCaches())
    }
  }
  return runtimePathsConfigured
}
