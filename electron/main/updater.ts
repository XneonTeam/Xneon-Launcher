import { autoUpdater, UpdateInfo } from "electron-updater"
import { ipcMain, BrowserWindow } from "electron"
import { isDev, logRuntime, logRuntimeDebug } from "./runtime"

let pendingUpdate: UpdateInfo | null = null
let isDownloading = false
let updateDownloaded = false

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
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result?.updateInfo) {
        return { available: true, version: result.updateInfo.version }
      }
      return { available: false }
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle("update:download", async () => {
    if (!pendingUpdate) return { success: false, error: "No update available" }
    if (isDownloading) return { success: false, error: "Download already in progress" }
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
