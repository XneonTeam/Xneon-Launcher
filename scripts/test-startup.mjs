/** Проверяем порядок старта без Electron и сети. */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"

const source = (await fs.readFile(new URL("../src/main.tsx", import.meta.url), "utf8"))
  .replace(/^import .*$/gm, "")
  .replace("document.getElementById('root')!", "document.getElementById('root')")
  .replace("import('./App')", "loadApp()")
  .replace("<App />", "App")

let releaseApp, releaseTheme, releaseBackend
const app = new Promise(resolve => { releaseApp = resolve })
const backend = new Promise(resolve => { releaseBackend = resolve })
const theme = new Promise(resolve => { releaseTheme = resolve })
let removed = false, rendered = false
const timers = [], frames = []
const splash = { dataset: { startedAt: "1000" }, remove: () => { removed = true } }
const window = new EventTarget()
window.electronAPI = { startupReady: () => backend }
window.setTimeout = (callback, delay) => { timers.push({ callback, delay }) }
const context = vm.createContext({
  window, Event, console,
  document: { getElementById: id => id === "splash" ? splash : {}, documentElement: { dataset: {} } },
  performance: { now: () => 1100 },
  ReactDOM: { createRoot: () => ({ render: () => { rendered = true } }) },
  initializeTheme: () => theme,
  loadApp: () => app,
  requestAnimationFrame: callback => frames.push(callback),
})
vm.runInContext(source, context)
assert.equal(rendered, false)
assert.equal(removed, false)
assert.equal(timers.length, 0, "splash не должен скрываться по таймеру, пока модули не готовы")
releaseApp({ App: () => {} })
await new Promise(resolve => setImmediate(resolve))
assert.equal(rendered, false, "ожидаем применения темы")
releaseBackend()
await new Promise(resolve => setImmediate(resolve))
assert.equal(rendered, false, "БД готова, но тема ещё применяется")
releaseTheme()
await new Promise(resolve => setImmediate(resolve))
assert.equal(rendered, true)
assert.equal(removed, false, "рендер приложения ещё не означает готовность кадра")
window.dispatchEvent(new Event("app:hydrated"))
assert.equal(timers.length, 0, "искусственная задержка после загрузки не нужна")
assert.equal(removed, true)
window.dispatchEvent(new Event("app:hydrated"))
assert.equal(timers.length, 0, "сигнал обрабатывается однократно")
console.log("✓ Splash ждёт модули, тему и готовность React; быстрый старт без искусственной задержки и повторные сигналы проверены")

// Проверяем main-процесс: splash виден, пока инициализация БД ещё не завершена.
const { EventEmitter } = await import("node:events")
const { createRequire } = await import("node:module")
const require = createRequire(import.meta.url)
const nativeFs = require("node:fs")
const nativePath = require("node:path")
const events = []
let mainWindow, releaseDatabase
const databaseReady = new Promise(resolve => { releaseDatabase = resolve })
class FakeWindow extends EventEmitter {
  constructor() { super(); this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; mainWindow = this }
  loadURL(url) { events.push(url.startsWith("data:") ? "splash" : "launcher"); setImmediate(() => this.emit("ready-to-show")); return Promise.resolve() }
  loadFile() { events.push("launcher"); setImmediate(() => this.emit("ready-to-show")); return Promise.resolve() }
  isDestroyed() { return false }
  show() { events.push("shown") }
}
const nativeApp = new EventEmitter()
nativeApp.commandLine = { appendSwitch() {} }
nativeApp.whenReady = () => Promise.resolve()
const runtime = { isDev: false, setMainWindow: value => { mainWindow = value }, getMainWindow: () => mainWindow, logRuntime() {}, logRuntimeDebug() {}, initRuntimePaths: async () => {}, sendToRenderer() {} }
const startupHandlers = new Map()
const imports = {
  electron: { app: nativeApp, BrowserWindow: FakeWindow, ipcMain: { on() {}, handle: (name, handler) => startupHandlers.set(name, handler) }, Menu: { setApplicationMenu() {} }, shell: {} },
  path: nativePath, "node:fs": nativeFs,
  "./runtime": runtime,
  "./startup-theme": { readStartupTheme: () => null },
  "../db": { initDatabase: () => { events.push("database"); return databaseReady } },
  "./authlib": { refreshAuthServersInBackground() {} },
  "./stats": { cleanupOrphanGameSessions: async () => 0 },
  "./builds/helpers": { loadInstancesRoot: async () => {} },
  "./builds/dir-migration": { migrateIntentDirNames: async () => 0 },
}
const mainModule = { exports: {} }
vm.runInNewContext(await fs.readFile(new URL("../dist-electron/main/window.js", import.meta.url), "utf8"), {
  module: mainModule, exports: mainModule.exports,
  require: id => { assert.ok(id in imports, id); return imports[id] },
  __dirname: nativePath.resolve("dist-electron/main"), process: { argv: [], platform: "win32" }, console,
})
mainModule.exports.registerWindowLifecycle()
await new Promise(resolve => setImmediate(resolve))
await new Promise(resolve => setImmediate(resolve))
assert.deepEqual(events, ["launcher", "database", "shown"])
let backendReleased = false
startupHandlers.get("startup:ready")().then(() => { backendReleased = true })
assert.equal(backendReleased, false)
releaseDatabase()
await new Promise(resolve => setImmediate(resolve))
assert.equal(backendReleased, true)
assert.equal(events.filter(event => event === "launcher").length, 1, "документ не должен перезагружаться ради второго splash")
console.log("✓ Один документ со splash: окно показывается, renderer ждёт БД без повторной навигации")

