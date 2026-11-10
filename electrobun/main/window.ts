import { app, DesktopWindow, rpcRegistry } from "../platform/desktop"
import { readStartupTheme } from "./startup-theme"
import { setMainWindow, logRuntime, initRuntimePaths, sendToRenderer } from "./runtime"
import { applyPendingInstancesMove } from "./paths"
import { initDatabase } from "../db"
import { refreshAuthServersInBackground } from "./authlib"
import { cleanupOrphanGameSessions } from "./stats"
import { loadInstancesRoot } from "./builds/helpers"
import { migrateIntentDirNames } from "./builds/dir-migration"
import { launcherOperations } from "../platform/operation-gate"
import { cli } from "./cli"

let finishStartup: (error: string | null) => void
const startupReady = new Promise<string | null>(resolve => { finishStartup = resolve })
export function createWindow() {
  const win = new DesktopWindow({
    width: 1280,
    height: 800,
    launcher: true,
    startupTheme: readStartupTheme(),
  })
  setMainWindow(win)
  cli.attach(() => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }, () => sendToRenderer("startup:launch-pending", null))
  win.on("closed", () => {
    cli.detach(win.viewSession.id)
    setMainWindow(null)
  })
  return win
}

export function registerWindowLifecycle() {
  rpcRegistry.handle("startup:ready", () => startupReady)
  rpcRegistry.handle("startup:launch-build", ({ sender }, action) => {
    if (!action) return cli.peek()
    if (action.kind === "claim") return cli.claim(action.id, sender.id)
    if (action.kind === "finish") cli.finish(action.id, sender.id, action.error)
    return null
  })

  void Promise.resolve().then(startLauncher).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    logRuntime(`[App] startup failed: ${message}`)
    cli.close(message)
    finishStartup(message)
  })

  app.on("window-all-closed", () => {
    logRuntime("[App] window-all-closed")
    if (process.platform !== "darwin") app.quit()
  })
  app.on("will-quit", () => cli.close("Primary launcher is closing."))
}

async function startLauncher() {
  // Один документ: HTML показывает splash, renderer ждёт startup:ready.
  createWindow()
  await initDatabase()
  applyPendingInstancesMove()
  await initRuntimePaths()
  logRuntime("[App] database initialized")
  void import("./remote-servers/index.js").then(({ startRemoteServerHosts }) => {
    const refresh = () => {
      if (!launcherOperations.blocked) void launcherOperations.run(startRemoteServerHosts)
    }
    refresh()
    const timer = setInterval(refresh, 15000)
    timer.unref()
  }).catch((error: unknown) => {
    logRuntime(`[Remote servers] Could not initialize hosts: ${error instanceof Error ? error.message : String(error)}`)
  })
  void launcherOperations.run(refreshAuthServersInBackground).catch(error => logRuntime(`[Authlib] ${String(error)}`))

  // Каталог инстансов нужен миграции: она переименовывает папки сборок,
  // созданные старым (слишком строгим) правилом санитайзера имён.
  await loadInstancesRoot().catch(() => {})
  const renamedIntentDirs = await migrateIntentDirNames().catch(() => 0)
  if (renamedIntentDirs > 0) {
    logRuntime(`[App] intent dirs migrated: ${renamedIntentDirs}`)
  }

  // Уборка осиротевшей статистики: сборок нет в БД, но сборки из корзины
  // восстановимы — их сессии защищены снапшотами до очистки корзины.
  try {
    const removedSessions = await cleanupOrphanGameSessions()
    if (removedSessions > 0) logRuntime(`[DB] Очищено записей статистики удалённых сборок: ${removedSessions}`)
  } catch (error) {
    logRuntime(`[DB] Не удалось очистить статистику удалённых сборок: ${error instanceof Error ? error.message : String(error)}`)
  }

  finishStartup(null)

  app.on("reopen", () => {
    if (DesktopWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}
