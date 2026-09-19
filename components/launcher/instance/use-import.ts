import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { MOD_LOADERS } from "./constants"
import type { ModpackConflictInfo } from "./modpack-conflict-dialog"
import type { Build, ModSearchResult } from "./types"

export interface ImportProgressState {
  current: number
  total: number
  message: string
  source: "modrinth" | "curseforge" | "ftb" | "local"
}

/** Запрос на установку модпака, отложенный из-за конфликта с уже существующей сборкой */
type PendingInstall =
  | { source: "modrinth"; project: ModSearchResult; versionId?: string }
  | { source: "curseforge"; pack: ModSearchResult; fileId?: number }
  | { source: "ftb"; pack: ModSearchResult; versionId?: number }
  | { source: "local" }

async function persistImportedBuild(build: Build) {
  const existing = await window.electronAPI?.loadBuilds() ?? []
  const next = [build, ...existing.filter(item => item.id !== build.id && item.name !== build.name)]
  await window.electronAPI?.saveBuilds(next as Parameters<NonNullable<Window["electronAPI"]>["saveBuilds"]>[0])
}

function getImportSourceLabel(t: (key: string) => string, source: ImportProgressState["source"]): string {
  if (source === "modrinth") return t("import.source.modrinth")
  if (source === "curseforge") return t("import.source.curseforge")
  if (source === "ftb") return t("import.source.ftb")
  return t("import.source.file")
}

