import type { UnixHealthIdentity } from "./unix-update-health"
import type { UnixInstallation } from "./unix-update-installation"
import type { UnixUpdateStateStore, PendingUnixUpdate } from "./unix-update-state"
import type { VerifiedUnixUpdate } from "./unix-update-feed"
import { unixUpdateErrorCode } from "./unix-update-errors"

export type UnixUpdateContext = { local: UnixHealthIdentity; installation: UnixInstallation }
export type UnixControllerPorts = {
  context: () => Promise<UnixUpdateContext>
  store: Pick<UnixUpdateStateStore, "getChannel" | "selectChannel" | "peek" | "stage" | "defer">
  resolve: (context: UnixUpdateContext, channel: "stable" | "canary", signal: AbortSignal) => Promise<VerifiedUnixUpdate | null>
  download: (context: UnixUpdateContext, update: VerifiedUnixUpdate, signal: AbortSignal) => Promise<string>
  cleanupDownload?: (file: string) => Promise<void>
  handoff: (context: UnixUpdateContext, pending: PendingUnixUpdate, signal: AbortSignal) => Promise<{ cancel: () => Promise<void> }>
  drain: () => Promise<unknown>; cleanup: () => Promise<void>; closeDatabase: () => void
  reopen: (databaseClosed: boolean) => Promise<void>; quit: () => Promise<unknown>; block: (blocked: boolean) => void
  activeLaunch: () => boolean
  send: (status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "preparing" | "error", version?: string, error?: string) => void
}

/** Существующие IPC управляют main-контроллером, а не произвольными командами helper из renderer. */
export function createUnixUpdateController(ports: UnixControllerPorts) {
  let available: VerifiedUnixUpdate | null = null, busy: "check" | "download" | "install" | "channel" | null = null, exiting = false
  let cancellation: AbortController | undefined
  const errorMessage = (error: unknown) => { const message = unixUpdateErrorCode(error); console.error("[Unix updater]", error); ports.send("error", undefined, message); return message }
  const controller = {
    async getChannel() {
      const { local } = await ports.context()
      return await ports.store.getChannel(local.channel) === "canary" ? "beta" as const : "stable" as const
    },
    async setChannel(channel: "stable" | "beta") {
      if (channel !== "stable" && channel !== "beta") throw new Error("unknown-channel")
      if (busy || exiting) throw new Error("update-in-progress")
      busy = "channel"
      try {
        const { local } = await ports.context(), target = channel === "beta" ? "canary" : "stable"
        if (await ports.store.getChannel(local.channel) === target) return { state: "current" as const }
        await ports.store.selectChannel(target); available = null; ports.send("idle")
        return { state: "selected" as const }
      } catch (error) { return { state: "error" as const, error: errorMessage(error) } } finally { busy = null }
    },
    async getState() {
      if (busy === "install") return { status: "preparing" as const, deferred: false }
      if (busy === "download") return { status: "downloading" as const, deferred: false }
      const { local, installation } = await ports.context(), pending = await ports.store.peek(local, installation)
      return pending ? { status: "downloaded" as const, version: pending.update.manifest.version, deferred: pending.deferred } : { status: "idle" as const, deferred: false }
    },
    async check() {
      if (busy || exiting || ports.activeLaunch()) return { available: false, error: "check-unavailable" }
      busy = "check"; available = null; cancellation = new AbortController()
      try {
        ports.send("checking")
        const context = await ports.context(), channel = await ports.store.getChannel(context.local.channel)
        available = await ports.resolve(context, channel, cancellation.signal)
        ports.send(available ? "available" : "not-available", available?.manifest.version)
        return { available: !!available, version: available?.manifest.version }
      } catch (error) { return { available: false, error: errorMessage(error) } } finally { busy = null; cancellation = undefined }
    },
    async download() {
      if (!available || busy || exiting || ports.activeLaunch()) return { success: false, error: "download-unavailable" }
      busy = "download"; cancellation = new AbortController()
      try {
        ports.send("downloading")
        const context = await ports.context()
        const file = await ports.download(context, available, cancellation.signal)
        try { await ports.store.stage(context.local, context.installation, available, file) }
        finally { await ports.cleanupDownload?.(file) }
        ports.send("downloaded", available.manifest.version)
        return { success: true }
      } catch (error) { return { success: false, error: errorMessage(error) } } finally { busy = null; cancellation = undefined }
    },
    async defer() {
      if (busy || exiting) return { success: false, error: "update-in-progress" }
      try {
        const { local, installation } = await ports.context()
        await ports.store.defer(local, installation)
        return { success: true }
      } catch (error) { return { success: false, error: errorMessage(error) } }
    },
    async install() {
      if (busy || exiting) { errorMessage(new Error("update-in-progress")); return }
      if (ports.activeLaunch()) { errorMessage(new Error("minecraft-running")); return }
      busy = "install"; cancellation = new AbortController(); ports.block(true)
      let handoff: Awaited<ReturnType<UnixControllerPorts["handoff"]>> | undefined, closed = false
      try {
        ports.send("preparing")
        await ports.drain(); cancellation.signal.throwIfAborted()
        if (ports.activeLaunch()) throw new Error("minecraft-running")
        const context = await ports.context(), pending = await ports.store.peek(context.local, context.installation)
        if (!pending) throw new Error("update-not-prepared")
        handoff = await ports.handoff(context, pending, cancellation.signal)
        await ports.cleanup(); cancellation.signal.throwIfAborted()
        ports.closeDatabase(); closed = true
        cancellation = undefined; exiting = true
        await ports.quit()
      } catch (error) {
        // Не открываем A поверх работы helper, если его отмену не удалось подтвердить.
        if (handoff) await handoff.cancel()
        exiting = false
        await ports.reopen(closed)
        ports.block(false); errorMessage(error)
      } finally { busy = null; cancellation = undefined }
    },
    cancel() { if (!cancellation) return false; cancellation.abort(new Error("restart-cancelled")); return true },
  }
  return controller
}
