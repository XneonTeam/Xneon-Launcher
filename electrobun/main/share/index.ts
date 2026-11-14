import { rpcRegistry } from "../../platform/desktop"
import type { ShareRequest, ShareResult, ShareProgress } from "@xnlc/types"
import { dbHelpers } from "../../db"
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
    let buildId = "buildId" in input ? input.buildId : undefined
    let buildName = input.action === "installInvite" ? input.name.trim() : undefined
    const readBuildName = async () => {
      // Ошибка чтения подписи не должна менять результат самой операции.
      if (buildId) buildName = (await dbHelpers.findBuildById(buildId).catch(() => null))?.name ?? buildName
    }
    const notify = (progress: ShareProgress) => {
      if (installation?.cancelled && progress.stage !== "cancelled") throw Object.assign(new Error("Installation cancelled"), { code: "CANCELLED" })
      if (installation && (progress.stage === "index" || progress.stage === "download" && progress.done >= progress.total)) installation.canCancel = false
      if (!event.sender.isDestroyed()) event.sender.send({ channel: "share:progress", payload: { ...progress, requestId: input.requestId, buildId, buildName, action: input.action } })
    }
    const tracked = ["publish", "push", "apply", "restoreApply", "installInvite"].includes(input.action)
    try {
      if (tracked) {
        await readBuildName()
        notify({ stage: "start", done: 0, total: 1, bytes: 0 })
      }
      const data = await executeShare(input, notify, installation?.abort.signal)
      if (tracked) {
        buildId = data.buildId ?? buildId
        await readBuildName()
        notify({ stage: "done", done: 1, total: 1, bytes: data.uploadedBytes ?? 0 })
      }
      return { success: true, data }
    } catch (error) {
      const e = error as { code?: string; message?: string; filePath?: string }
      // У AbortError поле code может быть только для чтения — не изменяем исключение.
      const code = installation?.cancelled || e?.code === "CANCELLED" ? "CANCELLED" : typeof e?.code === "string" ? e.code : "SHARE"
      if (tracked) notify({ stage: code === "CANCELLED" ? "cancelled" : "error", done: 0, total: 1, bytes: 0, errorCode: code })
      return { success: false, error: { code, message: e?.message || String(error), filePath: e?.filePath } }
    } finally { if (installation) installations.delete(key) }
  })
}
