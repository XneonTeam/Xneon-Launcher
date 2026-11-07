import { app } from "electron"
import { getMainWindow, sendToRenderer } from "../runtime"
let pending: string | undefined
export function takeShareInvitation() { const value = pending; pending = undefined; return value }
export function registerShareLinks() {
  if (app.isPackaged && !app.hasSingleInstanceLock() && !app.requestSingleInstanceLock()) { app.quit(); return }
  function receive(value: string) {
    try {
      const url = new URL(value)
      if (url.protocol !== "xneon:" || url.hostname !== "share" || !/^\/invite\/[A-Za-z0-9_-]{20,160}$/.test(url.pathname) || url.search || url.hash) return
      pending = value
      const window = getMainWindow()
      if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
      sendToRenderer("share:invitation", { invitation: value })
    } catch { /* Неподдерживаемые ссылки не обрабатываем. */ }
  }
  app.on("open-url", (event, url) => { if (url.startsWith("xneon://share/")) { event.preventDefault(); receive(url) } })
  app.on("second-instance", (_event, argv) => { for (const value of argv) if (value.startsWith("xneon://share/")) receive(value) })
  for (const value of process.argv) if (value.startsWith("xneon://share/")) receive(value)
  if (app.isPackaged) app.setAsDefaultProtocolClient("xneon")
}
