import { contextBridge, ipcRenderer } from "electron"

export function registerCallbackBridge(
  exposeName: string,
  matchers: Array<{ prefix: string; channel: string }>,
): void {
  const notifyIfCallback = () => {
    const url = window.location.href
    for (const { prefix, channel } of matchers) {
      if (url.startsWith(prefix)) ipcRenderer.send(channel, url)
    }
  }
  for (const ev of ["DOMContentLoaded", "load", "hashchange", "popstate"] as const) {
    window.addEventListener(ev, notifyIfCallback)
  }
  contextBridge.exposeInMainWorld(exposeName, { notifyIfCallback })
}