import path from "node:path"
import { rm } from "node:fs/promises"
import Electrobun from "electrobun/main"
import { app, rpcRegistry } from "../platform/desktop"
import { bundledWorker } from "../platform/resources"
import { launcherOperations, withinDeadline } from "../platform/operation-gate"
import { launcherShutdown } from "../platform/shutdown"
import { closeDatabaseForUpdate } from "../db/core"
import { initDatabase } from "../db"
import { createUnixUpdateController } from "./unix-update-controller"
import { readUnixUpdateContext, unixUpdateStore, unixUpdateProfile, unixUpdateJob } from "./unix-update-context"
import { resolveVerifiedUnixUpdate } from "./unix-update-feed"
import { downloadUnixUpdateFile } from "./unix-update-download"
import { selectUnixUpdateArtifact } from "./unix-update-installation"
import { prepareUnixUpdateHandoff } from "./unix-update-handoff"
import { isLaunchActive } from "./minecraft-core"
import { sendToRenderer } from "./runtime"
import { stopMcpConnections } from "./agent-mcp"
import { xnConnectManager } from "./xn-connect-manager"

export function registerUnixUpdater() {
  let allowQuit = false
  Electrobun.events.on("before-quit", event => {
    if (launcherOperations.blocked && !allowQuit && !launcherShutdown.exiting) event.response = { allow: false }
  })
  const controller = (async () => createUnixUpdateController({
    context: readUnixUpdateContext, store: await unixUpdateStore(),
    resolve: ({ local }, channel, signal) => resolveVerifiedUnixUpdate(local, local.platform === "macos" ? { platform: "macos", arch: "arm64", channel } : { platform: "linux", arch: "x64", channel }, { signal, allowChannelSwitch: channel !== local.channel }),
    download: async (context, update, signal) => (await downloadUnixUpdateFile(update.baseUrl, selectUnixUpdateArtifact(context.installation, update.manifest), path.join(await unixUpdateProfile(), "system-cache/unix-update-downloads"), {
      signal, onProgress: progress => sendToRenderer("update:progress", progress),
    })).path,
    cleanupDownload: file => rm(path.dirname(file), { recursive: true, force: true }),
    handoff: async (context, pending, signal) => prepareUnixUpdateHandoff(await unixUpdateJob(context, pending), bundledWorker("unix-update-helper"), signal),
    drain: () => launcherOperations.drain(15_000),
    cleanup: async () => {
      await withinDeadline(Promise.all([stopMcpConnections(true), xnConnectManager.stopAll()]), 10_000, "cleanup-failed")
      const result = await launcherShutdown.prepare("update")
      if (result.status !== "completed" || result.failed.length || result.timedOut.length) throw new Error("cleanup-failed")
    },
    closeDatabase: closeDatabaseForUpdate,
    reopen: async closed => { allowQuit = false; if (launcherShutdown.finished) launcherShutdown.resetAfterCancelledUpdate(); if (closed) await initDatabase(); app.emit("reopen") },
    quit: async () => { allowQuit = true; await launcherShutdown.run("update") },
    block: value => { launcherOperations.blocked = value }, activeLaunch: isLaunchActive,
    send: (status, version, error) => sendToRenderer("update:status", { status, version, error }),
  }))()
  // Ошибка dev/unmanaged context возвращается через операции, без unhandled rejection при регистрации.
  void controller.catch(() => {})
  rpcRegistry.handle("update:get-channel", async () => (await controller).getChannel())
  rpcRegistry.handle("update:get-state", async () => (await controller).getState())
  rpcRegistry.handle("update:set-channel", async (_event, channel) => (await controller).setChannel(channel))
  rpcRegistry.handle("update:check", async () => (await controller).check())
  rpcRegistry.handle("update:download", async () => (await controller).download())
  rpcRegistry.handle("update:defer", async () => (await controller).defer())
  rpcRegistry.handle("update:install", async () => (await controller).install())
  rpcRegistry.handle("update:cancel-install", async () => (await controller).cancel())
}
