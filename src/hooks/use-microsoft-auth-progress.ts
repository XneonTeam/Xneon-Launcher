import { useCallback, useEffect, useRef, useState } from "react"
import type { MicrosoftAuthStage } from "@xnlc/types"

/** Подписка общая для OAuth и Device Code; чужие и завершённые попытки игнорируются. */
export function useMicrosoftAuthProgress() {
  const [stage, setStage] = useState<MicrosoftAuthStage | null>(null)
  const requestId = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.electrobunAPI?.onMicrosoftAuthProgress?.(progress => {
      if (requestId.current && progress.requestId === requestId.current) setStage(progress.stage)
    })
    return () => {
      requestId.current = null
      unsubscribe?.()
    }
  }, [])

  const begin = useCallback((initial: MicrosoftAuthStage = "waiting") => {
    const id = crypto.randomUUID()
    requestId.current = id
    setStage(initial)
    return id
  }, [])

  const reset = useCallback(() => {
    requestId.current = null
    setStage(null)
  }, [])

  return { stage, requestId, begin, reset }
}
