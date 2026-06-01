import { useEffect, useMemo, useState } from "react"

type SupportedLoader = "vanilla" | "forge" | "fabric" | "liteloader" | "quilt" | "neoforge" | "optifine" | "instance"

export type LoaderVersionOption = {
  value: string
  label: string
  recommended?: boolean
  stable?: boolean
}

function compareVersionParts(a: string, b: string) {
  const aParts = a.split(/[^0-9]+/).filter(Boolean).map(Number)
  const bParts = b.split(/[^0-9]+/).filter(Boolean).map(Number)
  const maxLength = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < maxLength; i += 1) {
    const aPart = aParts[i] ?? 0
    const bPart = bParts[i] ?? 0
    if (aPart !== bPart) {
      return bPart - aPart
    }
  }

  return 0
}

function compareLoaderOptions(a: LoaderVersionOption, b: LoaderVersionOption) {
  const versionCompare = compareVersionParts(a.value, b.value)
  if (versionCompare !== 0) {
    return versionCompare
  }

  const aPre = a.value.includes("-")
  const bPre = b.value.includes("-")
  if (aPre !== bPre) {
    return aPre ? 1 : -1
  }

  if ((a.recommended ?? false) !== (b.recommended ?? false)) {
    return a.recommended ? -1 : 1
  }

  return a.label.localeCompare(b.label, "en")
}

function sortLoaderOptions(options: LoaderVersionOption[]): LoaderVersionOption[] {
  return [...options].sort(compareLoaderOptions)
}

export function useLoaderVersionOptions(modLoader: string, mcVersion: string) {
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionOption[]>([])
  const [loaderVersionsLoaded, setLoaderVersionsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const normalizedLoader = modLoader as SupportedLoader

      if (!mcVersion || normalizedLoader === "vanilla" || normalizedLoader === "instance") {
        if (!cancelled) {
          setLoaderVersions([])
          setLoaderVersionsLoaded(true)
        }
        return
      }

      setLoaderVersionsLoaded(false)

      try {
        let nextOptions: LoaderVersionOption[] = []

        if (normalizedLoader === "fabric") {
          const versions = await window.electronAPI?.getFabricVersions(mcVersion)
          nextOptions = (versions ?? []).map(version => ({
            value: version.version,
            label: version.stable ? `${version.version} Stable` : version.version,
            stable: version.stable,
            recommended: version.stable,
          }))
        } else if (normalizedLoader === "liteloader") {
          const [versions, recommended] = await Promise.all([
            window.electronAPI?.getLiteLoaderVersions(mcVersion),
            window.electronAPI?.getLiteLoaderRecommended(mcVersion),
          ])
          nextOptions = (versions ?? []).map(version => ({
            value: version.version,
            label: recommended === version.version
              ? `${version.version} Recommended`
              : version.stable
                ? `${version.version} Stable`
                : version.version,
            stable: version.stable,
            recommended: recommended === version.version,
          }))
        } else if (normalizedLoader === "quilt") {
          const versions = await window.electronAPI?.getQuiltVersions(mcVersion)
          nextOptions = (versions ?? []).map(version => ({
            value: version.version,
            label: version.stable ? `${version.version} Stable` : version.version,
            stable: version.stable,
            recommended: version.stable,
          }))
        } else if (normalizedLoader === "neoforge") {
          const [versions, recommended] = await Promise.all([
            window.electronAPI?.getNeoForgeVersions(mcVersion),
            window.electronAPI?.getNeoForgeRecommended(mcVersion),
          ])
          nextOptions = (versions ?? []).map(version => ({
            value: version.version,
            label: recommended === version.version
              ? `${version.version} Recommended`
              : version.stable
                ? `${version.version} Stable`
                : version.version,
            stable: version.stable,
            recommended: recommended === version.version,
          }))
        } else if (normalizedLoader === "forge") {
          const [versions, recommended] = await Promise.all([
            window.electronAPI?.getForgeVersions(mcVersion),
            window.electronAPI?.getForgeRecommended(mcVersion),
          ])
          nextOptions = (versions ?? []).map(version => ({
            value: version.version,
            label: recommended === version.version
              ? `${version.version} Recommended`
              : version.stable
                ? `${version.version} Stable`
                : version.version,
            stable: version.stable,
            recommended: recommended === version.version,
          }))
        } else if (normalizedLoader === "optifine") {
          const [versions, recommended] = await Promise.all([
            window.electronAPI?.getOptifineVersions(mcVersion),
            window.electronAPI?.getOptifineRecommended(mcVersion),
          ])
          nextOptions = (versions ?? []).map(version => ({
            value: version.filename,
            label: recommended === version.filename
              ? `${version.filename} Recommended`
              : version.isPreview
                ? `${version.filename} Preview`
                : version.filename,
            recommended: recommended === version.filename,
          }))
        }

        if (cancelled) return

        setLoaderVersions(sortLoaderOptions(nextOptions))
        setLoaderVersionsLoaded(true)
      } catch (error) {
        console.error(`Failed to load ${modLoader} loader versions for ${mcVersion}`, error)
        if (!cancelled) {
          setLoaderVersions([])
          setLoaderVersionsLoaded(true)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [mcVersion, modLoader])

  const recommendedLoaderVersion = useMemo(
    () => loaderVersions.find(option => option.recommended)?.value ?? loaderVersions[0]?.value ?? "",
    [loaderVersions],
  )

  return {
    loaderVersions,
    loaderVersionsLoaded,
    recommendedLoaderVersion,
  }
}
