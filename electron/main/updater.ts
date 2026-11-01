import { autoUpdater, UpdateInfo } from "electron-updater"
import { app, ipcMain } from "electron"
import { isDev, logRuntime, logRuntimeDebug, sendToRenderer } from "./runtime"
import { isLaunchActive } from "./minecraft-core"
import { isVersionNewer } from "./utils/version"
import { getSetting, setSetting } from "../db/settings"

let pendingUpdate: UpdateInfo | null = null
let isDownloading = false
let updateDownloaded = false

const CURRENT_VERSION = app.getVersion()

export type UpdateChannel = "stable" | "beta"

const UPDATE_CHANNEL_KEY = "updateChannel"

function applyChannel(channel: UpdateChannel): void {
  if (channel === "beta") {
    autoUpdater.channel = "beta"
    autoUpdater.allowPrerelease = true
  } else {
    autoUpdater.channel = "latest"
    autoUpdater.allowPrerelease = false
  }
}

export function registerUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.forceDevUpdateConfig = false

  // Восстанавливаем выбранный канал обновлений из настроек.
  void getSetting(UPDATE_CHANNEL_KEY).then((stored) => {
    const channel: UpdateChannel = stored === "beta" ? "beta" : "stable"
    applyChannel(channel)
    logRuntime(`[Updater] Update channel: ${channel}`)
  })

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

  ipcMain.handle("update:get-channel", async (): Promise<UpdateChannel> => {
    const stored = await getSetting(UPDATE_CHANNEL_KEY)
    return stored === "beta" ? "beta" : "stable"
  })

  ipcMain.handle("update:set-channel", async (_event, channel: string) => {
    const next: UpdateChannel = channel === "beta" ? "beta" : "stable"
    await setSetting(UPDATE_CHANNEL_KEY, next)
    applyChannel(next)
    logRuntime(`[Updater] Update channel changed to: ${next}`)
    sendToRenderer("update:channel-changed", { channel: next })
  })


  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        logRuntime(`[Updater] Auto-check failed: ${err.message}`)
      })
    }, 5000)
  }
}
