import { useEffect, useRef, useState } from "react"
import { VERSIONS } from "@/lib/home-page-shared"
import { useMinecraftVersionOptions } from "@/src/hooks/use-minecraft-version-options"

const LEGACY_DEFAULT_VERSION = VERSIONS[0] ?? ""

export function useHomeVersions(selectedModLoader: string, initialVersion?: string) {
  const [versions, setVersions] = useState<string[]>(VERSIONS)
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(initialVersion ?? "")
  const [latestRelease, setLatestRelease] = useState<string | null>(null)
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
    }

    const loadFilteredVersions = async () => {
      try {
        const cached = supportedVersionsCacheRef.current.get(selectedModLoader)
        const supported = cached ?? await (loaders[selectedModLoader]?.() ?? loaders.vanilla())
        if (!cached) {
          supportedVersionsCacheRef.current.set(selectedModLoader, supported)
        }
        const filtered = visibleVersions.filter((version) =>
          selectedModLoader === "vanilla" || supported.includes(version)
        )

        if (cancelled) return
        setVersions(filtered)
        setSelectedVersion((prev) => {
          if (filtered.length === 0) return ""
          if (prev && filtered.includes(prev)) {
            const shouldUpgradeLegacyDefault = (
              prev === LEGACY_DEFAULT_VERSION
              && !!latestRelease
              && filtered.includes(latestRelease)
              && latestRelease !== prev
            )

            if (!shouldUpgradeLegacyDefault) {
              return prev
            }
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

  return { versions, versionsLoaded, selectedVersion, setSelectedVersion }
}
