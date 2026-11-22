import packageJson from "../../package.json"
import { spawn } from "node:child_process"
import Electrobun from "electrobun/main"
import { app, rpcRegistry } from "../platform/desktop"
import { launcherOperations, withinDeadline } from "../platform/operation-gate"
import { closeDatabaseForUpdate } from "../db/core"
import { initDatabase } from "../db"
import { isPortable } from "./profile-path"
import { expectedUpdateBaseUrl } from "./update-public-keys"
import { installedPreference, releaseChannelOf, resolveVerifiedUpdate, type PackageChannel, type VerifiedUpdate } from "./verified-update-feed"
import { downloadChannelInstaller } from "./channel-switch"
import { stopMcpConnections } from "./agent-mcp"
import { xnConnectManager } from "./xn-connect-manager"
import { isLaunchActive } from "./minecraft-core"
import { sendToRenderer } from "./runtime"
import { launcherShutdown } from "../platform/shutdown"
import { launcherUpdateState } from "./update-state"
import { readWindowsUpdateIdentity, type WindowsUpdateIdentity } from "./windows-update-identity"

/**
 * Windows обновляется только собственным подписанным каналом: проверка
 * Ed25519-манифеста, SHA-256 установщика и запуск NSIS. Нативное ядро
 * Electrobun здесь не используется — оно требует каталог
 * `%LOCALAPPDATA%\org.xneon.launcher\<channel>`, а путь установки остаётся
 * `%LOCALAPPDATA%\Programs\xneon-launcher`.
 */

/** Фактически установленный канал не меняется до установки скачанной сборки. */
function packagedChannel(): PackageChannel {
  return releaseChannelOf(packageJson.version)
}

/** Установленная сборка должна быть подписанным Windows-пакетом своего канала. */
async function requireInstalledPackage(): Promise<WindowsUpdateIdentity> {
  const local = await readWindowsUpdateIdentity()
  if (!local || process.platform !== "win32" || process.arch !== "x64" || local.baseUrl !== expectedUpdateBaseUrl(local.channel)) {
    throw new Error("unsupported-package")
  }
  return local
}

let available: VerifiedUpdate | null = null
let checking = false
let downloaded = false
let downloading = false
let installing = false
let nativeQuitAllowed = false
let cancellation: AbortController | undefined
let switching = false

function updateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  sendToRenderer("update:status", { status: "error", error: message })
  return message
}

export function registerUpdater() {
  rpcRegistry.handle("update:get-channel", async () => installedPreference(await launcherUpdateState.getChannel(packagedChannel())))

  rpcRegistry.handle("update:get-state", async () => {
    if (isPortable) return { status: "idle" as const, deferred: false }
    if (downloading) return { status: "downloading" as const, deferred: false }
    if (installing) return { status: "preparing" as const, deferred: false }
    const local = await readWindowsUpdateIdentity()
    if (!local) {
      downloaded = false
      return { status: "idle" as const, deferred: false }
    }
    const pending = await launcherUpdateState.peek(local)
    downloaded = !!pending
    return pending ? { status: "downloaded" as const, version: pending.update.manifest.version, deferred: pending.deferred }
      : { status: "idle" as const, deferred: false }
  })

  rpcRegistry.handle("update:set-channel", async (_event, channel: "stable" | "beta") => {
    if (channel !== "stable" && channel !== "beta") throw new Error("unknown-channel")
    if (checking || downloading || installing || switching) throw new Error("update-in-progress")
    const target: PackageChannel = channel === "beta" ? "canary" : "stable"
    if (isPortable) return { state: "error" as const, error: "portable-manual-update" }
    switching = true
    try {
      if (target === await launcherUpdateState.getChannel(packagedChannel())) return { state: "current" as const }
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

  rpcRegistry.handle("update:check", async () => {
    if (checking || downloading || installing || switching || isLaunchActive()) {
      return { available: false, error: "check-unavailable" }
    }
    checking = true
    available = null
    downloaded = false
    try {
      const local = await requireInstalledPackage()
      const channel = await launcherUpdateState.getChannel(local.channel)
      sendToRenderer("update:status", { status: "checking" })
      // При смене канала версии не сравниваются: допустим и переход назад.
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
    if (!update || checking || downloading || installing || switching || isLaunchActive()) {
      return { success: false, error: "download-unavailable" }
    }
    downloading = true
    downloaded = false
    try {
      const local = await requireInstalledPackage()
      sendToRenderer("update:status", { status: "downloading" })
      // Смена канала начинается с явного нуля, до первого байта установщика.
      if (update.manifest.channel !== local.channel) sendToRenderer("update:progress", { percent: 0, transferred: 0, total: 0 })
      // Установщик качается заново по подписанному манифесту: имя, размер и
      // SHA-256 сверяются до запуска, 100% отправляется только после проверки.
      const installer = await downloadChannelInstaller(update.manifest.channel,
        progress => sendToRenderer("update:progress", progress),
        { version: update.manifest.version, hash: update.manifest.hash })
      await launcherUpdateState.stage(local, update, installer.path)
      downloaded = true
      sendToRenderer("update:status", { status: "downloaded", version: update.manifest.version })
      return { success: true }
    } catch (error) {
      return { success: false, error: updateError(error) }
    } finally { downloading = false }
  })

  rpcRegistry.handle("update:defer", async () => {
    if (!downloaded || checking || downloading || installing || switching) return { success: false, error: "update-unavailable" }
    try {
      await launcherUpdateState.defer(await requireInstalledPackage())
      return { success: true }
    } catch (error) { return { success: false, error: updateError(error) } }
  })

  rpcRegistry.handle("update:install", async () => {
    if (installing) return
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
      // peek повторно проверяет подпись манифеста и SHA-256 установщика.
      const pending = await launcherUpdateState.peek(await requireInstalledPackage())
      if (!pending) throw new Error("update-not-prepared")
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
      const child = spawn(pending.path, ["/S", "--force-run"], { detached: true, stdio: "ignore" })
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
      child.unref()
      await launcherUpdateState.clearPending()
      await launcherShutdown.run("update")
    } catch (error) {
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