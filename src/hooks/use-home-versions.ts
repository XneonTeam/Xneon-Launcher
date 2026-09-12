import { useEffect, useRef, useState } from "react"
import { useMinecraftVersionOptions } from "@/src/hooks/use-minecraft-version-options"

export function useHomeVersions(selectedModLoader: string, initialVersion?: string) {
  const [versions, setVersions] = useState<string[]>([])
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(initialVersion ?? "")
  const [latestRelease, setLatestRelease] = useState<string | null>(null)
  const [buildIcons, setBuildIcons] = useState<Record<string, string>>({})
  const { allMinecraftVersions, visibleVersions, versionsLoaded: minecraftVersionsLoaded } = useMinecraftVersionOptions()
  const supportedVersionsCacheRef = useRef(new Map<string, string[]>())

  useEffect(() => {
    setVersionsLoaded(minecraftVersionsLoaded)
  }, [minecraftVersionsLoaded])

  useEffect(() => {
    let cancelled = false

    const loadLatestRelease = async () => {
      try {
        const version = await window.electronAPI?.getLatestRelease()
        if (!cancelled) {
          setLatestRelease(version ?? null)
        }
      } catch (error) {
        console.error("Failed to load latest release", error)
        if (!cancelled) {
          setLatestRelease(null)
        }
      }
    }

    void loadLatestRelease()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedModLoader === "instance") {
      // Load builds as versions
      const loadBuilds = async () => {
        try {
          const builds = await window.electronAPI?.loadBuilds() ?? []
          const buildNames = builds.map(b => b.name)
          const icons: Record<string, string> = {}
          for (const b of builds) { if (b.icon) icons[b.name] = b.icon }
          setBuildIcons(icons)
          setVersions(buildNames)
          setVersionsLoaded(true)
          setSelectedVersion(prev => buildNames.includes(prev) ? prev : buildNames[0] ?? "")
        } catch (error) {
          console.error("Failed to load builds", error)
          setVersions([])
          setVersionsLoaded(true)
        }
      }
      void loadBuilds()
      return
    }

    setBuildIcons(prev => Object.keys(prev).length === 0 ? prev : {})

    if (allMinecraftVersions.length === 0) return
    let cancelled = false
    const loaders: Record<string, () => Promise<string[]>> = {
      vanilla: async () => allMinecraftVersions.map(v => v.version),
      forge: async () => await window.electronAPI?.getForgeSupported() ?? [],
      fabric: async () => await window.electronAPI?.getFabricSupported() ?? [],
      liteloader: async () => await window.electronAPI?.getLiteLoaderSupported() ?? [],
      quilt: async () => await window.electronAPI?.getQuiltSupported() ?? [],
      neoforge: async () => await window.electronAPI?.getNeoForgeSupported() ?? [],
      optifine: async () => await window.electronAPI?.getOptifineSupported() ?? [],
      paper: async () => await window.electronAPI?.getPaperSupported() ?? [],
      purpur: async () => await window.electronAPI?.getPurpurSupported() ?? [],
      folia: async () => await window.electronAPI?.getFoliaSupported() ?? [],
      sponge: async () => await window.electronAPI?.getSpongeSupported() ?? [],
      spongevanilla: async () => await window.electronAPI?.getSpongeSupported("spongevanilla") ?? [],
      spongeforge: async () => await window.electronAPI?.getSpongeSupported("spongeforge") ?? [],
      spongeneo: async () => await window.electronAPI?.getSpongeSupported("spongeneo") ?? [],
      velocity: async () => await window.electronAPI?.getVelocitySupported() ?? [],
      waterfall: async () => await window.electronAPI?.getWaterfallSupported() ?? [],
      bungeecord: async () => allMinecraftVersions.map(v => v.version),
    }

    // Loaders whose versions are NOT MC versions (proxy用自己的 версии)
    const ownVersionLoaders = new Set(["velocity"])

    const loadFilteredVersions = async () => {
      try {
        const cached = supportedVersionsCacheRef.current.get(selectedModLoader)
        const supported = cached ?? await (loaders[selectedModLoader]?.() ?? loaders.vanilla())
        if (!cached) {
          supportedVersionsCacheRef.current.set(selectedModLoader, supported)
        }

        // Velocity and similar proxy loaders have their own versions, not MC versions
        if (ownVersionLoaders.has(selectedModLoader)) {
          if (cancelled) return
          setVersions(supported)
          setSelectedVersion((prev) => {
            if (supported.length === 0) return ""
            if (prev && supported.includes(prev)) return prev
            return supported[0] ?? ""
          })
          return
        }

        const filtered = visibleVersions.filter((version) =>
          selectedModLoader === "vanilla" || supported.includes(version)
        )

        if (cancelled) return
        setVersions(filtered)
        setSelectedVersion((prev) => {
          if (filtered.length === 0) return ""
          if (prev && filtered.includes(prev)) {
            return prev
          }
          if (latestRelease && filtered.includes(latestRelease)) return latestRelease
          const latestVisibleRelease = allMinecraftVersions.find(
            (version) => version.type === "release" && filtered.includes(version.version),
          )?.version
          if (latestVisibleRelease) return latestVisibleRelease
          return filtered[0] ?? ""
        })
      } catch (error) {
        console.error("Failed to load versions for", selectedModLoader, error)
      }
    }

    void loadFilteredVersions()
    return () => {
      cancelled = true
    }
  }, [allMinecraftVersions, latestRelease, selectedModLoader, visibleVersions])

  return { versions, versionsLoaded, selectedVersion, setSelectedVersion, buildIcons }
}
