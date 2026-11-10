import Electrobun from "electrobun/main"
import { unlockLauncherProfile } from "./instance-lock"
import { BrowserView, BrowserWindow as NativeWindow, BuildConfig, Screen, Utils } from "electrobun/main"
import { EventEmitter } from "node:events"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { assetBase } from "./assets"
import { invokeHandler, ViewSession } from "./ipc"
import type { LauncherRPC } from "./schema"
import { stageFile } from "./staged-files"
import packageJson from "../../package.json"
import { enableWindowsWindowTransitions, saveFile, setWindowsAppUserModelId, setWindowsTaskbarIdentity, setWindowsWindowIcons } from "./windows-native"
import { launcherOperations } from "./operation-gate"

export { rpcRegistry, type RpcContext } from "./ipc"
export { net, protocol } from "./assets"
export { nativeImage } from "./image"
export { safeStorage } from "./windows-native"

const paths: Record<string, string> = {
  home: os.homedir(),
  appData: process.env.APPDATA || path.join(os.homedir(), ".config"),
  temp: os.tmpdir(),
}
const build = BuildConfig.getSync()
const appUserModelId = build.runtime?.appUserModelId
if (build.isPackaged && typeof appUserModelId === "string") setWindowsAppUserModelId(appUserModelId)

const events = new EventEmitter()
let quitting = false
let restartPending = false
export const app = Object.assign(events, {
  isPackaged: build.isPackaged,
  getVersion: () => packageJson.version,
  getPath(name: string) {
    if (!paths[name]) throw new Error("Unsupported application path: " + name)
    return paths[name]
  },
  setPath(name: string, value: string) { paths[name] = value },
  quit() {
    if (quitting || launcherOperations.blocked) return
    let cancelled = false
    events.emit("before-quit", { preventDefault() { cancelled = true } })
    if (cancelled) return
    quitting = true
    events.emit("will-quit")
    if (restartPending) {
      unlockLauncherProfile()
      const launcher = path.join(path.dirname(process.execPath), process.platform === "win32" ? "launcher.exe" : "launcher")
      const child = spawn(launcher, process.argv.slice(2), { cwd: path.dirname(launcher), detached: true, stdio: "ignore", windowsHide: true })
      child.on("error", error => console.error("[Desktop] Restart failed", error))
      child.unref()
    }
    Utils.quit()
  },
  exit: (status = 0) => process.exit(status),
  relaunch() { restartPending = true },
})
Electrobun.events.on("reopen", () => app.emit("reopen"))

const windows = new Map<number, DesktopWindow>()
type WindowOptions = { width: number; height: number; show?: boolean; launcher?: boolean; startupTheme?: string | null }

export class DesktopWindow extends EventEmitter {
  private readonly native: NativeWindow
  private clearTaskbarIdentity?: () => void
  readonly viewSession: ViewSession
  private currentUrl: string

