import { rpcRegistry } from "../../platform/desktop"
import type { ShareRequest, ShareResult } from "@xnlc/types"
import { executeShare } from "./service"

export function registerShareHandlers() {
  const installations = new Map<string, { cancelled: boolean; canCancel: boolean; abort?: AbortController }>()
  rpcRegistry.handle("share:cancel-install", (event, requestId: string) => {
    const installation = installations.get(`${event.sender.id}:${requestId}`)
    if (!installation?.canCancel) return false
    installation.cancelled = true
    installation.abort?.abort()
    return true
  })
  rpcRegistry.handle("share:execute", async (event, input: ShareRequest): Promise<ShareResult> => {
    const key = `${event.sender.id}:${input.requestId}`
    const installation = ["installInvite", "publish", "push"].includes(input.action) ? { cancelled: false, canCancel: true, abort: new AbortController() } : undefined
    if (installation) installations.set(key, installation)
    const notify = (progress: { stage: string; done: number; total: number; bytes: number }) => {
      if (installation?.cancelled) throw Object.assign(new Error("Installation cancelled"), { code: "CANCELLED" })
      if (installation && (progress.stage === "index" || progress.stage === "download" && progress.done >= progress.total)) installation.canCancel = false
      if (!event.sender.isDestroyed()) event.sender.send({ channel: "share:progress", payload: { ...progress, requestId: input.requestId, buildId: "buildId" in input ? input.buildId : undefined } })
    }
    const tracked = ["publish", "push", "apply", "restoreApply", "installInvite"].includes(input.action)
    try {
      if (tracked) notify({ stage: "start", done: 0, total: 1, bytes: 0 })
      const data = await executeShare(input, notify, installation?.abort.signal)
      if (tracked) notify({ stage: "done", done: 1, total: 1, bytes: data.uploadedBytes ?? 0 })
      return { success: true, data }
    } catch (error) {
      if (tracked && !installation?.cancelled) notify({ stage: "error", done: 0, total: 1, bytes: 0 })
      const e = error as { code?: string; message?: string; filePath?: string }
      if (installation?.cancelled) e.code = "CANCELLED"
      return { success: false, error: { code: e.code || "SHARE", message: e.message || String(error), filePath: e.filePath } }
    } finally { if (installation) installations.delete(key) }
  })
}
