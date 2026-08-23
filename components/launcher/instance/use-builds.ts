import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MOD_LOADERS } from "./constants"
import { loadBuilds, pickCompatibleVersion } from "./utils"
import type { Build, BuildMod, ModSearchResult, ModDependency, ModVersion } from "./types"
import type { BuildExportCategory } from "@xnlc/types"
import { enrichBuildModNames } from "@/lib/modrinth-metadata"

type BuildContentListKey = "mods" | "resourcepacks" | "shaders"
type BuildContentKind = "mod" | "resourcepack" | "shader"

const CONTENT_KIND_BY_KEY: Record<BuildContentListKey, BuildContentKind> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaders: "shader",
}

export function useBuilds() {
  const [buildsState, setBuildsState] = useState<Build[]>(loadBuilds)
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const [buildsHydrated, setBuildsHydrated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<number | null>(null)
  const buildsRef = useRef<Build[]>(buildsState)
  const isReloadingRef = useRef(false)
  const reloadSeqRef = useRef(0)
  const lastSavedSnapshotRef = useRef("")

  const setBuilds = useCallback<React.Dispatch<React.SetStateAction<Build[]>>>((value) => {
    setBuildsState(prev => {
      const next = typeof value === "function" ? value(prev) : value
      buildsRef.current = next
      return next
    })
  }, [])

  const builds = buildsState

  const syncBuildContent = useCallback(async (build: Build): Promise<Build> => {
    try {
      const targetPath = build.intentPath?.trim() || build.name
      await window.electronAPI?.getBuildIntentPath(targetPath)
      const scanned = await window.electronAPI?.scanBuildIntentContent?.(targetPath)
      if (!scanned) return build

      const mergeContent = (existing: BuildMod[], incoming: BuildMod[]) => {
        const normalize = (value?: string) => value?.trim().toLowerCase() ?? ""
        const existingBySlug = new Map(existing.map(item => [item.slug.toLowerCase(), item]))
        const existingByName = new Map(existing.map(item => [item.name.toLowerCase(), item]))

        return incoming.map(item => {
          const incomingSlug = normalize(item.slug)
          const incomingName = normalize(item.name)
          const matched = existingBySlug.get(incomingSlug)
            ?? existingByName.get(incomingName)
            ?? existing.find(existingItem => {
              const existingSlug = normalize(existingItem.slug)
              const existingName = normalize(existingItem.name)
              return existingSlug === incomingSlug
                || existingName === incomingName
                || existingSlug.includes(incomingName)
                || incomingSlug.includes(existingName)
            })

          if (!matched) return item
          return {
            ...item,
            slug: matched.slug || item.slug,
            name: item.name && item.name.length > 1 ? item.name : matched.name || item.name,
            description: matched.description || item.description,
            icon_url: matched.icon_url || item.icon_url,
            source: item.source && item.source !== "local" ? item.source : matched.source ?? item.source,
            projectId: item.projectId ?? matched.projectId,
            modId: item.modId ?? matched.modId,
            author: matched.author || item.author,
            version: item.version && item.version !== "local"
              ? item.version
              : matched.version && matched.version !== "local"
                ? matched.version
                : item.version,
          }
        })
      }

      return {
        ...build,
        mods: Array.isArray(scanned.mods) ? mergeContent(build.mods, scanned.mods) : build.mods,
        resourcepacks: Array.isArray(scanned.resourcepacks) ? mergeContent(build.resourcepacks, scanned.resourcepacks) : build.resourcepacks,
        shaders: Array.isArray(scanned.shaders) ? mergeContent(build.shaders, scanned.shaders) : build.shaders,
        installedMods: scanned.installedMods ?? build.installedMods ?? {},
      }
    } catch {
      return build
    }
  }, [])

  const reloadBuilds = useCallback(async () => {
    // Flush pending save before reloading so in-memory changes aren't lost.
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      void window.electronAPI?.saveBuilds(buildsRef.current as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
      lastSavedSnapshotRef.current = JSON.stringify(buildsRef.current)
    }

    isReloadingRef.current = true
    const seq = ++reloadSeqRef.current
    try {
      const dbBuilds = await window.electronAPI?.loadBuilds()
      if (!dbBuilds?.length) {
        setBuilds([])
        return
      }

      const processed = dbBuilds.map(build => {
        const b = build as Build
        const inMemoryBuild = buildsRef.current.find(existing => existing.id === build.id || existing.name === build.name)
        const normalized = {
          ...build,
          mods: Array.isArray(b.mods) ? b.mods : inMemoryBuild?.mods ?? [],
          resourcepacks: Array.isArray(b.resourcepacks) ? b.resourcepacks : inMemoryBuild?.resourcepacks ?? [],
          shaders: Array.isArray(b.shaders) ? b.shaders : inMemoryBuild?.shaders ?? [],
          intentPath: b.intentPath ?? inMemoryBuild?.intentPath ?? "",
          installedMods: b.installedMods ?? inMemoryBuild?.installedMods ?? {},
        } as Build

        // Preserve fresh in-memory metadata during immediate reloads after install.
        if (inMemoryBuild) {
          normalized.mods = inMemoryBuild.mods
          normalized.resourcepacks = inMemoryBuild.resourcepacks
          normalized.shaders = inMemoryBuild.shaders
          normalized.installedMods = inMemoryBuild.installedMods ?? normalized.installedMods
        }

        return normalized
      })

      // Устанавливаем сборки сразу — UI отрисовывается без ожидания сканирования
      setBuilds(processed)

      // Синхронизация контента в фоне — обновляет сборки по мере готовности.
      // Гвардия поколений: если с момента старта был запущен новый reload,
      // результат устаревшего скана отбрасываем — иначе зависший на 429 платформы
      // скан может «воскресить» только что удалённый мод.
      void Promise.all(processed.map(async (normalized) => {
        const synced = await syncBuildContent(normalized)
        if (seq !== reloadSeqRef.current) return
        setBuilds(prev => prev.map(b => b.id === synced.id ? synced : b))
      })).then(() => {
        if (seq !== reloadSeqRef.current) return
        // Сигнализируем что первичная загрузка завершена — splash можно убрать
        setBuildsHydrated(true)
        window.dispatchEvent(new Event("app:hydrated"))
      })

      // Enrich Modrinth names/authors in the background — don't block the
      // initial render with network requests. Results are cached module-wide
      // and batched, so repeat reloads are cheap or hit the cache entirely.
      void (async () => {
        const enriched = await Promise.all(processed.map(async build => {
          const [mods, rp, sh] = await Promise.all([
            enrichBuildModNames(build.mods),
            enrichBuildModNames(build.resourcepacks),
            enrichBuildModNames(build.shaders),
          ])
          return { ...build, mods, resourcepacks: rp, shaders: sh }
        }))

        if (seq !== reloadSeqRef.current) return

        const enrichedById = new Map(enriched.map(build => [build.id, build]))
        setBuilds(prev => prev.map(current => {
          const rich = enrichedById.get(current.id)
          if (!rich) return current
          const patchList = (list: BuildMod[], richList: BuildMod[]) => {
            const richBySlug = new Map(richList.map(item => [item.slug.toLowerCase(), item]))
            return list.map(item => {
              const enrichedItem = richBySlug.get(item.slug.toLowerCase())
              return enrichedItem
                ? { ...item, name: enrichedItem.name || item.name, author: enrichedItem.author || item.author }
                : item
            })
          }
          return {
            ...current,
            mods: patchList(current.mods, rich.mods),
            resourcepacks: patchList(current.resourcepacks, rich.resourcepacks),
            shaders: patchList(current.shaders, rich.shaders),
          }
        }))
      })()
    } finally {
      isReloadingRef.current = false
    }
  }, [syncBuildContent])

  const activeBuild = useMemo(() => builds.find(b => b.id === activeBuildId) ?? null, [builds, activeBuildId])

  useEffect(() => {
    void reloadBuilds()
  }, [reloadBuilds])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.type === "build") {
        void reloadBuilds()
      }
    }
    window.addEventListener("cloud:imported", handler)
    return () => window.removeEventListener("cloud:imported", handler)
  }, [reloadBuilds])

  useEffect(() => {
    if (!buildsHydrated || isReloadingRef.current) {
      return
    }

    const nextSnapshot = JSON.stringify(builds)
    if (lastSavedSnapshotRef.current === nextSnapshot) {
      return
    }

    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      lastSavedSnapshotRef.current = nextSnapshot
      void window.electronAPI?.saveBuilds(builds as unknown as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
    }, 200)
  }, [builds, buildsHydrated])

  useEffect(() => () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const createBuild = useCallback(async (params: { name: string; description: string; version: string; modLoader: string; loaderVersion?: string; icon: string }) => {
    const trimmedName = params.name.trim()
    if (!trimmedName) return
    const id = crypto.randomUUID()
    let intentPath = ""
    try {
      intentPath = await window.electronAPI?.getBuildIntentPath(trimmedName) ?? ""
      await window.electronAPI?.setBuildIntentPath(trimmedName, intentPath)
    } catch {}
    setBuilds(prev => [{
      id, name: trimmedName, description: params.description.trim(),
      version: params.version, modLoader: params.modLoader, loaderVersion: params.loaderVersion,
      icon: params.icon, coverImage: params.icon || undefined,
      mods: [], resourcepacks: [], shaders: [],
      createdAt: new Date().toISOString(), source: "local",
      intentPath, installedMods: {}, playtime: 0,
    }, ...prev])
  }, [])

  const deleteBuild = useCallback(async (id: string) => {
    const build = builds.find(b => b.id === id)
    if (build) {
      try {
        await window.electronAPI?.deleteBuildIntent(build.name)
      } catch {}
    }
    setBuilds(prev => prev.filter(b => b.id !== id))
    setActiveBuildId(prev => prev === id ? null : prev)
  }, [builds])

  type TrashSnapshot = {
    build: Build
    trashName?: string
  }
  const trashStackRef = useRef<TrashSnapshot[]>([])

  const trashBuild = useCallback(async (id: string): Promise<boolean> => {
    const build = builds.find(b => b.id === id)
    if (!build) return false
    let trashName: string | undefined
    try {
      const result = await window.electronAPI?.moveBuildIntentToTrash?.(build.name)
      trashName = result?.trashName
    } catch {}
    trashStackRef.current.push({ build, trashName })
    if (trashStackRef.current.length > 30) {
      trashStackRef.current.shift()
    }
    setBuilds(prev => prev.filter(b => b.id !== id))
    setActiveBuildId(prev => prev === id ? null : prev)
    return true
  }, [builds])

  const undoTrashBuild = useCallback(async (): Promise<Build | null> => {
    const snapshot = trashStackRef.current.pop()
    if (!snapshot) return null
    const { build, trashName } = snapshot
    if (trashName) {
      try { await window.electronAPI?.restoreBuildIntentFromTrash?.(build.name, trashName) } catch {}
    }
    setBuilds(prev => [build, ...prev])
    setActiveBuildId(build.id)
    return build
  }, [])

  const purgeBuildTrash = useCallback(async (): Promise<void> => {
    trashStackRef.current = []
    try { await window.electronAPI?.purgeBuildTrash?.() } catch {}
  }, [])

  const duplicateBuild = useCallback(async (id: string): Promise<Build | null> => {
    const source = builds.find(b => b.id === id)
    if (!source) return null
    const baseName = `${source.name} (копия)`
    let newName = baseName
    let counter = 2
    while (builds.some(b => b.name === newName)) {
      newName = `${source.name} (копия ${counter})`
      counter++
    }
    const newBuild: Build = {
      ...source,
      id: crypto.randomUUID(),
      name: newName,
      createdAt: new Date().toISOString(),
      mods: source.mods.map(m => ({ ...m, id: crypto.randomUUID() })),
      resourcepacks: source.resourcepacks.map(m => ({ ...m, id: crypto.randomUUID() })),
      shaders: source.shaders.map(m => ({ ...m, id: crypto.randomUUID() })),
    }
    try {
      const result = await window.electronAPI?.copyBuild?.(source.name, newName)
      if (result?.success) {
        newBuild.intentPath = result.intentPath ?? newBuild.intentPath
      }
    } catch {}
    setBuilds(prev => [newBuild, ...prev])
    return newBuild
  }, [builds])

  const exportBuildZip = useCallback(async (id: string, categories?: BuildExportCategory[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: "Сборка не найдена" }
    return await window.electronAPI?.exportBuildZip?.(build.name, build.name, categories) ?? { success: false, error: "Функция недоступна" }
  }, [builds])

  const exportBuildModlist = useCallback(async (id: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"): Promise<{ success: boolean; path?: string; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: "Сборка не найдена" }
    return await window.electronAPI?.exportBuildModlist?.(build.name, build.name, format) ?? { success: false, error: "Функция недоступна" }
  }, [builds])

  const renameBuild = useCallback(async (id: string, newName: string): Promise<{ success: boolean; error?: string }> => {
    const build = builds.find(b => b.id === id)
    if (!build) return { success: false, error: "Сборка не найдена" }
    const target = newName.trim()
    if (!target) return { success: false, error: "Имя сборки не может быть пустым" }
    if (target === build.name) return { success: true }
    if (builds.some(b => b.id !== id && b.name === target)) {
      return { success: false, error: "Сборка с таким именем уже существует" }
    }
    try {
      const result = await window.electronAPI?.renameBuildIntent?.(build.name, target)
      if (result?.success) {
        setBuilds(prev => prev.map(b => b.id === id
          ? { ...b, name: target, intentPath: result.intentPath ?? b.intentPath }
          : b))
        return { success: true }
      }
      return { success: false, error: result?.error ?? "Не удалось переименовать сборку" }
    } catch {
      return { success: false, error: "Не удалось переименовать сборку" }
    }
  }, [builds, setBuilds])

  const updateBuild = useCallback((id: string, fields: Partial<Build>) => {
    setBuilds(prev => prev.map(b => b.id === id ? { ...b, ...fields } : b))
  }, [])

  const setBuildGroup = useCallback((id: string, group: string) => {
    setBuilds(prev => prev.map(b => b.id === id ? { ...b, group: group || undefined } : b))
  }, [])

  const renameGroup = useCallback((oldName: string, newName: string) => {
    setBuilds(prev => prev.map(b => b.group === oldName ? { ...b, group: newName || undefined } : b))
  }, [])

  const deleteGroup = useCallback((group: string) => {
    setBuilds(prev => prev.map(b => b.group === group ? { ...b, group: undefined } : b))
  }, [])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleGroupCollapse = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const b of builds) { if (b.group) set.add(b.group) }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [builds])

  const addModToBuild = useCallback(async (buildId: string, mod: ModSearchResult) => {
    const targetBuild = builds.find(b => b.id === buildId)
    const buildName = targetBuild?.name
    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId || b.mods.some(m => m.slug === mod.slug || m.name === mod.name)) return b
      return {
        ...b,
        installedMods: { ...(b.installedMods ?? {}), [mod.slug]: "" },
        mods: [...b.mods, {
          id: crypto.randomUUID(),
          slug: mod.slug,
          name: mod.name,
          description: mod.summary,
          icon_url: mod.iconUrl,
          version: "latest",
          source: mod.source,
          projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : undefined),
          modId: mod.modId,
          author: mod.author,
        }],
      }
    }))
    if (!buildName) return

    const saveRemoteFileToBuild = async (url: string, fileName: string) => {
      return await window.electronAPI?.saveModToIntent(buildName, url, fileName)
    }

    const downloadDependency = async (dep: ModDependency, source: string) => {
      if (dep.dependencyType !== "required" || !dep.projectId) return
      try {
        if (source === "modrinth") {
          const versions = await window.electronAPI?.modsModrinthVersions(dep.projectId)
          const latestVersion = targetBuild ? pickCompatibleVersion(versions, targetBuild) : versions?.find(v => v.files?.[0]?.url)
          if (latestVersion?.files?.[0]?.url) {
            await saveRemoteFileToBuild(latestVersion.files[0].url, latestVersion.files[0].filename || `${dep.projectId}.jar`)
          }
          return
        }

        const depModId = parseInt(dep.projectId)
        if (isNaN(depModId)) return
        const details = await window.electronAPI?.modsCurseforgeDetails(depModId)
        const selectedVersion = targetBuild ? pickCompatibleVersion(details?.versions ?? [], targetBuild) : details?.versions?.[0]
        if (!selectedVersion) return

        const fileId = Number(selectedVersion.id)
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(fileId, depModId)
        if (url) {
          const fileName = selectedVersion.fileName || url.split("/").pop()?.split("?")[0] || `${dep.projectId}.jar`
          await saveRemoteFileToBuild(url, fileName)
        }
      } catch {}
    }

    void (async () => {
      try {
        if (mod.source === "modrinth") {
          const versions = await window.electronAPI?.modsModrinthVersions(mod.slug)
          const selectedVersion = targetBuild ? pickCompatibleVersion(versions, targetBuild) : versions?.find(version => version.files?.[0]?.url)
          if (!selectedVersion?.files?.[0]?.url) return

          const file = selectedVersion.files[0]
          const savedFileName = file.filename || `${mod.slug}-${selectedVersion.id}.jar`
          const savedPath = await saveRemoteFileToBuild(file.url, savedFileName)
          if (savedPath) {
            setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : {
              ...bb,
              installedMods: {
                ...(bb.installedMods ?? {}),
                [savedFileName]: savedPath,
              },
              mods: bb.mods.map(existing => existing.slug === mod.slug || existing.name === mod.name
                ? {
                    ...existing,
                    slug: savedFileName,
                    version: selectedVersion.name || selectedVersion.id || existing.version,
                    source: mod.source,
                    projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : existing.projectId),
                    modId: mod.modId ?? existing.modId,
                  }
                : existing),
            }))
          }

          const deps = await window.electronAPI?.modsResolveDependencies(selectedVersion, "modrinth") ?? []
          for (const dep of deps) {
            await downloadDependency(dep, "modrinth")
          }
        } else {
          if (!mod.modId) return
          const details = await window.electronAPI?.modsCurseforgeDetails(mod.modId)
          const selectedVersion = targetBuild
            ? pickCompatibleVersion(details?.versions ?? [], targetBuild)
            : details?.versions?.find(version => Number(version.id) === mod.primaryFileId) ?? details?.versions?.[0]
          if (!selectedVersion) return

          const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), mod.modId)
          if (!url) return

          const fileName = selectedVersion.fileName || mod.primaryFileName || url.split("/").pop()?.split("?")[0] || `mod-${selectedVersion.id}.jar`
          const savedPath = await saveRemoteFileToBuild(url, fileName)
          if (savedPath) {
            setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : {
              ...bb,
              installedMods: {
                ...(bb.installedMods ?? {}),
                [fileName]: savedPath,
              },
              mods: bb.mods.map(existing => existing.slug === mod.slug || existing.name === mod.name
                ? {
                    ...existing,
                    slug: fileName,
                    version: selectedVersion.name || selectedVersion.id || existing.version,
                    source: mod.source,
                    projectId: mod.projectId ?? existing.projectId,
                    modId: mod.modId ?? existing.modId,
                  }
                : existing),
            }))
          }

          const deps = await window.electronAPI?.modsResolveDependencies(selectedVersion, "curseforge") ?? []
          for (const dep of deps) {
            await downloadDependency(dep, "curseforge")
          }
        }

        setBuilds(pp => pp.map(bb => bb.id !== buildId ? bb : {
          ...bb,
          mods: bb.mods,
          resourcepacks: bb.resourcepacks,
          shaders: bb.shaders,
        }))
        void reloadBuilds()
      } catch {}
    })()
  }, [builds, reloadBuilds])

  const addLocalModToBuild = useCallback(async (buildId: string, file: File) => {
    const modName = file.name.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    const localPath = window.electronAPI?.getFilePath(file)
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
    void reloadBuilds()
  }, [builds, reloadBuilds])

  const addContentToBuild = useCallback(async (buildId: string, type: Exclude<BuildContentListKey, "mods">, mod: ModSearchResult) => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return

    const versions = mod.source === "modrinth"
      ? await window.electronAPI?.modsModrinthVersions(mod.slug)
      : mod.modId
        ? await window.electronAPI?.modsCurseforgeDetails(mod.modId).then(details => details?.versions ?? [])
        : []

    const selectedVersion = mod.source === "modrinth"
      ? versions?.find(version => version.files?.[0]?.url)
      : versions?.find(version => Number(version.id) === mod.primaryFileId) ?? versions?.[0]

    let fileUrl = ""
    let fileName = ""

    if (mod.source === "modrinth") {
      const file = selectedVersion?.files?.[0]
      fileUrl = file?.url ?? ""
      fileName = file?.filename || selectedVersion?.fileName || `${mod.slug}.jar`
    } else if (mod.modId && selectedVersion) {
      fileUrl = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), mod.modId) ?? ""
      fileName = selectedVersion.fileName || mod.primaryFileName || fileUrl.split("/").pop()?.split("?")[0] || `${mod.slug}.jar`
    }

    if (!fileUrl) return

    const savedPath = await window.electronAPI?.saveContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], fileUrl, fileName)
    if (!savedPath) return

    const fallbackEntry: BuildMod = {
      id: crypto.randomUUID(),
      slug: fileName,
      name: mod.name,
      description: mod.summary,
      icon_url: mod.iconUrl,
      version: "local",
      source: mod.source,
      projectId: mod.projectId ?? (mod.source === "modrinth" ? mod.id : undefined),
      modId: mod.modId,
      author: mod.author,
    }

    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId) return b
      if (b[type].some(item => item.slug === fileName || item.slug === mod.slug)) return b
      return {
        ...b,
        [type]: [...b[type], fallbackEntry],
      }
    }) as Build[])
    void reloadBuilds()
  }, [builds, reloadBuilds])

  const addLocalContentToBuild = useCallback(async (buildId: string, type: Exclude<BuildContentListKey, "mods">, file: File) => {
    const build = builds.find(b => b.id === buildId)
    const localPath = window.electronAPI?.getFilePath(file)
    if (!build?.name || !localPath) return

    const savedPath = await window.electronAPI?.saveLocalContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], localPath)
    if (!savedPath) return

    const itemName = file.name.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    const fallbackEntry: BuildMod = {
      id: crypto.randomUUID(),
      slug: file.name,
      name: itemName,
      description: type === "resourcepacks" ? "Локальный ресурспак" : "Локальный шейдер",
      version: "local",
    }

    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId) return b
      if (b[type].some(item => item.slug === file.name)) return b
      return {
        ...b,
        [type]: [...b[type], fallbackEntry],
      }
    }) as Build[])
    void reloadBuilds()
  }, [builds, reloadBuilds])

  const removeContentFromBuild = useCallback(async (buildId: string, type: BuildContentListKey, item: BuildMod) => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return false

    const result = await window.electronAPI?.deleteContentFromIntent?.(build.name, CONTENT_KIND_BY_KEY[type], item.slug)
    if (!result?.success) return false

    setBuilds(prev => prev.map(b => {
      if (b.id !== buildId) return b
      const nextInstalledMods = { ...(b.installedMods ?? {}) }
      if (type === "mods") {
        delete nextInstalledMods[item.slug]
      }
      return {
        ...b,
        [type]: b[type].filter(existing => existing.slug !== item.slug && existing.id !== item.id),
        installedMods: type === "mods" ? nextInstalledMods : b.installedMods,
      }
    }) as Build[])
    void reloadBuilds()
    return true
  }, [builds, reloadBuilds])

  const toggleItemEnabled = useCallback(async (buildId: string, type: BuildContentListKey, itemId: string) => {
    const build = builds.find(b => b.id === buildId)
    const item = build?.[type].find(entry => entry.id === itemId)
    if (!build || !item) return false

    const enabled = !(item.enabled ?? true)
    const result = await window.electronAPI?.setContentEnabled?.(build.name, CONTENT_KIND_BY_KEY[type], item.slug, enabled)
    if (!result?.success) return false

    setBuilds(prev => prev.map(b => b.id !== buildId ? b : {
      ...b,
      [type]: b[type].map(entry => entry.id === itemId
        ? { ...entry, enabled }
        : entry),
    }) as Build[])
    return true
  }, [builds])

  const updateItemVersion = useCallback(async (buildId: string, type: BuildContentListKey, itemId: string, newVersion: ModVersion): Promise<boolean> => {
    const build = builds.find(b => b.id === buildId)
    if (!build?.name) return false

    const file = newVersion.files?.[0]
    if (!file?.url) return false

    const newFileName = file.filename || `${newVersion.id}.jar`
    const oldItem = build[type].find(m => m.id === itemId)

    try {
      const savedPath = type === "mods"
        ? await window.electronAPI?.saveModToIntent?.(build.name, file.url, newFileName)
        : await window.electronAPI?.saveContentToIntent?.(build.name, CONTENT_KIND_BY_KEY[type], file.url, newFileName)

      if (!savedPath) return false

      // Удаляем старую версию файла, иначе в папке останется дубликат
      if (oldItem && oldItem.slug !== newFileName) {
        try {
          await window.electronAPI?.deleteContentFromIntent?.(build.name, CONTENT_KIND_BY_KEY[type], oldItem.slug)
        } catch {}
      }

      setBuilds(prev => prev.map(b => {
        if (b.id !== buildId) return b
        const nextInstalledMods = { ...(b.installedMods ?? {}) }
        if (oldItem) delete nextInstalledMods[oldItem.slug]
        nextInstalledMods[newFileName] = savedPath

        return {
          ...b,
          installedMods: nextInstalledMods,
          [type]: b[type].map(m =>
            m.id === itemId ? {
              ...m,
              slug: newFileName,
              version: newVersion.name || newVersion.id || m.version,
            } : m
          ),
        }
      }))
      void reloadBuilds()
      return true
    } catch {
      return false
    }
  }, [builds, reloadBuilds])

  return { builds, setBuilds, activeBuildId, setActiveBuildId, activeBuild, fileInputRef, createBuild, deleteBuild, trashBuild, undoTrashBuild, purgeBuildTrash, duplicateBuild, renameBuild, exportBuildZip, exportBuildModlist, setBuildGroup, renameGroup, deleteGroup, collapsedGroups, toggleGroupCollapse, groups, updateBuild, addModToBuild, addLocalModToBuild, addContentToBuild, addLocalContentToBuild, removeContentFromBuild, reloadBuilds, toggleItemEnabled, updateItemVersion }
}