  constructor(options: WindowOptions) {
    super()
    const launcherUrl = "views://launcher/index.html"
    const rpc = options.launcher ? BrowserView.defineRPC<LauncherRPC>({
      handlers: {
        requests: {
          invoke: request => invokeHandler(this.viewSession, request),
          stageFile: ({ name, encoded }) => launcherOperations.run(() => stageFile(name, encoded)),
          bootstrap: () => ({ assetBase: assetBase() }),
        },
        messages: {
          windowControl: ({ action }) => {
            switch (action) {
              case "minimize": this.minimize(); break
              case "maximize":
                if (this.isMaximized()) this.unmaximize()
                else this.maximize()
                break
              case "restore":
                if (this.isMinimized()) this.restore()
                this.show()
                this.focus()
                break
              case "close": this.close(); break
            }
          },
        },
      },
    }) : undefined
    this.currentUrl = options.launcher ? launcherUrl : "about:blank"
    const title = "Xneon Launcher"
    const windowsLauncher = process.platform === "win32" && options.launcher
    this.native = new NativeWindow({
      title,
      frame: { width: options.width, height: options.height },
      renderer: "native",
      titleBarStyle: windowsLauncher ? "hiddenInset" : options.launcher ? "hidden" : "default",
      hidden: windowsLauncher || options.show === false,
      url: this.currentUrl,
      sandbox: !options.launcher,
      allowedProtocols: { views: Boolean(options.launcher), appData: false },
      navigationRules: options.launcher ? JSON.stringify([launcherUrl]) : undefined,
      preload: options.launcher
        ? "window.xneonStartupTheme = " + JSON.stringify(options.startupTheme ?? null)
        : undefined,
      rpc,
    })
    const windowHandle = windowsLauncher ? this.native.ptr : null
    let releaseWindowIcons: (() => void) | undefined
    if (windowHandle) {
      try {
        enableWindowsWindowTransitions(windowHandle)
      } catch (error) {
        console.warn("[Desktop] Could not enable Windows window transitions:", error)
      }
    }
    if (windowHandle && process.platform === "win32") {
      try {
        releaseWindowIcons = setWindowsWindowIcons(windowHandle)
      } catch (error) {
        console.warn("[Desktop] Could not set Windows window icons:", error)
      }
      try {
        if (build.isPackaged && typeof appUserModelId === "string") {
          this.clearTaskbarIdentity = setWindowsTaskbarIdentity(windowHandle, appUserModelId, title)
        }
      } catch (error) {
        console.warn("[Desktop] Could not set Windows taskbar properties:", error)
      }
    }
    this.viewSession = new ViewSession(this.native.webview.id, event => rpc?.send.launcherEvent(event))
    windows.set(this.viewSession.id, this)
    this.native.on("close", () => {
      releaseWindowIcons?.()
      windows.delete(this.viewSession.id)
      this.viewSession.destroy()
      this.emit("closed")
      if (windows.size === 0) app.emit("window-all-closed")
    })
    const forwardNavigation = (event: unknown, channel: string) => {
      const data = (event as { data: unknown }).data
      const url = typeof data === "string" ? data : (data as { detail?: string } | null)?.detail
      if (!url) return
      this.currentUrl = url
      this.viewSession.emit(channel, {}, url)
    }
    if (!options.launcher) this.native.webview.on("will-navigate", event => forwardNavigation(event, "will-navigate"))
    this.native.webview.on("did-navigate", event => forwardNavigation(event, "did-navigate"))
    this.native.webview.on("did-navigate-in-page", event => forwardNavigation(event, "did-navigate-in-page"))
    if (windowsLauncher && options.show !== false) this.native.show()
  }

  static getAllWindows() { return [...windows.values()] }
  isDestroyed() { return this.viewSession.isDestroyed() }
  async loadURL(url: string) { this.native.webview.loadURL(url) }
  show() { this.native.show() }
  focus() { this.native.focus() }
  close() {
    if (this.isDestroyed()) return
    try {
      this.clearTaskbarIdentity?.()
    } catch (error) {
      console.warn("[Desktop] Could not clear Windows taskbar properties:", error)
    }
    this.clearTaskbarIdentity = undefined
    this.native.close()
  }
  minimize() { this.native.minimize() }
  maximize() { this.native.maximize() }
  unmaximize() { this.native.unmaximize() }
  restore() { this.native.unminimize() }
  isMinimized() { return this.native.isMinimized() }
  isMaximized() { return this.native.isMaximized() }
}

export const viewSession = { fromId: (id: number) => windows.get(id)?.viewSession }
export const screen = {
  getPrimaryDisplay: () => Screen.getPrimaryDisplay(),
  getAllDisplays: () => Screen.getAllDisplays().map(display => ({
    ...display, size: display.bounds, displayFrequency: 0,
  })),
}
export const shell = {
  async openExternal(url: string) {
    if (!["https:", "http:", "mailto:"].includes(new URL(url).protocol) || !Utils.openExternal(url)) {
      throw new Error("Could not open external URL")
    }
  },
  async openPath(file: string) { return Utils.openPath(file) ? "" : "Could not open path" },
  showItemInFolder: Utils.showItemInFolder,
}

type DialogOptions = { properties?: string[]; defaultPath?: string; title?: string; filters?: { name: string; extensions: string[] }[] }
export const dialog = {
  async showOpenDialog(_window: DesktopWindow, options: DialogOptions) {
    const directory = Boolean(options.properties?.includes("openDirectory"))
    const filePaths = await Utils.openFileDialog({
      startingFolder: options.defaultPath ?? os.homedir(),
      canChooseFiles: !directory,
      canChooseDirectory: directory,
      allowsMultipleSelection: Boolean(options.properties?.includes("multiSelections")),
      allowedFileTypes: options.filters?.flatMap(filter => filter.extensions).join(",") || "*",
    })
    return { canceled: filePaths.length === 0, filePaths }
  },
  showSaveDialog(_window: DesktopWindow, options: DialogOptions) {
    return saveFile(options.defaultPath, options.filters)
  },
}
export const clipboard = {
  async read() {
    const image = Utils.clipboardReadImage()
    return image ? [{ types: ["image/png"], getType: async (_type: string) => new Blob([new Uint8Array(image)]) }] : []
  },
}
