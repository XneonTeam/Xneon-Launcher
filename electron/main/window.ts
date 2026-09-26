import { app, BrowserWindow, ipcMain, Menu, shell } from "electron"
import path from "path"
import { isDev, setMainWindow, getMainWindow, logRuntime, logRuntimeDebug, initRuntimePaths, sendToRenderer } from "./runtime"
import { initDatabase } from "../db"
import { cleanupOrphanGameSessions } from "./stats"
import { loadInstancesRoot } from "./builds/helpers"
import { migrateIntentDirNames } from "./builds/dir-migration"

export function createWindow() {
  logRuntime("[Window] Creating browser window")
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: "#141420",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
      // Нужен читалке новостей: статья открывается модалом внутри окна лаунчера
      // (`<webview>`), а не отдельным окном или системным браузером.
      webviewTag: true,
    },
  })

  setMainWindow(win)

  if (isDev) {
    logRuntimeDebug("[Window] Loading dev URL http://localhost:5173")
    void win.loadURL("http://localhost:5173")
  } else {
    logRuntimeDebug("[Window] Loading packaged dist/index.html")
    void win.loadFile(path.join(__dirname, "../../dist/index.html"))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Some content (e.g. CurseForge changelogs) renders plain <a href> without a
  // target, which would navigate the app window itself — including to broken
  // relative "linkout" URLs. Redirect any off-app navigation to the browser.
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL()
    try {
      if (new URL(url).origin === new URL(current).origin) return
    } catch {
      // Fall through and treat malformed URLs as external.
    }
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  win.once("ready-to-show", () => {
    logRuntime("[Window] ready-to-show")
    getMainWindow()?.show()
  })

  win.webContents.on("did-finish-load", () => {
    logRuntimeDebug("[Window] did-finish-load")
  })

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logRuntime(`[Window] did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`)
  })

  win.webContents.on("render-process-gone", (_event, details) => {
    logRuntime(`[Window] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })

  win.webContents.on("unresponsive", () => {
    logRuntime("[Window] webContents unresponsive")
  })



  win.on("closed", () => {
    logRuntime("[Window] closed")
    setMainWindow(null)
  })
}

export function registerWindowLifecycle() {
  // Suppress Chromium GPU disk cache errors (cache folder access denied in dev)
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache")

  // Гостевая страница читалки новостей — чужой документ, свои `::-webkit-scrollbar`
  // мы внедряем в него сами. На Windows Chromium 121+ рисует нативные
  // «Fluent»-скроллбары, а в режиме наложения (overlay) они игнорируют
  // кастомные стили — отключаем их, чтобы скроллбар в читалке выглядел
  // так же, как во всём лаунчере.
  app.commandLine.appendSwitch("disable-features", "FluentScrollbar,FluentOverlayScrollbars")

  ipcMain.handle("window:is-maximized", () => getMainWindow()?.isMaximized() ?? false)

  ipcMain.on("window:minimize", () => getMainWindow()?.minimize())

  ipcMain.on("window:restore", () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  ipcMain.on("window:maximize", () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on("window:close", () => getMainWindow()?.close())

  app.whenReady().then(async () => {
    logRuntime("[App] whenReady")

    Menu.setApplicationMenu(null)
    createWindow()

    const [,] = await Promise.all([
      initRuntimePaths(),
      initDatabase().then(() => {
        logRuntime("[App] database initialized")
      }).catch((error) => {
        logRuntime(`[App] database init failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      }),
    ])

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

    // CLI: --launch <buildName> (e.g. from a desktop shortcut) triggers a build launch in the renderer.
    const launchArgIndex = process.argv.indexOf("--launch")
    const cliLaunchBuild = launchArgIndex !== -1 && process.argv[launchArgIndex + 1] ? process.argv[launchArgIndex + 1] : undefined
    if (cliLaunchBuild) {
      getMainWindow()?.webContents.once("did-finish-load", () => {
        logRuntime(`[Window] CLI launch requested: ${cliLaunchBuild}`)
        sendToRenderer("cli:launch-build", cliLaunchBuild)
      })
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on("window-all-closed", () => {
    logRuntime("[App] window-all-closed")
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.on("render-process-gone", (_event, _webContents, details) => {
    logRuntime(`[App] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })

  app.on("child-process-gone", (_event, details) => {
    logRuntime(`[App] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode ?? 0}`)
  })
}
