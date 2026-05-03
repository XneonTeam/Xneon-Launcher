import { useEffect, useState } from "react"
import { fetchVersionsFromRenderer, type MinecraftVersionOption, VERSIONS } from "@/lib/home-page-shared"

export function useHomeVersions(selectedModLoader: string) {
  const [allMinecraftVersions, setAllMinecraftVersions] = useState<MinecraftVersionOption[]>([])
  const [versions, setVersions] = useState<string[]>(VERSIONS)
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState("")
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
      try {
        const versions = await window.electronAPI?.getMinecraftVersions()
        if (!cancelled && Array.isArray(versions) && versions.length > 0) {
          setAllMinecraftVersions(versions)
          setVersionsLoaded(true)
          return
        }
      } catch (error) {
        console.error("Failed to load Minecraft versions from electron API", error)
      }
      try {
        const fallbackVersions = await fetchVersionsFromRenderer()
        if (!cancelled) setAllMinecraftVersions(fallbackVersions)
      } catch (error) {
        console.error("Failed to load Minecraft versions from renderer fallback", error)
        if (!cancelled) setAllMinecraftVersions([])
      } finally {
        if (!cancelled) setVersionsLoaded(true)
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

  useEffect(() => {
    if (allMinecraftVersions.length === 0) return
    let cancelled = false
    const loaders: Record<string, () => Promise<string[]>> = {
      vanilla: async () => allMinecraftVersions.map(v => v.version),
      fabric: async () => await window.electronAPI?.getFabricSupported() ?? [],
      forge: async () => await window.electronAPI?.getForgeSupported() ?? [],
      neoforge: async () => await window.electronAPI?.getNeoForgeSupported() ?? [],
      quilt: async () => await window.electronAPI?.getQuiltSupported() ?? [],
      optifine: async () => await window.electronAPI?.getOptifineSupported() ?? [],
    }

    const loadFilteredVersions = async () => {
      try {
        const supported = await (loaders[selectedModLoader]?.() ?? loaders.vanilla())
        const filtered = allMinecraftVersions
          .filter(v => selectedModLoader === "vanilla" || supported.includes(v.version))
          .filter(v =>
            v.type === "release" ||
            (v.type === "snapshot" && showSnapshot) ||
            (v.type === "old_beta" && showBeta) ||
            (v.type === "old_alpha" && showAlpha)
          )
          .map(v => v.version)

        if (cancelled) return
        setVersions(filtered)
        setSelectedVersion(prev => filtered.includes(prev) ? prev : filtered[0] ?? "")
      } catch (error) {
        console.error("Failed to load versions for", selectedModLoader, error)
      }
    }

    void loadFilteredVersions()
    return () => {
      cancelled = true
    }
  }, [allMinecraftVersions, selectedModLoader, showSnapshot, showBeta, showAlpha])

  return { versions, versionsLoaded, selectedVersion, setSelectedVersion }
}
