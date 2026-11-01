import { ipcMain } from "electron"
import type { ShareRequest, ShareResult } from "@xnlc/types"
import { executeShare } from "./service"
import { registerShareLinks } from "./links"

export function registerShareHandlers() {
  registerShareLinks()
  ipcMain.handle("share:execute", async (event, input: ShareRequest): Promise<ShareResult> => {
    const notify = (progress: { stage: string; done: number; total: number; bytes: number }) => {
      if (!event.sender.isDestroyed()) event.sender.send("share:progress", { ...progress, requestId: input.requestId, buildId: "buildId" in input ? input.buildId : undefined })
    }
    const tracked = ["publish", "push", "apply", "restoreApply", "installInvite"].includes(input.action)
    try {
      if (tracked) notify({ stage: "start", done: 0, total: 1, bytes: 0 })
      const data = await executeShare(input, notify)
      if (tracked) notify({ stage: "done", done: 1, total: 1, bytes: data.uploadedBytes ?? 0 })
      return { success: true, data }
    } catch (error) {
      if (tracked) notify({ stage: "error", done: 0, total: 1, bytes: 0 })
      const e = error as { code?: string; message?: string; filePath?: string }
      return { success: false, error: { code: e.code || "SHARE", message: e.message || String(error), filePath: e.filePath } }
    }
  })
}
