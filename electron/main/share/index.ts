import { ipcMain } from "electron"
import type { ShareRequest, ShareResult } from "@xnlc/types"
import { executeShare } from "./service"
import { registerShareLinks } from "./links"

export function registerShareHandlers() {
  registerShareLinks()
  const installations = new Map<string, { cancelled: boolean; canCancel: boolean }>()
  ipcMain.handle("share:cancel-install", (event, requestId: string) => {
    const installation = installations.get(`${event.sender.id}:${requestId}`)
    if (!installation?.canCancel) return false
    installation.cancelled = true
    return true
  })
  ipcMain.handle("share:execute", async (event, input: ShareRequest): Promise<ShareResult> => {
    const key = `${event.sender.id}:${input.requestId}`
    const installation = input.action === "installInvite" ? { cancelled: false, canCancel: true } : undefined
    if (installation) installations.set(key, installation)
    const notify = (progress: { stage: string; done: number; total: number; bytes: number }) => {
      if (installation?.cancelled) throw Object.assign(new Error("Installation cancelled"), { code: "CANCELLED" })
      if (installation && (progress.stage === "index" || progress.stage === "download" && progress.done >= progress.total)) installation.canCancel = false
      if (!event.sender.isDestroyed()) event.sender.send("share:progress", { ...progress, requestId: input.requestId, buildId: "buildId" in input ? input.buildId : undefined })
    }
    const tracked = ["publish", "push", "apply", "restoreApply", "installInvite"].includes(input.action)
    try {
      if (tracked) notify({ stage: "start", done: 0, total: 1, bytes: 0 })
      const data = await executeShare(input, notify)
      if (tracked) notify({ stage: "done", done: 1, total: 1, bytes: data.uploadedBytes ?? 0 })
      return { success: true, data }
    } catch (error) {
      if (tracked && !installation?.cancelled) notify({ stage: "error", done: 0, total: 1, bytes: 0 })
      const e = error as { code?: string; message?: string; filePath?: string }
      return { success: false, error: { code: e.code || "SHARE", message: e.message || String(error), filePath: e.filePath } }
    } finally { if (installation) installations.delete(key) }
  })
}
