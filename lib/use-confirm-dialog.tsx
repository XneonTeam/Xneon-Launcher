import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ActionConfirmDialog } from "@/components/launcher/instance/action-confirm-dialog"

export function useConfirmDialog() {
  const { t } = useTranslation()
  const [state, setState] = useState<{ message: string; alert: boolean } | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)
  useEffect(() => () => { resolveRef.current?.(false) }, [])
  const finish = (value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState(null)
  }
  const ask = (message: string, alert = false) => new Promise<boolean>(resolve => {
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setState({ message, alert })
  })
  const dialog = <ActionConfirmDialog open={state !== null} onClose={() => finish(false)} onConfirm={() => finish(true)} title={t(state?.alert ? "common.gotIt" : "common.continue")} description={state?.message ?? ""} type={state?.alert ? "alert" : "confirm"} variant="info" icon="info" confirmText={t(state?.alert ? "common.gotIt" : "common.continue")} />
  return { ask, dialog }
}
