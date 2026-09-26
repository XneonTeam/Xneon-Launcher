// ============================================================
// XNLC — XN-Connect IPC (relay-туннели серверов)
// ============================================================
//
// Каналы `xn-connect:*` жили внутри `mc-server-handlers.ts` (файл про серверы
// целиком): чужой домен в чужом модуле. Вынесены в отдельный файл без изменения
// поведения — регистрация вызывается из `main/index.ts` рядом с остальными.

import { ipcMain } from "electron"
import { dbHelpers } from "../db"
import { serverManager } from "@xnlc/servers"
import { xnConnectManager } from "./xn-connect-manager"
import { logRuntime, sendToRenderer } from "./runtime"
import type { XnConnectState } from "@xnlc/types" with { "resolution-mode": "import" }

export function registerXnConnectHandlers(): void {

ipcMain.handle("xn-connect:authorize", async () => {
  return xnConnectManager.authorize((state) => {
    sendToRenderer("xn-connect:auth-state", { state })
  })
})

// XN Connect живёт по жизненному циклу сервера: туннель поднимается только
// тогда, когда запущен сам Minecraft-сервер. Без этой проверки relay dial'ит
// закрытый локальный порт и висит в бесконечных реконнектах, а игроки видят
// публичный адрес, который никуда не ведёт.
ipcMain.handle("xn-connect:start", async (_event, serverId: string) => {
  const row = await dbHelpers.getMcServer(serverId)
  if (!row) throw new Error("Server not found")

  const state = serverManager.getState(serverId)
  if (state.status !== "running" && state.status !== "starting") {
    logRuntime(`[XN-Connect] Relay start skipped for "${row.name}": server is ${state.status}`)
    return { status: "stopped" } satisfies XnConnectState
  }

  return xnConnectManager.start(serverId, row.name, row.port)
})

ipcMain.handle("xn-connect:stop", async (_event, serverId: string) => {
  await xnConnectManager.stop(serverId)
})

ipcMain.handle("xn-connect:status", async (_event, serverId: string) => {
  return xnConnectManager.getState(serverId)
})

ipcMain.handle("xn-connect:usage", async () => {
  // Always fetch fresh data from the API so limit checks are accurate;
  // fall back to cache when the API is unreachable
  try {
    return await xnConnectManager.refreshUsage()
  } catch {
    return xnConnectManager.getUsage()
  }
})
}
