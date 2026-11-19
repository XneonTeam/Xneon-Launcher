import packageJson from "../../package.json"
import { spawn } from "node:child_process"
import Electrobun, { Updater } from "electrobun/main"
import { app, rpcRegistry } from "../platform/desktop"
import { launcherOperations, withinDeadline } from "../platform/operation-gate"
import { closeDatabaseForUpdate } from "../db/core"
import { initDatabase } from "../db"
import { isPortable } from "./profile-path"
import { expectedUpdateBaseUrl } from "./update-public-keys"
import { installedPreference, resolveVerifiedUpdate, type PackageChannel, type VerifiedUpdate } from "./verified-update-feed"
import { downloadChannelInstaller } from "./channel-switch"
import { stopMcpConnections } from "./agent-mcp"
import { xnConnectManager } from "./xn-connect-manager"
import { isLaunchActive } from "./minecraft-core"
import { sendToRenderer } from "./runtime"
import { launcherShutdown } from "../platform/shutdown"
import { launcherUpdateState } from "./update-state"

/** Фактически установленный канал не меняется до применения скачанной сборки. */
function installedChannel(): PackageChannel {
  return /-(?:pre|beta)\d+$/.test(packageJson.version) ? "canary" : "stable"
}

let available: VerifiedUpdate | null = null
let checking = false
let downloaded = false
let downloading = false
let installing = false
let restartRequested = false
let nativeQuitAllowed = false
let cancellation: AbortController | undefined
let switching = false

function updateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  sendToRenderer("update:status", { status: "error", error: message })
  return message
}