export function useImport(setBuilds: React.Dispatch<React.SetStateAction<Build[]>>, setView: (v: "my") => void) {
  const { t } = useTranslation()
  const { pushNotification, startImportSession, clearImportSession } = useActivityCenter()
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isCancellingImport, setIsCancellingImport] = useState(false)
  const [downloadingSlug, setDownloadingSlug] = useState<string | null>(null)
  const [cfDownloadingId, setCfDownloadingId] = useState<number | null>(null)
  const [ftbDownloadingId, setFtbDownloadingId] = useState<number | null>(null)
  const [installConflict, setInstallConflict] = useState<ModpackConflictInfo | null>(null)
  const pendingInstallRef = useRef<PendingInstall | null>(null)
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
      title: t("import.failedTitle"),
      message: importError,
    })
  }, [finishImportSession, importError, pushNotification])

  const applyImportedBuild = useCallback(async (build: Build) => {
    await persistImportedBuild(build)
    finishImportSession()
    pushNotification({
      kind: "success",
      source: "import",
      title: t("import.importedTitle"),
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
        title: t("import.cancelledTitle"),
        message: t("import.cancelledMessage", { source: getImportSourceLabel(t, source) }),
      })
      if (isMountedRef.current) {
        setDownloadingSlug(null)
        setCfDownloadingId(null)
        setFtbDownloadingId(null)
      }
    } finally {
      if (isMountedRef.current) {
        setIsCancellingImport(false)
      }
    }
  }, [finishImportSession, importProgress, pushNotification, safeSetImportError, safeSetImportProgress])

  const importModrinthProject = useCallback(async (project: ModSearchResult, versionId?: string, overrideName?: string) => {
    beginImportSession("modrinth")
    setDownloadingSlug(project.slug)
    safeSetImportProgress({ current: 0, total: 1, message: t("import.preparing"), source: "modrinth" })
    const buildName = overrideName?.trim() || project.name
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
        intentPath = await window.electronAPI?.getBuildIntentPath(buildName) ?? ""
        await window.electronAPI?.setBuildIntentPath(buildName, intentPath)
      } catch {
        // ignore path preparation errors here, import will surface its own failure
      }

      const importResult = await window.electronAPI?.importModrinthModpack(buildName, project.slug, versionId)
      if (importResult?.cancelled) {
        finishImportSession()
        safeSetImportError(null)
        safeSetImportProgress(null)
        return
      }
      if (importResult?.conflict) {
        pendingInstallRef.current = { source: "modrinth", project, versionId }
        if (isMountedRef.current) {
          setInstallConflict({ ...importResult.conflict, packName: project.name })
          setDownloadingSlug(null)
        }
        finishImportSession()
        safeSetImportProgress(null)
        return
      }
      if (importResult && !importResult.success) throw new Error(importResult.error ?? t("import.error"))

      await applyImportedBuild({
        id,
        name: buildName,
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
        modpackVersion: importResult?.modpackVersion,
        modpackVersionId: importResult?.modpackVersionId,
        locked: true,
        intentPath,
        installedMods: importResult?.installedMods ?? {},
        playtime: 0,
      })
    } catch (error) {
      safeSetImportError(error instanceof Error ? error.message : t("import.error"))
      safeSetImportProgress({
        current: 0,
        total: 1,
        message: error instanceof Error ? error.message : t("import.error"),
        source: "modrinth",
      })
    } finally {
      if (isMountedRef.current) {
        setDownloadingSlug(null)
      }
      clearProgressLater(1800)
    }
  }, [applyImportedBuild, beginImportSession, clearProgressLater, finishImportSession, safeSetImportError, safeSetImportProgress])

  const importCurseforgeProject = useCallback(async (pack: ModSearchResult, fileIdOverride?: number, overrideName?: string) => {
    beginImportSession("curseforge")
    setCfDownloadingId(pack.modId ?? null)
    safeSetImportProgress({ current: 0, total: 1, message: t("import.preparing"), source: "curseforge" })
    const buildName = overrideName?.trim() || pack.name
    try {
      const fileId = fileIdOverride ?? pack.primaryFileId
      if (!pack.modId || !fileId) {
        throw new Error(t("import.cfNoData"))
      }
      const id = crypto.randomUUID()
      let intentPath = ""
      try {
        intentPath = await window.electronAPI?.getBuildIntentPath(buildName) ?? ""
      } catch {
        // ignore lookup error, import will fail clearly if needed
      }

      const importResult = await window.electronAPI?.importCurseforgeModpack(buildName, pack.modId, fileId)
      if (importResult?.cancelled) {
        finishImportSession()
        safeSetImportError(null)
        safeSetImportProgress(null)
        return
      }
      if (importResult?.conflict) {
        pendingInstallRef.current = { source: "curseforge", pack, fileId }
        if (isMountedRef.current) {
          setInstallConflict({ ...importResult.conflict, packName: pack.name })
          setCfDownloadingId(null)
        }
        finishImportSession()
        safeSetImportProgress(null)
        return
      }
      if (importResult && !importResult.success) throw new Error(importResult.error ?? t("import.error"))

      await applyImportedBuild({
        id,
        name: buildName,
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
        modId: pack.modId,
        fileId,
        modpackVersion: importResult?.modpackVersion,
        locked: true,
        intentPath,
        installedMods: importResult?.installedMods ?? {},
        playtime: 0,
      })
    } catch (error) {
      safeSetImportError(error instanceof Error ? error.message : t("import.error"))
      safeSetImportProgress({
        current: 0,
        total: 1,
        message: error instanceof Error ? error.message : t("import.error"),
        source: "curseforge",
      })
    } finally {
      if (isMountedRef.current) {
        setCfDownloadingId(null)
      }
      clearProgressLater(1800)
    }
  }, [applyImportedBuild, beginImportSession, clearProgressLater, finishImportSession, safeSetImportError, safeSetImportProgress])

  const importFtbProject = useCallback(async (pack: ModSearchResult, versionId?: number, overrideName?: string) => {
    beginImportSession("ftb")
    const modpackId = Number(pack.projectId)
    if (!modpackId) {
      safeSetImportError(t("import.ftbNoData"))
      return
    }
    setFtbDownloadingId(modpackId)
    safeSetImportProgress({ current: 0, total: 1, message: t("import.preparing"), source: "ftb" })
    const buildName = overrideName?.trim() || pack.name
    try {
      let targetVersionId = versionId
      if (!targetVersionId) {
        const details = await window.electronAPI?.modsFtbDetails(modpackId)
        const release = details?.versions?.find(v => v.versionType === "release")
        if (!release) {
          throw new Error(t("import.ftbNoVersion"))
        }
        targetVersionId = Number(release.id.replace("ftb-", ""))
      }

      const id = crypto.randomUUID()
      let intentPath = ""
      try {
        intentPath = await window.electronAPI?.getBuildIntentPath(buildName) ?? ""
      } catch {
        // ignore lookup error, import will fail clearly if needed
      }

      const importResult = await window.electronAPI?.importFtbModpack(buildName, modpackId, targetVersionId)
      if (importResult?.cancelled) {
        finishImportSession()
        safeSetImportError(null)
        safeSetImportProgress(null)
        return
      }
      if (importResult?.conflict) {
        pendingInstallRef.current = { source: "ftb", pack, versionId }
        if (isMountedRef.current) {
          setInstallConflict({ ...importResult.conflict, packName: pack.name })
          setFtbDownloadingId(null)
        }
        finishImportSession()
        safeSetImportProgress(null)
        return
      }
      if (importResult && !importResult.success) throw new Error(importResult.error ?? t("import.error"))

      await applyImportedBuild({
        id,
        name: buildName,
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
        source: "ftb",
        modId: modpackId,
        locked: true,
        intentPath,
        installedMods: importResult?.installedMods ?? {},
        playtime: 0,
      })
    } catch (error) {
      safeSetImportError(error instanceof Error ? error.message : t("import.error"))
      safeSetImportProgress({
        current: 0,
        total: 1,
        message: error instanceof Error ? error.message : t("import.error"),
        source: "ftb",
      })
    } finally {
      if (isMountedRef.current) {
        setFtbDownloadingId(null)
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

  const downloadFromFtb = useCallback(async (pack: ModSearchResult) => {
    await importFtbProject(pack)
  }, [importFtbProject])

  const downloadVersionFromFtb = useCallback(async (pack: ModSearchResult, versionId: number) => {
    await importFtbProject(pack, versionId)
  }, [importFtbProject])

  const handleImportFile = useCallback(async (overrideName?: string) => {
    // Оверлей прогресса показываем не здесь, а с первым событием из main (уже
    // после системного окна выбора файла): иначе лаунчер затемнялся, пока
    // пользователь ещё только выбирает архив.
    beginImportSession("local")
    try {
      const result = await window.electronAPI?.openAndImportModpack(overrideName)
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
      if (result.conflict) {
        pendingInstallRef.current = { source: "local" }
        if (isMountedRef.current) {
          setInstallConflict({ ...result.conflict, packName: result.name ?? t("import.modpack") })
        }
        finishImportSession()
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
        name: overrideName?.trim() || result.name || t("import.importedBuild"),
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
      safeSetImportError(error instanceof Error ? error.message : t("import.error"))
    } finally {
      clearProgressLater(3000, true)
    }
  }, [applyImportedBuild, beginImportSession, clearProgressLater, finishImportSession, safeSetImportError, safeSetImportProgress])

  /** Отмена установки: конфликт просто закрывается, ничего не создаётся */
  const dismissInstallConflict = useCallback(() => {
    pendingInstallRef.current = null
    if (isMountedRef.current) setInstallConflict(null)
    safeSetImportProgress(null)
    safeSetImportError(null)
  }, [safeSetImportError, safeSetImportProgress])

  /** Создаёт отдельную сборку с тем же модпаком под новым именем */
  const createInstallCopy = useCallback(async (name: string) => {
    const pending = pendingInstallRef.current
    pendingInstallRef.current = null
    if (isMountedRef.current) setInstallConflict(null)
    if (!pending) return

    if (pending.source === "modrinth") {
      await importModrinthProject(pending.project, pending.versionId, name)
    } else if (pending.source === "curseforge") {
      await importCurseforgeProject(pending.pack, pending.fileId, name)
    } else if (pending.source === "ftb") {
      await importFtbProject(pending.pack, pending.versionId, name)
    } else {
      await handleImportFile(name)
    }
  }, [handleImportFile, importCurseforgeProject, importFtbProject, importModrinthProject])

  return {
    importProgress,
    importError,
    isCancellingImport,
    downloadingSlug,
    cfDownloadingId,
    ftbDownloadingId,
    installConflict,
    dismissInstallConflict,
    createInstallCopy,
    cancelImport,
    downloadFromModrinth,
    downloadVersionFromModrinth,
    downloadFromCurseforge,
    downloadVersionFromCurseforge,
    downloadFromFtb,
    downloadVersionFromFtb,
    handleImportFile,
  }
}
