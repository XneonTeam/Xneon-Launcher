import { useCallback, useEffect, useRef, useState } from "react"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { MOD_LOADERS } from "./constants"
import type { Build, ModSearchResult } from "./types"

export interface ImportProgressState {
  current: number
  total: number
  message: string
  source: "modrinth" | "curseforge" | "local"
  itemName?: string
}

async function persistImportedBuild(build: Build) {
  const existing = await window.electronAPI?.loadBuilds() ?? []
  const next = [build, ...existing.filter(item => item.id !== build.id && item.name !== build.name)]
  await window.electronAPI?.saveBuilds(next as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
}

function getImportSourceLabel(source: ImportProgressState["source"]): string {
  if (source === "modrinth") return "Импорт с Modrinth"
  if (source === "curseforge") return "Импорт с CurseForge"
  return "Импорт из файла"
}

export function useImport(setBuilds: React.Dispatch<React.SetStateAction<Build[]>>, setView: (v: "my") => void) {
  const { pushNotification, startImportSession, clearImportSession } = useActivityCenter()
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isCancellingImport, setIsCancellingImport] = useState(false)
  const [downloadingSlug, setDownloadingSlug] = useState<string | null>(null)
  const [cfDownloadingId, setCfDownloadingId] = useState<number | null>(null)
  const isMountedRef = useRef(true)
  const activeImportSourceRef = useRef<ImportProgressState["source"] | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const safeSetImportProgress = useCallback((value: React.SetStateAction<ImportProgressState | null>) => {
    if (!isMountedRef.current) return
    setImportProgress(value)
  }, [])

  const safeSetImportError = useCallback((value: React.SetStateAction<string | null>) => {
    if (!isMountedRef.current) return
    setImportError(value)
  }, [])

  const clearProgressLater = useCallback((delay: number, clearError = false) => {
    window.setTimeout(() => {
      if (!isMountedRef.current) return
      setImportProgress(null)
      if (clearError) setImportError(null)
    }, delay)
  }, [])

  useEffect(() => {
    const off = window.electronAPI?.onImportProgress((progress) => {
      const source = activeImportSourceRef.current
      if (!source) return
      safeSetImportProgress({
        current: progress.current,
        total: progress.total,
        message: progress.message,
        source,
        itemName: progress.itemName,
      })
    })
    return () => off?.()
  }, [safeSetImportProgress])

  const beginImportSession = useCallback((source: ImportProgressState["source"]) => {
    activeImportSourceRef.current = source
    startImportSession(source)
    safeSetImportError(null)
  }, [safeSetImportError, startImportSession])

  const finishImportSession = useCallback(() => {
    activeImportSourceRef.current = null
    clearImportSession()
  }, [clearImportSession])

  useEffect(() => {
    if (!importError) return
    finishImportSession()
    pushNotification({
      kind: "error",
      source: "import",
      title: "Не удалось импортировать сборку",
      message: importError,
    })
  }, [finishImportSession, importError, pushNotification])

  const applyImportedBuild = useCallback(async (build: Build) => {
    await persistImportedBuild(build)
    finishImportSession()
    pushNotification({
      kind: "success",
      source: "import",
      title: "Сборка импортирована",
      message: build.name,
    })
    if (isMountedRef.current) {
      setBuilds(prev => [build, ...prev.filter(item => item.id !== build.id && item.name !== build.name)])
      setView("my")
    }
  }, [finishImportSession, pushNotification, setBuilds, setView])

  const cancelImport = useCallback(async () => {
    if (!importProgress) return

    const source = activeImportSourceRef.current ?? importProgress.source
    setIsCancellingImport(true)
    try {
      await window.electronAPI?.cancelImportModpack?.()
      finishImportSession()
      safeSetImportError(null)
      safeSetImportProgress(null)
      pushNotification({
        kind: "info",
        source: "import",
        title: "Импорт отменен",
        message: `${getImportSourceLabel(source)} остановлен пользователем.`,
      })
      if (isMountedRef.current) {
        setDownloadingSlug(null)
        setCfDownloadingId(null)
      }
    } finally {
      if (isMountedRef.current) {
        setIsCancellingImport(false)
      }
    }
  }, [finishImportSession, importProgress, pushNotification, safeSetImportError, safeSetImportProgress])

  const importModrinthProject = useCallback(async (project: ModSearchResult, versionId?: string) => {
    beginImportSession("modrinth")
    setDownloadingSlug(project.slug)
    safeSetImportProgress({ current: 0, total: 1, message: "Подготовка к импорту...", source: "modrinth" })
    try {
      const response = await fetch(`https://api.modrinth.com/v2/project/${project.slug}/version?limit=20`)
      const versionsData = await response.json()
      const versions = Array.isArray(versionsData) ? versionsData : []
      const latestVersion = versions.find((item: { game_versions?: unknown[]; loaders?: unknown[] }) => item.game_versions?.length || item.loaders?.length)
      const selectedVersion = latestVersion?.game_versions?.[0] ?? ""
      const selectedLoader = latestVersion?.loaders?.find((loader: string) => MOD_LOADERS.some(item => item.id === loader)) ?? "vanilla"

      const id = crypto.randomUUID()
      let intentPath = ""
      try {
        intentPath = await window.electronAPI?.getBuildIntentPath(project.name) ?? ""
        await window.electronAPI?.setBuildIntentPath(project.name, intentPath)
      } catch {
        // ignore path preparation errors here, import will surface its own failure
      }

      const importResult = await window.electronAPI?.importModrinthModpack(project.name, project.slug, versionId)
      if (importResult?.cancelled) {
        finishImportSession()
        safeSetImportError(null)
        safeSetImportProgress(null)
        return
      }
      if (importResult && !importResult.success) throw new Error(importResult.error ?? "Ошибка импорта")

      await applyImportedBuild({
        id,
        name: project.name,
        description: project.summary,
        version: importResult?.version ?? selectedVersion,
        modLoader: importResult?.modLoader ?? selectedLoader,
        loaderVersion: importResult?.loaderVersion,
        icon: project.iconUrl ?? "",
        coverImage: project.iconUrl ?? undefined,
        mods: importResult?.mods ?? [],
        resourcepacks: importResult?.resourcepacks ?? [],
        shaders: importResult?.shaders ?? [],
        createdAt: new Date().toISOString(),
        source: "modrinth",
        projectSlug: project.slug,
        intentPath,
        installedMods: importResult?.installedMods ?? {},
        playtime: 0,
      })
    } catch (error) {
      safeSetImportError(error instanceof Error ? error.message : "Ошибка импорта")
      safeSetImportProgress({
        current: 0,
        total: 1,
        message: error instanceof Error ? error.message : "Ошибка импорта",
        source: "modrinth",
      })
    } finally {
      if (isMountedRef.current) {
        setDownloadingSlug(null)
      }
      clearProgressLater(1800)
    }
  }, [applyImportedBuild, beginImportSession, clearProgressLater, finishImportSession, safeSetImportError, safeSetImportProgress])

  const importCurseforgeProject = useCallback(async (pack: ModSearchResult, fileIdOverride?: number) => {
    beginImportSession("curseforge")
    setCfDownloadingId(pack.modId ?? null)
    safeSetImportProgress({ current: 0, total: 1, message: "Подготовка к импорту...", source: "curseforge" })
    try {
      const fileId = fileIdOverride ?? pack.primaryFileId
      if (!pack.modId || !fileId) {
        throw new Error("У модпака CurseForge нет данных для скачивания")
      }
      const id = crypto.randomUUID()
      let intentPath = ""
      try {
        intentPath = await window.electronAPI?.getBuildIntentPath(pack.name) ?? ""
      } catch {
        // ignore lookup error, import will fail clearly if needed
      }

      const importResult = await window.electronAPI?.importCurseforgeModpack(pack.name, pack.modId, fileId)
      if (importResult?.cancelled) {
        finishImportSession()
        safeSetImportError(null)
        safeSetImportProgress(null)
        return
      }
      if (importResult && !importResult.success) throw new Error(importResult.error ?? "Ошибка импорта")

      await applyImportedBuild({
        id,
        name: pack.name,
        description: pack.summary,
        version: importResult?.version ?? "",
        modLoader: importResult?.modLoader ?? "vanilla",
        loaderVersion: importResult?.loaderVersion,
        icon: pack.iconUrl ?? "",
        coverImage: pack.iconUrl ?? undefined,
        mods: importResult?.mods ?? [],
        resourcepacks: importResult?.resourcepacks ?? [],
        shaders: importResult?.shaders ?? [],
        createdAt: new Date().toISOString(),
        source: "curseforge",
        intentPath,
        installedMods: importResult?.installedMods ?? {},
        playtime: 0,
      })
    } catch (error) {
      safeSetImportError(error instanceof Error ? error.message : "Ошибка импорта")
      safeSetImportProgress({
        current: 0,
        total: 1,
        message: error instanceof Error ? error.message : "Ошибка импорта",
        source: "curseforge",
      })
    } finally {
      if (isMountedRef.current) {
        setCfDownloadingId(null)
      }
      clearProgressLater(1800)
    }
  }, [applyImportedBuild, beginImportSession, clearProgressLater, finishImportSession, safeSetImportError, safeSetImportProgress])

  const downloadFromModrinth = useCallback(async (project: ModSearchResult) => {
    await importModrinthProject(project)
  }, [importModrinthProject])

  const downloadVersionFromModrinth = useCallback(async (project: ModSearchResult, versionId: string) => {
    await importModrinthProject(project, versionId)
  }, [importModrinthProject])

  const downloadFromCurseforge = useCallback(async (pack: ModSearchResult) => {
    await importCurseforgeProject(pack)
  }, [importCurseforgeProject])

  const downloadVersionFromCurseforge = useCallback(async (pack: ModSearchResult, fileId: number) => {
    await importCurseforgeProject(pack, fileId)
  }, [importCurseforgeProject])

  const handleImportFile = useCallback(async () => {
    beginImportSession("local")
    safeSetImportProgress({ current: 0, total: 1, message: "Открытие файла...", source: "local" })
    try {
      const result = await window.electronAPI?.openAndImportModpack()
      if (!result) {
        finishImportSession()
        safeSetImportProgress(null)
        return
      }
      if (result.cancelled) {
        finishImportSession()
        safeSetImportError(null)
        safeSetImportProgress(null)
        return
      }
      if (!result.success) {
        if (result.error === "Импорт отменён") {
          finishImportSession()
        }
        if (result.error !== "Импорт отменён") safeSetImportError(result.error ?? "Ошибка")
        safeSetImportProgress(null)
        return
      }

      await applyImportedBuild({
        id: crypto.randomUUID(),
        name: result.name ?? "Импортированная сборка",
        description: result.description ?? "",
        version: result.version ?? "",
        modLoader: result.modLoader ?? "vanilla",
        loaderVersion: result.loaderVersion,
        icon: result.icon ?? "",
        mods: result.mods ?? [],
        resourcepacks: result.resourcepacks ?? [],
        shaders: result.shaders ?? [],
        createdAt: new Date().toISOString(),
        source: result.source ?? "local",
        intentPath: result.intentPath ?? "",
        installedMods: result.installedMods ?? {},
        playtime: 0,
      })
    } catch (error) {
      safeSetImportError(error instanceof Error ? error.message : "Ошибка импорта")
    } finally {
      clearProgressLater(3000, true)
    }
  }, [applyImportedBuild, beginImportSession, clearProgressLater, finishImportSession, safeSetImportError, safeSetImportProgress])

  return {
    importProgress,
    importError,
    isCancellingImport,
    downloadingSlug,
    cfDownloadingId,
    cancelImport,
    downloadFromModrinth,
    downloadVersionFromModrinth,
    downloadFromCurseforge,
    downloadVersionFromCurseforge,
    handleImportFile,
  }
}
