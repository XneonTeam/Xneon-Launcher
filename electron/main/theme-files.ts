import { app, dialog, ipcMain, net, protocol, shell } from "electron"
import { watch, type FSWatcher } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { getMainWindow, sendToRenderer } from "./runtime.js"
import { ThemeLibrary, THEME_MEDIA_TYPES } from "./theme-library.js"
import { createThemeBundle, restoreThemeBundle } from "./cloud/theme-bundle.js"
import type { Theme } from "@xnlc/types"

const MAX_ASSET = 128 * 1024 * 1024
const mediaTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  css: THEME_MEDIA_TYPES.css,
}
const kinds = { image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"], video: ["mp4", "webm", "ogv"], font: ["ttf", "otf", "woff", "woff2"] }
const directory = () => path.join(app.getPath("userData"), "theme-media")
const allowedName = (name: string) => /^[a-f0-9]{64}\.[a-z0-9]+$/.test(name) && !!mediaTypes[name.split(".").at(-1) ?? ""]

export function registerThemeFiles() {
  const library = new ThemeLibrary(path.join(app.getPath("userData"), "themes"), directory())
  let watcher: FSWatcher | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const refresh = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!disposed) void library.snapshot().then(snapshot => { if (!disposed) sendToRenderer("theme:local-changed", snapshot) }).catch(error => console.error("[Themes] Refresh failed", error))
    }, 250)
  }
  ipcMain.handle("theme:local-list", () => library.snapshot())
  ipcMain.handle("theme:local-save", (_event, theme: Theme, css: string) => library.save(theme, css))
  ipcMain.handle("theme:local-delete", (_event, fileName: string) => library.remove(fileName))
  ipcMain.handle("theme:open-directory", async () => {
    await fs.mkdir(library.directory, { recursive: true })
    const error = await shell.openPath(library.directory)
    if (error) throw new Error(error)
    return library.directory
  })
  ipcMain.handle("theme:local-import", async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Xneon Theme", extensions: ["xntheme"] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    if (path.extname(file).toLowerCase() !== ".xntheme" || (await fs.stat(file)).size > 512 * 1024 * 1024) throw new Error("Unsupported or oversized theme archive")
    return { kind: "bundle", theme: await restoreThemeBundle(await fs.readFile(file), directory()) }
  })
  ipcMain.handle("theme:local-export", async (_event, theme: Theme, format: "xntheme") => {
    if (!theme || typeof theme.name !== "string" || format !== "xntheme") throw new Error("Invalid theme export")
    const win = getMainWindow()
    if (!win) return false
    const result = await dialog.showSaveDialog(win, { defaultPath: `${theme.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "theme"}.${format}`, filters: [{ name: "Xneon Theme", extensions: [format] }] })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, await createThemeBundle(theme, directory()))
    return true
  })
  void app.whenReady().then(async () => {
    await fs.mkdir(library.directory, { recursive: true })
    if (disposed) return
    watcher = watch(library.directory, { recursive: true }, refresh)
    watcher.on("error", error => console.error("[Themes] Watch failed", error))
  }).catch(error => console.error("[Themes] Watch startup failed", error))
  app.on("before-quit", () => { disposed = true; watcher?.close(); if (timer) clearTimeout(timer) })
  protocol.registerSchemesAsPrivileged([{ scheme: "xnl-theme", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
  void app.whenReady().then(() => {
    protocol.handle("xnl-theme", async (request) => {
      const url = new URL(request.url)
      const name = url.pathname.slice(1)
      if (url.hostname !== "asset" || !allowedName(name)) return new Response(null, { status: 404 })
      try {
        const response = await net.fetch(pathToFileURL(path.join(directory(), name)).href, { headers: request.headers })
        const headers = new Headers(response.headers)
        headers.set("Content-Type", mediaTypes[path.extname(name).slice(1)])
        headers.set("Access-Control-Allow-Origin", "*")
        return new Response(response.body, { status: response.status, headers })
      } catch { return new Response(null, { status: 404 }) }
    })
  })

  ipcMain.handle("theme:pick-media", async (_event, kind: keyof typeof kinds) => {
    if (!Object.hasOwn(kinds, kind)) throw new Error("Unsupported theme media type")
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: kind, extensions: kinds[kind] }] })
    if (result.canceled) return null
    const file = result.filePaths[0]
    const ext = path.extname(file).slice(1).toLowerCase()
    if (!kinds[kind].includes(ext) || (await fs.stat(file)).size > MAX_ASSET) throw new Error("Unsupported or oversized theme media")
    const content = await fs.readFile(file)
    const name = `${createHash("sha256").update(content).digest("hex")}.${ext}`
    await fs.mkdir(directory(), { recursive: true })
    await fs.writeFile(path.join(directory(), name), content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error })
    return { source: `xnl-theme://asset/${name}`, name: path.basename(file) }
  })
}