export function registerUpdater() {
  rpcRegistry.handle("update:get-channel", async () => installedPreference(await launcherUpdateState.getChannel(installedChannel())))

  rpcRegistry.handle("update:get-state", async () => {
    if (isPortable) return { status: "idle" as const, deferred: false }
    if (downloading) return { status: "downloading" as const, deferred: false }
    if (installing) return { status: "preparing" as const, deferred: false }
    const local = await Updater.getLocalInfo()
    if (local.channel !== "stable" && local.channel !== "canary") return { status: "idle" as const, deferred: false }
    const pending = await launcherUpdateState.peek({ ...local, channel: local.channel }, () => Updater.appDataFolder())
    downloaded = !!pending
    return pending ? { status: "downloaded" as const, version: pending.update.manifest.version, deferred: pending.deferred }
      : { status: "idle" as const, deferred: false }
  })

  rpcRegistry.handle("update:set-channel", async (_event, channel: "stable" | "beta") => {
    if (channel !== "stable" && channel !== "beta") throw new Error("unknown-channel")
    if (checking || downloading || installing || restartRequested || switching) throw new Error("update-in-progress")
    const target: PackageChannel = channel === "beta" ? "canary" : "stable"
    if (isPortable) return { state: "error" as const, error: "portable-manual-update" }
    switching = true
    try {
      if (target === await launcherUpdateState.getChannel(installedChannel())) return { state: "current" as const }
      await launcherUpdateState.selectChannel(target)
      available = null
      downloaded = false
      sendToRenderer("update:status", { status: "idle" })
      return { state: "selected" as const }
    } catch (error) {
      return { state: "error" as const, error: updateError(error) }
    } finally { switching = false }
  })

  if (isPortable) {
    const error = "portable-manual-update"
    rpcRegistry.handle("update:check", () => ({ available: false, error }))
    rpcRegistry.handle("update:download", () => ({ success: false, error }))
    rpcRegistry.handle("update:install", () => { updateError(error) })
    rpcRegistry.handle("update:cancel-install", () => false)
    rpcRegistry.handle("update:defer", () => ({ success: false, error }))
    return
  }

  Electrobun.events.on("before-quit", event => {
    if (launcherOperations.blocked && !nativeQuitAllowed && !launcherShutdown.exiting) event.response = { allow: false }
  })
  Updater.onStatusChange(({ status, details }) => {
    if (status === "launching-new-version" && installing) restartRequested = true
    if (status === "error" && installing) restartRequested = false
    if (downloading || installing) {
      if (status === "download-progress" && details?.progress != null) {
        sendToRenderer("update:progress", { percent: details.progress, transferred: details.bytesDownloaded ?? 0, total: details.totalBytes ?? 0 })
      } else if (["downloading", "downloading-full-bundle", "fetching-patch", "downloading-patch", "extracting", "decompressing", "applying"].includes(status)) {
        sendToRenderer("update:status", { status: "downloading" })
      }
    }
  })

  rpcRegistry.handle("update:check", async () => {
    if (checking || downloading || installing || restartRequested || switching || isLaunchActive()) {
      return { available: false, error: "check-unavailable" }
    }
    checking = true
    available = null
    downloaded = false
    try {
      const local = await Updater.getLocalInfo()
      if (process.platform !== "win32" || process.arch !== "x64" ||
          (local.channel !== "stable" && local.channel !== "canary") || local.version !== packageJson.version ||
          local.baseUrl !== expectedUpdateBaseUrl(local.channel)) {
        throw new Error("unsupported-package")
      }
      const channel = await launcherUpdateState.getChannel(local.channel)
      sendToRenderer("update:status", { status: "checking" })
      available = await resolveVerifiedUpdate(channel === local.channel ? local.version : "0.0.0", channel)
      if (available?.manifest.hash === local.hash) throw new Error("manifest-hash-reused")
      sendToRenderer("update:status", { status: available ? "available" : "not-available", version: available?.manifest.version })
      return { available: !!available, version: available?.manifest.version }
    } catch (error) {
      available = null
      return { available: false, error: updateError(error) }
    } finally { checking = false }
  })

  rpcRegistry.handle("update:download", async () => {
    const update = available
    if (!update || checking || downloading || installing || restartRequested || switching || isLaunchActive()) {
      return { success: false, error: "download-unavailable" }
    }
    downloading = true
    downloaded = false
    try {
      sendToRenderer("update:status", { status: "downloading" })
      const local = await Updater.getLocalInfo()
      if (local.channel !== "stable" && local.channel !== "canary") throw new Error("unsupported-channel")
      if (update.manifest.channel !== local.channel) {
        sendToRenderer("update:progress", { percent: 0, transferred: 0, total: 0 })
        const installer = await downloadChannelInstaller(update.manifest.channel,
          progress => sendToRenderer("update:progress", progress), update.manifest)
        await launcherUpdateState.stage("installer", { ...local, channel: local.channel }, update, installer.path)
        downloaded = true
        sendToRenderer("update:status", { status: "downloaded", version: update.manifest.version })
        return { success: true }
      }
      const checked = await Updater.checkForUpdate()
      if (checked.error || !checked.updateAvailable || checked.hash !== update.manifest.hash) {
        throw new Error(checked.error || "SDK rejected the verified update manifest.")
      }
      await Updater.downloadUpdate()
      const info = Updater.updateInfo()
      if (!info.updateReady || info.hash !== update.manifest.hash || info.version !== update.manifest.version) {
        throw new Error(info.error || "SDK did not prepare the verified update.")
      }
      await launcherUpdateState.stage("sdk", { ...local, channel: local.channel }, update)
      downloaded = true
      sendToRenderer("update:status", { status: "downloaded", version: update.manifest.version })
      return { success: true }
    } catch (error) {
      return { success: false, error: updateError(error) }
    } finally { downloading = false }
  })

  rpcRegistry.handle("update:defer", async () => {
    if (!downloaded || checking || downloading || installing || restartRequested || switching) return { success: false, error: "update-unavailable" }
    try {
      const local = await Updater.getLocalInfo()
      if (local.channel !== "stable" && local.channel !== "canary") throw new Error("unsupported-channel")
      await launcherUpdateState.defer({ ...local, channel: local.channel }, () => Updater.appDataFolder())
      return { success: true }
    } catch (error) { return { success: false, error: updateError(error) } }
  })

  rpcRegistry.handle("update:install", async () => {
    if (installing || restartRequested) return
    if (isLaunchActive()) {
      updateError("minecraft-running")
      return
    }
    if (!downloaded || downloading || checking || switching) {
      updateError("update-unavailable")
      return
    }
    installing = true
    launcherOperations.blocked = true
    const controller = new AbortController()
    cancellation = controller
    let databaseClosed = false
    try {
      sendToRenderer("update:status", { status: "preparing" })
      await launcherOperations.drain(15_000)
      controller.signal.throwIfAborted()
      if (isLaunchActive()) throw new Error("minecraft-running")
      const local = await Updater.getLocalInfo()
      if (local.channel !== "stable" && local.channel !== "canary") throw new Error("unsupported-channel")
      const pending = await launcherUpdateState.peek({ ...local, channel: local.channel }, () => Updater.appDataFolder())
      if (!pending || (pending.kind === "sdk" && !Updater.updateInfo().updateReady)) throw new Error("update-not-prepared")
      await withinDeadline(
        Promise.allSettled([stopMcpConnections(true), xnConnectManager.stopAll()]).then(results => {
          for (const result of results) if (result.status === "rejected") throw result.reason
        }),
        10_000,
        "MCP or relay shutdown timed out.",
      )
      const cleanup = await launcherShutdown.prepare("update")
      if (cleanup.status !== "completed" || cleanup.failed.length || cleanup.timedOut.length) throw new Error("cleanup-failed")
      controller.signal.throwIfAborted()
      closeDatabaseForUpdate()
      databaseClosed = true
      cancellation = undefined
      nativeQuitAllowed = true
      if (pending.kind === "installer") {
        const child = spawn(pending.path!, ["/S", "--force-run"], { detached: true, stdio: "ignore" })
        await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
        child.unref()
        await launcherUpdateState.clearPending()
        await launcherShutdown.run("update")
        return
      }
      await Updater.applyUpdate()
      // SDK может вернуть управление после передачи завершения нативному рантайму.
      if (restartRequested) { await launcherUpdateState.clearPending(); return }
      const info = Updater.updateInfo()
      downloaded = info.updateReady
      throw new Error(info.error || "Update restart did not start.")
    } catch (error) {
      restartRequested = false
      nativeQuitAllowed = false
      if (launcherShutdown.finished) launcherShutdown.resetAfterCancelledUpdate()
      if (databaseClosed) {
        try {
          await initDatabase()
        } catch (recoveryError) {
          updateError(`Update failed and the database could not be reopened: ${String(recoveryError)}`)
          return
        }
      }
      launcherOperations.blocked = false
      app.emit("reopen")
      updateError(error)
    } finally {
      cancellation = undefined
      installing = false
    }
  })

  rpcRegistry.handle("update:cancel-install", () => {
    if (!cancellation) return false
    cancellation.abort(new Error("restart-cancelled"))
    return true
  })
}
