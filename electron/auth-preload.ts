import { contextBridge, ipcRenderer } from 'electron'

const notifyIfCallback = () => {
  const url = window.location.href
  if (url.startsWith('http://localhost:51234/elyby/callback')) {
    ipcRenderer.send('auth:elyby-callback', url)
  }
  if (url.startsWith('https://login.live.com/oauth20_desktop.srf')) {
    ipcRenderer.send('auth:microsoft-callback', url)
  }
}

window.addEventListener('DOMContentLoaded', notifyIfCallback)
window.addEventListener('load', notifyIfCallback)
window.addEventListener('hashchange', notifyIfCallback)
window.addEventListener('popstate', notifyIfCallback)

contextBridge.exposeInMainWorld('authBridge', { notifyIfCallback })
contextBridge.exposeInMainWorld('elyByAuth', { notifyIfCallback })
contextBridge.exposeInMainWorld('microsoftAuth', { notifyIfCallback })
