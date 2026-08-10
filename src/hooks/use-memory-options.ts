import { useEffect, useState } from "react"
import { getSnapPoints } from "@/lib/memory"

const FALLBACK_MAX_MB = 16384

export function useMemoryOptions() {
  const [maxMb, setMaxMb] = useState(FALLBACK_MAX_MB)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      let memoryMb = FALLBACK_MAX_MB
      try {
        const bytes = await window.electronAPI?.getTotalMemory()
        if (typeof bytes === "number" && bytes > 0) {
          memoryMb = Math.floor(bytes / 1024 / 1024)
        } else {
          const nav = navigator as Navigator & { deviceMemory?: number }
          if (nav.deviceMemory) memoryMb = nav.deviceMemory * 1024
        }
      } catch {
        memoryMb = FALLBACK_MAX_MB
      }
      if (!cancelled) {
        setMaxMb(memoryMb)
        setLoaded(true)
      }
    }
    void resolve()
    return () => { cancelled = true }
  }, [])

  return { maxMb, snapPoints: getSnapPoints(maxMb), loaded }
}
