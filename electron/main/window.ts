import { app, BrowserWindow, ipcMain, Menu, shell } from "electron"
import path from "path"
import { isDev, setMainWindow, getMainWindow, logRuntime, logRuntimeDebug, initRuntimePaths, sendToRenderer } from "./runtime"
import { initDatabase } from "../db"
import { loadInstancesRoot } from "./builds/helpers"

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

  ipcMain.handle("window:is-maximized", () => getMainWindow()?.isMaximized() ?? false)

  ipcMain.on("window:minimize", () => getMainWindow()?.minimize())

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
    // Initialize runtime paths lazily, not at module load time
    await initRuntimePaths()
    try {
      await initDatabase()
      logRuntime("[App] database initialized")
    } catch (error) {
      logRuntime(`[App] database init failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    }
    try {
      await loadInstancesRoot()
    } catch {}
    Menu.setApplicationMenu(null)
    createWindow()

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
