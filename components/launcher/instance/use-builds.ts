import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { VERSIONS, MOD_LOADERS } from "./constants"
import { loadBuilds } from "./utils"
import type { Build, BuildMod, ModSearchResult, DetailTab } from "./types"

export function useBuilds() {
  const [builds, setBuilds] = useState<Build[]>(loadBuilds)
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeBuild = useMemo(() => builds.find(b => b.id === activeBuildId) ?? null, [builds, activeBuildId])

  useEffect(() => {
    void window.electronAPI?.loadBuilds().then(async dbBuilds => {
      if (!dbBuilds?.length) return
      const processed = await Promise.all(dbBuilds.map(async build => {
        try { await window.electronAPI?.getBuildIntentPath(build.name) } catch {}
        const b = build as any
        return {
          ...build,
          mods: Array.isArray(b.mods) ? b.mods : [],
          resourcepacks: Array.isArray(b.resourcepacks) ? b.resourcepacks : [],
          shaders: Array.isArray(b.shaders) ? b.shaders : [],
          intentPath: b.intentPath ?? "",
          installedMods: b.installedMods ?? {},
        } as Build
      }))
      setBuilds(processed)
    })
  }, [])

  useEffect(() => {
    void window.electronAPI?.saveBuilds(builds as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
  }, [builds])

  const createBuild = useCallback(async (params: { name: string; description: string; version: string; modLoader: string; icon: string }) => {
    const trimmedName = params.name.trim()
    if (!trimmedName) return
    const id = crypto.randomUUID()
    let intentPath = ""
    try {
      intentPath = await window.electronAPI?.getBuildIntentPath(trimmedName) ?? ""
      await window.electronAPI?.setBuildIntentPath(trimmedName)
    } catch {}
    setBuilds(prev => [{
      id, name: trimmedName, description: params.description.trim(),
      version: params.version, modLoader: params.modLoader,
      icon: params.icon, coverImage: params.icon || undefined,
      mods: [], resourcepacks: [], shaders: [],
      createdAt: new Date().toISOString(), source: "local",
      intentPath, installedMods: {},
    }, ...prev])
  }, [])

  const deleteBuild = useCallback((id: string) => {
    setBuilds(prev => prev.filter(b => b.id !== id))
    setActiveBuildId(prev => prev === id ? null : prev)
  }, [])

  const updateBuild = useCallback((id: string, fields: Partial<Build>) => {
    setBuilds(prev => prev.map(b => b.id === id ? { ...b, ...fields } : b))
  }, [])

  const addModToBuild = useCallback(async (buildId: string, mod: ModSearchResult) => {
    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId || b.mods.some(m => m.slug === mod.slug)) return b
      return {
        ...b,
        installedMods: { ...(b.installedMods ?? {}), [mod.slug]: "" },
        mods: [...b.mods, { id: crypto.randomUUID(), slug: mod.slug, name: mod.name, description: mod.summary, icon_url: mod.iconUrl, version: "latest" }],
      }
    }))
    setBuilds(prev => {
      const buildName = prev.find(b => b.id === buildId)?.name
      if (!buildName) return prev
      void (async () => {
        try {
          const verRes = await fetch(`https://api.modrinth.com/v2/project/${mod.slug}/version`)
          const versions = await verRes.json()
          const ver = Array.isArray(versions) ? versions[0] : null
          if (ver?.files?.[0]) {
            const file = ver.files[0]
            const savedPath = await window.electronAPI?.saveModToIntent(buildName, file.url, `${mod.slug}-${ver.id}.jar`)
            if (savedPath) {
              setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : { ...bb, installedMods: { ...(bb.installedMods ?? {}), [mod.slug]: savedPath } }))
            }
          }
        } catch {}
      })()
      return prev
    })
  }, [])

  const addLocalModToBuild = useCallback(async (buildId: string, file: File) => {
    const modName = file.name.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    const localPath = (file as File & { path?: string }).path
    let savedPath = ""
    const buildName = builds.find(b => b.id === buildId)?.name
    if (localPath && buildName) {
      try { savedPath = await window.electronAPI?.saveLocalModToIntent(buildName, localPath) ?? "" } catch {}
    }
    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId || b.mods.some(m => m.slug === file.name)) return b
      return {
        ...b,
        installedMods: { ...(b.installedMods ?? {}), [file.name]: savedPath },
        mods: [...b.mods, { id: crypto.randomUUID(), slug: file.name, name: modName, description: "Локальный мод", version: "local" }],
      }
    }))
  }, [builds])

  return { builds, setBuilds, activeBuildId, setActiveBuildId, activeBuild, fileInputRef, createBuild, deleteBuild, updateBuild, addModToBuild, addLocalModToBuild }
}
