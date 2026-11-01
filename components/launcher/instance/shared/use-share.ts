import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ShareRequest, ShareResponse } from "@xnlc/types"
import { useAccounts } from "@/src/AccountsContext"

export function useShare(buildId: string) {
  const { t } = useTranslation()
  const { accounts } = useAccounts()
  const accountsKey = accounts.map(account => `${account.id}:${account.type}:${account.username}:${account.isActive}`).join("|")
  const [data, setData] = useState<ShareResponse>({}), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const generation = useRef(0), running = useRef(false)
  const run = useCallback(async (request: ShareRequest): Promise<ShareResponse | undefined> => {
    if (!window.electronAPI || running.current) return
    const current = generation.current
    running.current = true; setBusy(true); setError("")
    try {
      const result = await window.electronAPI.shareExecute({ ...request, requestId: request.requestId ?? crypto.randomUUID() })
      if (current !== generation.current) return
      if (!result.success) {
        const message = t(`share.errors.${result.error.code}`, { defaultValue: t("share.failed") })
        setError(result.error.filePath ? t("share.flow.fileError", { message, path: result.error.filePath }) : message)
        return
      }
      setData(previous => result.data.detached || request.action === "status" || request.action === "session" ? result.data : { ...previous, ...result.data })
      return result.data
    } catch { if (current === generation.current) setError(t("share.flow.connectionError")) }
    finally { running.current = false; if (current === generation.current) setBusy(false) }
  }, [t])
  const refresh = useCallback(() => run(buildId ? { action: "status", buildId } : { action: "session" }), [buildId, run])
  useEffect(() => { generation.current++; running.current = false; setData({}); setError(""); void refresh(); return () => { generation.current++ } }, [refresh, accountsKey])
  return { data, busy, error, run, refresh, clearError: () => setError("") }
}
export type ShareController = ReturnType<typeof useShare>
