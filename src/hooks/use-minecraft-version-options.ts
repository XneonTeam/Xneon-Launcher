import { useEffect, useMemo, useState } from "react"
import {
  fetchVersionsFromRenderer,
  filterMinecraftVersions,
  type MinecraftVersionOption,
} from "@/lib/home-page-shared"

// Shared module-level cache so that Home and Builds pages never issue
// duplicate Mojang manifest fetches — the first caller starts one request,
// every subsequent caller reuses the result (stale-while-revalidate within
// the session; cross-session freshness is handled by the main-process disk cache).
let cachedVersions: MinecraftVersionOption[] | null = null
let versionsPromise: Promise<MinecraftVersionOption[] | null> | null = null

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T | null> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
  }
  console.error("Retries exhausted", lastError)
  return null
}

async function loadMinecraftVersions(): Promise<MinecraftVersionOption[] | null> {
  const fromMain = await withRetry(async () => {
    const versions = await window.electronAPI?.getMinecraftVersions()
    if (Array.isArray(versions) && versions.length > 0) {
      return versions
    }
    return null
  })
  if (fromMain && fromMain.length > 0) {
    return fromMain
  }

  const fromRenderer = await withRetry(() => fetchVersionsFromRenderer())
  if (fromRenderer && fromRenderer.length > 0) {
    return fromRenderer
  }

  return fromMain ?? null
}

function getMinecraftVersions(): Promise<MinecraftVersionOption[] | null> {
  if (cachedVersions) return Promise.resolve(cachedVersions)
  if (versionsPromise) return versionsPromise
  versionsPromise = loadMinecraftVersions().then((versions) => {
    versionsPromise = null
    if (versions && versions.length > 0) {
      cachedVersions = versions
    }
    return versions
  })
  return versionsPromise
}

export function useMinecraftVersionOptions() {
  const [allMinecraftVersions, setAllMinecraftVersions] = useState<MinecraftVersionOption[]>(() => cachedVersions ?? [])
  const [versionsLoaded, setVersionsLoaded] = useState(() => cachedVersions !== null)
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
      const versions = await getMinecraftVersions()
      if (!cancelled) {
        if (versions && versions.length > 0) {
          setAllMinecraftVersions(versions)
          setVersionsLoaded(true)
        } else {
          setVersionsLoaded(true)
        }
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
