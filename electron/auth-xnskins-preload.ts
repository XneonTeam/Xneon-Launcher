import { contextBridge, ipcRenderer } from 'electron'

const notifyIfCallback = () => {
  const url = window.location.href
  if (url.startsWith('http://localhost:5123/xneon/callback')) {
    ipcRenderer.send('auth:xnskins-callback', url)
  }
}

window.addEventListener('DOMContentLoaded', notifyIfCallback)
window.addEventListener('load', notifyIfCallback)
window.addEventListener('hashchange', notifyIfCallback)
window.addEventListener('popstate', notifyIfCallback)

contextBridge.exposeInMainWorld('xnSkinsAuth', { notifyIfCallback })