const launcherSource = await fs.readFile(new URL("../components/launcher/launcher.tsx", import.meta.url), "utf8")
for (const name of ["SettingsPage", "CloudPage", "ServersPage", "StatsPage", "AccountsPage"]) assert.ok(!new RegExp(`import \{ ${name} \} from`).test(launcherSource), `${name} не должен входить в стартовый граф`)
assert.ok(!launcherSource.includes("prefetchHeavyPages"), "тяжёлые вкладки не прогреваются во время старта")
console.log("✓ Второстепенные разделы не входят в стартовый граф")

const viteConfig = (await import("../vite.config.mts")).default
const { createFilter } = await import("vite")
const ignored = createFilter(viteConfig.server.watch.ignored)
assert.ok(ignored(nativePath.resolve(".pnpm-store/v11/files/example")), "pnpm store не должен создавать десятки тысяч наблюдателей")
assert.ok(!ignored(nativePath.resolve("components/launcher/launcher.tsx")), "HMR исходников должен работать")
const iconPlugin = viteConfig.plugins.find(plugin => plugin?.name === "tabler-direct-imports")
const transformed = iconPlugin.transform("import { IconHome, IconX as CloseIcon, type IconProps } from '@tabler/icons-react'", nativePath.resolve("components/example.tsx"))
assert.ok(transformed.includes("import IconHome from '@tabler/icons-react/dist/esm/icons/IconHome.mjs'"))
assert.ok(transformed.includes("import CloseIcon from '@tabler/icons-react/dist/esm/icons/IconX.mjs'"))
assert.ok(transformed.includes("import { type IconProps }"))
console.log("✓ Vite исключает pnpm store, сохраняет HMR исходников и загружает только нужные иконки")

const cacheRoot = await fs.mkdtemp(nativePath.resolve(".tmp/startup-theme-"))
const cacheModule = { exports: {} }
vm.runInNewContext(await fs.readFile(new URL("../dist-electron/main/startup-theme.js", import.meta.url), "utf8"), {
  module: cacheModule, exports: cacheModule.exports,
  require: id => id === "./paths" ? { getLauncherDataRoot: () => cacheRoot } : require(id),
})
const snapshot = JSON.stringify({ mode: "light", colors: { "--background": "#ffffff", "--primary": "#123456" } })
cacheModule.exports.writeStartupTheme(snapshot)
assert.equal(cacheModule.exports.readStartupTheme(), snapshot)
assert.throws(() => cacheModule.exports.validateStartupTheme(JSON.stringify({ mode: "light", colors: { "--unknown": "red" } })))
const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8")
const earlyScript = html.match(/<script>([\s\S]*?)<\/script>/)[1]
const bootColors = new Map()
let mode
vm.runInNewContext(earlyScript, {
  window: { electronAPI: { startupThemeSnapshot: snapshot } },
  document: { documentElement: { classList: { toggle: (_key, dark) => { mode = dark ? "dark" : "light" } }, style: { setProperty: (key, value) => bootColors.set(key, value) } } },
})
assert.equal(mode, "light")
assert.equal(bootColors.get("--background"), "#ffffff")
assert.equal(bootColors.get("--primary"), "#123456")
await fs.rm(cacheRoot, { recursive: true })
console.log("✓ Цвета сохранённой темы применяются в head до splash; кеш обновляется и проверяется")
