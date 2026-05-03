import { useCallback, useEffect, useState } from "react"
import { VERSIONS, MOD_LOADERS } from "./constants"
import type { Build, ModSearchResult } from "./types"

export function useImport(setBuilds: React.Dispatch<React.SetStateAction<Build[]>>, setView: (v: "my") => void) {
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [downloadingSlug, setDownloadingSlug] = useState<string | null>(null)
  const [cfDownloadingId, setCfDownloadingId] = useState<number | null>(null)

  useEffect(() => {
    const off = window.electronAPI?.onImportProgress(p => {
      setImportProgress({ current: p.current, total: p.total, message: p.message })
    })
    return () => off?.()
  }, [])

  const downloadFromModrinth = useCallback(async (project: ModSearchResult) => {
    setDownloadingSlug(project.slug)
    setImportProgress({ current: 0, total: 1, message: "Подготовка..." })
    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${project.slug}/version?limit=20`)
      const versionsData = await res.json()
      const latest = Array.isArray(versionsData) ? versionsData : []
      const latestVersion = latest.find((item: any) => item.game_versions?.length || item.loaders?.length)
      const selVersion = latestVersion?.game_versions?.[0] ?? VERSIONS[0]
      const selLoader = latestVersion?.loaders?.find((l: string) => MOD_LOADERS.some(item => item.id === l)) ?? "vanilla"

      const id = crypto.randomUUID()
      let intentPath = ""
      try { intentPath = await window.electronAPI?.getBuildIntentPath(project.name) ?? ""; await window.electronAPI?.setBuildIntentPath(project.name) } catch {}

      const importResult = await window.electronAPI?.importModrinthModpack(project.name, project.slug)
      if (importResult && !importResult.success) throw new Error(importResult.error ?? "Ошибка импорта")

      setBuilds(prev => [{
        id, name: project.name, description: project.summary,
        version: importResult?.version ?? selVersion,
        modLoader: importResult?.modLoader ?? selLoader,
        icon: project.iconUrl ?? "", coverImage: project.iconUrl ?? undefined,
        mods: [], resourcepacks: [], shaders: [],
        createdAt: new Date().toISOString(), source: "modrinth",
        projectSlug: project.slug, intentPath, installedMods: {},
      }, ...prev])
      setView("my")
    } catch (error) {
      setImportProgress({ current: 0, total: 1, message: error instanceof Error ? error.message : "Ошибка импорта" })
    } finally {
      setDownloadingSlug(null)
      setTimeout(() => setImportProgress(null), 1500)
    }
  }, [setBuilds, setView])

  const downloadFromCurseforge = useCallback(async (pack: ModSearchResult) => {
    setCfDownloadingId(pack.modId)
    setImportProgress({ current: 0, total: 1, message: "Подготовка..." })
    try {
      const id = crypto.randomUUID()
      let intentPath = ""
      try { intentPath = await window.electronAPI?.getBuildIntentPath(pack.name) ?? "" } catch {}

      const importResult = await window.electronAPI?.importCurseforgeModpack(pack.name, pack.modId, pack.primaryFileId)
      if (importResult && !importResult.success) throw new Error(importResult.error ?? "Ошибка импорта")

      setBuilds(prev => [{
        id, name: pack.name, description: pack.summary,
        version: importResult?.version ?? VERSIONS[0],
        modLoader: importResult?.modLoader ?? "forge",
        icon: pack.iconUrl ?? "", coverImage: pack.iconUrl ?? undefined,
        mods: [], resourcepacks: [], shaders: [],
        createdAt: new Date().toISOString(), source: "curseforge",
        intentPath, installedMods: {},
      }, ...prev])
      setView("my")
    } catch (error) {
      setImportProgress({ current: 0, total: 1, message: error instanceof Error ? error.message : "Ошибка импорта" })
    } finally {
      setCfDownloadingId(null)
      setTimeout(() => setImportProgress(null), 1500)
    }
  }, [setBuilds, setView])

  const handleImportFile = useCallback(async () => {
    setImportError(null)
    setImportProgress({ current: 0, total: 1, message: "Открытие файла..." })
    try {
      const result = await window.electronAPI?.openAndImportModpack()
      if (!result) { setImportProgress(null); return }
      if (!result.success) {
        if (result.error !== "Импорт отменён") setImportError(result.error ?? "Ошибка")
        setImportProgress(null)
        return
      }
      setBuilds(prev => [{
        id: crypto.randomUUID(),
        name: result.name ?? "Импортированная сборка",
        description: result.description ?? "",
        version: result.version ?? VERSIONS[0],
        modLoader: result.modLoader ?? "vanilla",
        icon: result.icon ?? "", mods: [], resourcepacks: [], shaders: [],
        createdAt: new Date().toISOString(),
        source: result.source ?? "local",
        intentPath: result.intentPath ?? "",
        installedMods: {},
      }, ...prev])
      setView("my")
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Ошибка импорта")
    } finally {
      setTimeout(() => { setImportProgress(null); setImportError(null) }, 3000)
    }
  }, [setBuilds, setView])

  return { importProgress, importError, downloadingSlug, cfDownloadingId, downloadFromModrinth, downloadFromCurseforge, handleImportFile }
}
