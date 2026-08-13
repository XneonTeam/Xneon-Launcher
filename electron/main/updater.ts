import { autoUpdater, UpdateInfo } from "electron-updater"
import { app, ipcMain, BrowserWindow } from "electron"
import { isDev, logRuntime, logRuntimeDebug } from "./runtime"
import { isLaunchActive } from "./minecraft-core"

let pendingUpdate: UpdateInfo | null = null
let isDownloading = false
let updateDownloaded = false

function isVersionNewer(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, "").split(".").map(Number)
  const l = local.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0
    const b = l[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

const CURRENT_VERSION = app.getVersion()

function sendToRenderer(channel: string, ...args: unknown[]) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  })
}

export function registerUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.forceDevUpdateConfig = false

  if (isDev) {
    autoUpdater.logger = {
      info: (msg: string) => logRuntime(`[Updater] ${msg}`),
      warn: (msg: string) => logRuntime(`[Updater WARN] ${msg}`),
      error: (msg: string) => logRuntime(`[Updater ERROR] ${msg}`),
      debug: (msg: string) => logRuntimeDebug(`[Updater] ${msg}`),
    } as any
  }

  autoUpdater.on("checking-for-update", () => {
    logRuntime("[Updater] Checking for updates...")
    sendToRenderer("update:status", { status: "checking" })
  })

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (!isVersionNewer(info.version, CURRENT_VERSION)) {
      logRuntime(`[Updater] Update ${info.version} is not newer than current ${CURRENT_VERSION}, skipping`)
      return
    }
    logRuntime(`[Updater] Update available: ${info.version}`)
    pendingUpdate = info
    sendToRenderer("update:status", {
      status: "available",
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    })
  })

  autoUpdater.on("update-not-available", () => {
    logRuntime("[Updater] No update available")
    pendingUpdate = null
    sendToRenderer("update:status", { status: "not-available" })
  })

  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("update:progress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    logRuntime(`[Updater] Update downloaded: ${info.version}`)
    updateDownloaded = true
    pendingUpdate = info
    sendToRenderer("update:status", {
      status: "downloaded",
      version: info.version,
    })
  })

  autoUpdater.on("error", (err) => {
    logRuntime(`[Updater] Error: ${err.message}`)
    isDownloading = false
    sendToRenderer("update:status", { status: "error", error: err.message })
  })

  ipcMain.handle("update:check", async () => {
    if (isLaunchActive()) {
      logRuntime("[Updater] Update check blocked: Minecraft is running")
      return { available: false, error: "Minecraft is running. Close the game to check for updates." }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result?.updateInfo) {
        const remote = result.updateInfo.version
        if (isVersionNewer(remote, CURRENT_VERSION)) {
          return { available: true, version: remote }
        }
        return { available: false }
      }
      return { available: false }
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle("update:download", async () => {
    if (!pendingUpdate) return { success: false, error: "No update available" }
    if (isDownloading) return { success: false, error: "Download already in progress" }
    if (isLaunchActive()) {
      logRuntime("[Updater] Update download blocked: Minecraft is running")
      return { success: false, error: "Minecraft is running. Close the game to download the update." }
    }
    try {
      isDownloading = true
      await autoUpdater.downloadUpdate()
      isDownloading = false
      return { success: true }
    } catch (err) {
      isDownloading = false
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle("update:install", () => {
    if (isLaunchActive()) {
      logRuntime("[Updater] Update install blocked: Minecraft is running")
      return
    }
    logRuntime("[Updater] Installing update and restarting...")
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle("update:info", () => ({
    version: pendingUpdate?.version ?? null,
    downloaded: updateDownloaded,
  }))

  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        logRuntime(`[Updater] Auto-check failed: ${err.message}`)
      })
    }, 5000)
  }
}
