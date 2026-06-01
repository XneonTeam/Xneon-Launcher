import { useEffect, useMemo, useState } from "react"
import {
  fetchVersionsFromRenderer,
  filterMinecraftVersions,
  type MinecraftVersionOption,
  VERSIONS,
} from "@/lib/home-page-shared"

export function useMinecraftVersionOptions() {
  const [allMinecraftVersions, setAllMinecraftVersions] = useState<MinecraftVersionOption[]>(
    VERSIONS.map((version) => ({ version, stable: true, type: "release" }))
  )
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [showBeta, setShowBeta] = useState(false)
  const [showAlpha, setShowAlpha] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadFlag = async (key: "showSnapshot" | "showBeta" | "showAlpha", setter: (value: boolean) => void) => {
      try {
        const value = await window.electronAPI?.getSetting(key)
        if (!cancelled) setter(value === "true")
      } catch (error) {
        console.error(`Failed to load ${key} setting`, error)
      }
    }

    const loadFlags = async () => {
      await Promise.all([
        loadFlag("showSnapshot", setShowSnapshot),
        loadFlag("showBeta", setShowBeta),
        loadFlag("showAlpha", setShowAlpha),
      ])
    }

    const loadVersions = async () => {
      let success = false
      try {
        const versions = await window.electronAPI?.getMinecraftVersions()
        if (!cancelled && Array.isArray(versions) && versions.length > 0) {
          setAllMinecraftVersions(versions)
          success = true
          setVersionsLoaded(true)
          return
        }
      } catch (error) {
        console.error("Failed to load Minecraft versions from electron API", error)
      }

      try {
        const fallbackVersions = await fetchVersionsFromRenderer()
        if (!cancelled) {
          setAllMinecraftVersions(fallbackVersions)
          success = true
        }
      } catch (error) {
        console.error("Failed to load Minecraft versions from renderer fallback", error)
      } finally {
        if (!cancelled) setVersionsLoaded(success)
      }
    }

    const handleSettingsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ key?: string }>
      if (!customEvent.detail?.key || ["showSnapshot", "showBeta", "showAlpha"].includes(customEvent.detail.key)) {
        void loadFlags()
      }
    }

    window.addEventListener("launcher-setting-changed", handleSettingsChanged as EventListener)
    void loadFlags()
    void loadVersions()

    return () => {
      cancelled = true
      window.removeEventListener("launcher-setting-changed", handleSettingsChanged as EventListener)
    }
  }, [])

  const visibleVersions = useMemo(() => (
    filterMinecraftVersions(allMinecraftVersions, { showSnapshot, showBeta, showAlpha })
  ), [allMinecraftVersions, showAlpha, showBeta, showSnapshot])

  return {
    allMinecraftVersions,
    visibleVersions,
    versionsLoaded,
    showSnapshot,
    showBeta,
    showAlpha,
  }
}
