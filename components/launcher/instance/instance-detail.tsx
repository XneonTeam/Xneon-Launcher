import { memo, useCallback, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconInfoCircle, IconSettings, IconPuzzle, IconPhoto, IconSparkles, IconMap, IconCamera, IconServer, IconLock } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { MOD_LOADERS } from "./constants"
import { LoaderIcon } from "./loader-icon"
import { pickCompatibleVersion } from "./utils"
import { InstanceContentTab } from "./instance-content-tab"
import { InstanceDetailGeneral } from "./instance-detail-general"
import { InstanceBuildSettings } from "./instance-build-settings"
import { InstanceWorldsTab } from "./instance-worlds-tab"
import { InstanceScreenshotsTab } from "./instance-screenshots-tab"
import { InstanceServersTab } from "./instance-servers-tab"
import { InstanceModal } from "./instance-modal"
import { DepInstallDialog } from "@/components/launcher/dep-install-dialog"
import { ActionConfirmDialog } from "./action-confirm-dialog"
import type { SelectedModCategory } from "./use-mod-search"
import type {
  Build,
  BuildMod,
  DetailTab,
  ModSearchResult,
  Source,
  SearchSource,
  ModSort,
  ModalTab,
  ModVersion,
  ModDetails,
  ModDependency,
} from "./types"
import type { ModCategory } from "@xnlc/types"

function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

interface DepInstallState {
  version: ModVersion
  modName: string
  modIcon: string
  source: "modrinth" | "curseforge"
  resolvedDeps?: ModDependency[]
  overrideMetadata?: { name?: string; description?: string; iconUrl?: string; projectId?: string; modId?: number }
}

interface InstanceDetailProps {
  activeBuild: Build
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  goToMyBuilds: () => void
  updateBuild: (id: string, fields: Partial<Build>) => void
  renameBuild: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  modSearch: string
  setModSearch: (value: string) => void
  modSource: SearchSource
  setModSource: (value: SearchSource) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modCategories: SelectedModCategory[]
  setModCategories: (value: SelectedModCategory[]) => void
  categories: ModCategory[]
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  addLocalModToBuild: (buildId: string, file: File) => void
  addLocalContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", file: File) => void | Promise<void>
  removeContentFromBuild: (buildId: string, type: "mods" | "resourcepacks" | "shaders", item: Build["mods"][number]) => Promise<boolean>
  reloadBuilds: () => Promise<void>
  modLoading: boolean
  modTotalHits: number
  modTotalPages: number
  modPage: number
  setModPage: (page: number) => void
  displayResults: ModSearchResult[]
  isInstalledFn: (project: ModSearchResult) => boolean
  openProjectModal: (item: ModSearchResult) => void
  installingModSlug: string | null
  setInstallingModSlug: (slug: string | null) => void
  addModToBuild: (buildId: string, mod: ModSearchResult) => void
  addContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", mod: ModSearchResult) => void | Promise<void>
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  toggleItemEnabled: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string) => void | Promise<boolean>
  updateItemVersion: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string, newVersion: ModVersion) => Promise<boolean>
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  displayedModalVersions: ModVersion[]
  versionsFallback?: "none" | "otherMc" | "otherLoader" | "empty"
  versionsLoaderFiltered?: boolean
  onShowAllVersions?: () => void
  allVersionsCount?: number
  closeModal: () => void
}

export const InstanceDetail = memo(function InstanceDetail(props: InstanceDetailProps) {
  const {
    activeBuild,
    detailTab,
    setDetailTab,
  goToMyBuilds,
  updateBuild,
  renameBuild,
  fileInputRef,
    modSearch,
    setModSearch,
    modSource,
    setModSource,
    modSortBy,
    setModSortBy,
    modCategories,
    setModCategories,
    categories,
    modFileInputRef,
    addLocalModToBuild,
    addLocalContentToBuild,
    removeContentFromBuild,
    reloadBuilds,
    modLoading,
    modTotalHits,
    modTotalPages,
    modPage,
    setModPage,
    displayResults,
    isInstalledFn,
    openProjectModal,
    installingModSlug,
    setInstallingModSlug,
    addModToBuild,
    addContentToBuild,
    setBuilds,
    toggleItemEnabled,
    updateItemVersion,
    selectedDetails,
    modalTab,
    setModalTab,
    loadingModal,
    displayedModalVersions,
    versionsFallback,
    versionsLoaderFiltered,
    onShowAllVersions,
    allVersionsCount,
    closeModal,
  } = props

  const [depInstallState, setDepInstallState] = useState<DepInstallState | null>(null)

  const { t } = useTranslation()
  const loader = MOD_LOADERS.find(item => item.id === activeBuild.modLoader) ?? MOD_LOADERS[0]
  const buildHasImage = !!activeBuild.icon
  const isVanilla = activeBuild.modLoader === "vanilla"

  const isLocked = Boolean(
    (activeBuild.source === "modrinth" || activeBuild.source === "curseforge") &&
    activeBuild.locked !== false
  )
  const [lockedTargetTab, setLockedTargetTab] = useState<DetailTab | null>(null)

  useEffect(() => {
    if (isLocked && (detailTab === "mods" || detailTab === "resourcepacks" || detailTab === "shaders")) {
      setDetailTab("general")
    }
  }, [isLocked, detailTab, setDetailTab])

  const handleTabClick = (tab: DetailTab) => {
    if (isLocked && (tab === "mods" || tab === "resourcepacks" || tab === "shaders")) {
      setLockedTargetTab(tab)
      return
    }
    setDetailTab(tab)
  }

  const handleUploadModFile = useCallback((file: File) => addLocalModToBuild(activeBuild.id, file), [activeBuild.id, addLocalModToBuild])
  const handleUploadResourcepackFile = useCallback((file: File) => addLocalContentToBuild(activeBuild.id, "resourcepacks", file), [activeBuild.id, addLocalContentToBuild])
  const handleUploadShaderFile = useCallback((file: File) => addLocalContentToBuild(activeBuild.id, "shaders", file), [activeBuild.id, addLocalContentToBuild])

  const isInstalledBuildMod = useCallback((installedMod: BuildMod, source: "modrinth" | "curseforge", projectId?: string, modId?: number, slug?: string) => {
    if (source === "modrinth" && projectId && installedMod.source === "modrinth" && installedMod.projectId === projectId) {
      return true
    }

    if (source === "curseforge" && typeof modId === "number" && installedMod.source === "curseforge" && installedMod.modId === modId) {
      return true
    }

    const normalizedSlug = normalizeContentIdentity(slug)
    const installedSlug = normalizeContentIdentity(installedMod.slug)
    const installedName = normalizeContentIdentity(installedMod.name)
    return Boolean(normalizedSlug) && (
      installedSlug === normalizedSlug
      || installedName === normalizedSlug
      || installedSlug.includes(normalizedSlug)
      || normalizedSlug.includes(installedName)
    )
  }, [])

  const doDownloadMod = useCallback(async (
    fileUrl: string,
    fileName: string,
    metadata?: {
      name?: string
      description?: string
      iconUrl?: string
      version?: string
      matchSlug?: string
      source?: "local" | "modrinth" | "curseforge"
      projectId?: string
      modId?: number
    },
  ) => {
    const buildName = activeBuild.name
    if (!buildName) return
    const saved = await window.electronAPI?.saveModToIntent(buildName, fileUrl, fileName)
    if (saved) {
      setBuilds(prev => prev.map(build => {
        if (build.id !== activeBuild.id) return build

        const matchSlug = metadata?.matchSlug?.toLowerCase()
        const matchName = metadata?.name?.toLowerCase()
        const existingIndex = build.mods.findIndex(mod => {
          const modSlug = mod.slug.toLowerCase()
          const modName = mod.name.toLowerCase()
          if (metadata?.source === "modrinth" && metadata.projectId && mod.source === "modrinth" && mod.projectId === metadata.projectId) {
            return true
          }
          if (metadata?.source === "curseforge" && typeof metadata.modId === "number" && mod.source === "curseforge" && mod.modId === metadata.modId) {
            return true
          }
          return modSlug === fileName.toLowerCase()
            || (matchSlug ? modSlug === matchSlug : false)
            || (matchName ? modName === matchName : false)
        })

        const nextEntry = {
          id: existingIndex >= 0 ? build.mods[existingIndex].id : crypto.randomUUID(),
          slug: fileName,
          name: metadata?.name || fileName.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          description: metadata?.description || (existingIndex >= 0 ? build.mods[existingIndex].description : ""),
          icon_url: metadata?.iconUrl || (existingIndex >= 0 ? build.mods[existingIndex].icon_url : undefined),
          version: metadata?.version || (existingIndex >= 0 ? build.mods[existingIndex].version : "local"),
          source: metadata?.source || (existingIndex >= 0 ? build.mods[existingIndex].source : "local"),
          projectId: metadata?.projectId || (existingIndex >= 0 ? build.mods[existingIndex].projectId : undefined),
          modId: metadata?.modId ?? (existingIndex >= 0 ? build.mods[existingIndex].modId : undefined),
        }

        const mods = existingIndex >= 0
          ? build.mods.map((mod, index) => index === existingIndex ? nextEntry : mod)
          : [...build.mods, nextEntry]

        return {
          ...build,
          installedMods: {
            ...(build.installedMods ?? {}),
            [fileName]: saved,
          },
          mods,
        }
      }))
      await reloadBuilds()
    }
  }, [activeBuild.id, activeBuild.name, reloadBuilds, setBuilds])

  const doDownloadDep = useCallback(async (dep: ModDependency, source: string) => {
    if (dep.dependencyType === "embedded" || !dep.projectId) return
    try {
      if (source === "modrinth") {
        const versions = await window.electronAPI?.modsModrinthVersions(dep.projectId)
        const latestVersion = pickCompatibleVersion(versions, activeBuild)
        if (latestVersion?.files?.[0]?.url) {
          await doDownloadMod(
            latestVersion.files[0].url,
            latestVersion.files[0].filename || `${dep.projectId}.jar`,
            {
              name: dep.name,
              iconUrl: dep.iconUrl,
              version: latestVersion.name || latestVersion.id,
              source: "modrinth",
              projectId: dep.projectId,
              matchSlug: dep.slug || dep.projectId,
            },
          )
        }
      } else {
        const depModId = parseInt(dep.projectId)
        if (isNaN(depModId)) return
        const details = await window.electronAPI?.modsCurseforgeDetails(depModId)
        const selectedVersion = pickCompatibleVersion(details?.versions ?? [], activeBuild)
        if (selectedVersion) {
          const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(selectedVersion.id), depModId)
          if (url) {
            const fileName = selectedVersion.fileName || url.split("/").pop()?.split("?")[0] || `${dep.projectId}.jar`
            await doDownloadMod(url, fileName, {
              name: dep.name,
              iconUrl: dep.iconUrl,
              version: selectedVersion.name || selectedVersion.id,
              source: "curseforge",
              projectId: dep.projectId,
              modId: depModId,
              matchSlug: dep.slug || dep.projectId,
            })
          }
        }
      }
    } catch { /* skip failed dep */ }
  }, [doDownloadMod])

  const installVersionWithDeps = useCallback(async (version: ModVersion, source: Source, selectedDeps: ModDependency[], overrideMetadata?: { name?: string; description?: string; iconUrl?: string; projectId?: string; modId?: number }) => {
    if (source === "ftb") {
      return
    }
    const meta = {
      name: overrideMetadata?.name || selectedDetails?.name,
      description: overrideMetadata?.description || selectedDetails?.summary,
      iconUrl: overrideMetadata?.iconUrl || selectedDetails?.iconUrl,
    }
    if (source === "modrinth") {
      const file = version.files?.[0]
      if (file?.url) {
        await doDownloadMod(file.url, file.filename || version.fileName || `${version.id}.jar`, {
          ...meta,
          version: version.name || version.id,
          source: "modrinth",
          projectId: overrideMetadata?.projectId || selectedDetails?.projectId || selectedDetails?.id,
          matchSlug: selectedDetails?.slug || overrideMetadata?.projectId,
        })
      }
    } else {
      const modId = overrideMetadata?.modId || selectedDetails?.modId
      if (modId) {
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(version.id), modId)
        if (url) {
          const fileName = version.fileName || url.split("/").pop()?.split("?")[0] || `mod-${version.id}.jar`
          await doDownloadMod(url, fileName, {
            ...meta,
            version: version.name || version.id,
            source: "curseforge",
            projectId: overrideMetadata?.projectId || selectedDetails?.projectId,
            modId,
            matchSlug: selectedDetails?.slug || String(modId),
          })
        }
      }
    }

    for (const dep of selectedDeps) {
      await doDownloadDep(dep, source)
    }
  }, [selectedDetails, doDownloadMod, doDownloadDep])

  const installModToBuild = useCallback(async (mod: ModSearchResult) => {
    const source = mod.source as "modrinth" | "curseforge"

    let selectedVersion: ModVersion | undefined
    if (source === "modrinth") {
      const versions = await window.electronAPI?.modsModrinthVersions(mod.slug)
      selectedVersion = pickCompatibleVersion(versions, activeBuild)
    } else if (source === "curseforge" && mod.modId) {
      const details = await window.electronAPI?.modsCurseforgeDetails(mod.modId)
      selectedVersion = pickCompatibleVersion(details?.versions ?? [], activeBuild)
    }

    if (!selectedVersion) return

    const overrideMeta = { name: mod.name, description: mod.summary, iconUrl: mod.iconUrl, projectId: mod.projectId, modId: mod.modId }

    const resolvedDeps = await window.electronAPI?.modsResolveDependencies(selectedVersion, source) ?? []
    const missingRequiredDeps = resolvedDeps.filter(dep => {
      if (dep.dependencyType !== "required") return false
      return !activeBuild.mods.some(installedMod =>
        isInstalledBuildMod(installedMod, source, dep.projectId, source === "curseforge" ? Number(dep.projectId) : undefined, dep.slug || dep.projectId),
      )
    })

    if (missingRequiredDeps.length === 0) {
      await installVersionWithDeps(selectedVersion, source, [], overrideMeta)
      return
    }

    setDepInstallState({
      version: selectedVersion,
      modName: mod.name,
      modIcon: mod.iconUrl,
      source,
      resolvedDeps: missingRequiredDeps,
      overrideMetadata: overrideMeta,
    })
  }, [activeBuild, activeBuild.id, activeBuild.mods, installVersionWithDeps, isInstalledBuildMod])

  const handleInstallVersion = useCallback(async (version: ModVersion): Promise<boolean> => {
    if (!selectedDetails) return false

    if (selectedDetails.source === "ftb") {
      return false
    }

    const source = selectedDetails.source
    const resolvedDeps = await window.electronAPI?.modsResolveDependencies(version, selectedDetails.source) ?? []
    const missingRequiredDeps = resolvedDeps.filter(dep => {
      if (dep.dependencyType !== "required") return false
      return !activeBuild.mods.some(mod => isInstalledBuildMod(
        mod,
        source,
        dep.projectId,
        source === "curseforge" ? Number(dep.projectId) : undefined,
        dep.slug || dep.projectId,
      ))
    })

    if (missingRequiredDeps.length === 0) {
      await installVersionWithDeps(version, source, [])
      return true
    }

    // Установку продолжит диалог подтверждения зависимостей — прогресс покажет он сам
    setDepInstallState({
      version,
      modName: selectedDetails.name,
      modIcon: selectedDetails.iconUrl,
      source,
      resolvedDeps: missingRequiredDeps,
    })
    return false
  }, [selectedDetails, activeBuild.mods, installVersionWithDeps, isInstalledBuildMod])

  const handleDepInstallConfirm = useCallback(async (selectedDeps: ModDependency[]) => {
    if (!depInstallState) return
    const { version, source, overrideMetadata } = depInstallState
    try {
      await installVersionWithDeps(version, source, selectedDeps, overrideMetadata)
    } finally {
      setDepInstallState(null)
    }
  }, [depInstallState, installVersionWithDeps])

  const handleUpdateModpack = useCallback(async (version: ModVersion): Promise<boolean> => {
    if (!selectedDetails || selectedDetails.source === "ftb") return false
    await installVersionWithDeps(version, selectedDetails.source, [])
    return true
  }, [selectedDetails, installVersionWithDeps])

  return (
    <div className="h-full flex flex-col animate-in fade-in-0 duration-300">
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={goToMyBuilds}
            className="p-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
          >
            <IconArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 rounded-2xl bg-muted/50 px-4 py-2.5">
            {buildHasImage && (
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                <img src={activeBuild.icon} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-foreground">{activeBuild.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderIcon loaderId={activeBuild.modLoader} className="w-4 h-4 text-muted-foreground inline-block flex-shrink-0" />
                <span>{loader.name} · {activeBuild.version}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-0.5 p-1 rounded-xl bg-muted/30 border border-border/50">
            {([
              { tab: "general" as const, icon: IconInfoCircle, label: t("builds.tab.general"), locked: false },
              { tab: "settings" as const, icon: IconSettings, label: t("builds.tab.settings"), locked: false },
              ...(!isVanilla ? [
                { tab: "mods" as const, icon: IconPuzzle, label: t("builds.tab.mods"), locked: isLocked },
                { tab: "resourcepacks" as const, icon: IconPhoto, label: t("builds.tab.resourcepacks"), locked: isLocked },
                { tab: "shaders" as const, icon: IconSparkles, label: t("builds.tab.shaders"), locked: isLocked },
              ] : []),
            ]).map(({ tab, icon: Icon, label, locked }) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabClick(tab)}
                title={locked ? "Инстанс заблокирован. Нажмите для разблокировки" : undefined}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
                  detailTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : locked
                      ? "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 cursor-pointer"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
                <span>{label}</span>
                {locked && <IconLock className="w-3 h-3 text-amber-500/80 shrink-0 ml-0.5" />}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 p-1 rounded-xl bg-muted/30 border border-border/50">
            {([
              { tab: "servers" as const, icon: IconServer, label: t("builds.tab.servers") },
              { tab: "worlds" as const, icon: IconMap, label: t("builds.tab.worlds") },
              { tab: "screenshots" as const, icon: IconCamera, label: t("builds.tab.screenshots") },
            ]).map(({ tab, icon: Icon, label }) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailTab(tab)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
                  detailTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {detailTab === "settings" && (
        <InstanceBuildSettings build={activeBuild} updateBuild={updateBuild} />
      )}

      {detailTab === "general" && (
        <InstanceDetailGeneral
          activeBuild={activeBuild}
          updateBuild={updateBuild}
          renameBuild={renameBuild}
        />
      )}

      {detailTab === "mods" && (
        <InstanceContentTab
          activeBuild={activeBuild}
          title="Результаты поиска"
          placeholder="Поиск..."
          uploadLabel="Загрузить мод"
          type="mods"
          modSearch={modSearch}
          setModSearch={setModSearch}
          modSource={modSource}
          setModSource={setModSource}
          modSortBy={modSortBy}
          setModSortBy={setModSortBy}
          modCategories={modCategories}
          setModCategories={setModCategories}
          categories={categories}
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadModFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modTotalPages={modTotalPages}
          modPage={modPage}
          setModPage={setModPage}
          displayResults={displayResults}
          isInstalledFn={isInstalledFn}
          openProjectModal={openProjectModal}
          installingModSlug={installingModSlug}
          setInstallingModSlug={setInstallingModSlug}
          addModToBuild={addModToBuild}
          addContentToBuild={addContentToBuild}
          removeContentFromBuild={removeContentFromBuild}
          installModToBuild={installModToBuild}
          setBuilds={setBuilds}
          toggleItemEnabled={toggleItemEnabled}
          updateItemVersion={updateItemVersion}
        />
      )}

      {detailTab === "resourcepacks" && (
        <InstanceContentTab
          activeBuild={activeBuild}
          title="Результаты поиска"
          placeholder="Поиск ресурспаков..."
          uploadLabel="Загрузить ресурспак"
          type="resourcepacks"
          modSearch={modSearch}
          setModSearch={setModSearch}
          modSource={modSource}
          setModSource={setModSource}
          modSortBy={modSortBy}
          setModSortBy={setModSortBy}
          modCategories={modCategories}
          setModCategories={setModCategories}
          categories={categories}
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadResourcepackFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modTotalPages={modTotalPages}
          modPage={modPage}
          setModPage={setModPage}
          displayResults={displayResults}
          isInstalledFn={isInstalledFn}
          openProjectModal={openProjectModal}
          installingModSlug={installingModSlug}
          setInstallingModSlug={setInstallingModSlug}
          addModToBuild={addModToBuild}
          addContentToBuild={addContentToBuild}
          removeContentFromBuild={removeContentFromBuild}
          installModToBuild={installModToBuild}
          setBuilds={setBuilds}
          toggleItemEnabled={toggleItemEnabled}
          updateItemVersion={updateItemVersion}
        />
      )}

      {detailTab === "shaders" && (
        <InstanceContentTab
          activeBuild={activeBuild}
          title="Результаты поиска"
          placeholder="Поиск шейдеров..."
          uploadLabel="Загрузить шейдер"
          type="shaders"
          modSearch={modSearch}
          setModSearch={setModSearch}
          modSource={modSource}
          setModSource={setModSource}
          modSortBy={modSortBy}
          setModSortBy={setModSortBy}
          modCategories={modCategories}
          setModCategories={setModCategories}
          categories={categories}
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadShaderFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modTotalPages={modTotalPages}
          modPage={modPage}
          setModPage={setModPage}
          displayResults={displayResults}
          isInstalledFn={isInstalledFn}
          openProjectModal={openProjectModal}
          installingModSlug={installingModSlug}
          setInstallingModSlug={setInstallingModSlug}
          addModToBuild={addModToBuild}
          addContentToBuild={addContentToBuild}
          removeContentFromBuild={removeContentFromBuild}
          installModToBuild={installModToBuild}
          setBuilds={setBuilds}
          toggleItemEnabled={toggleItemEnabled}
          updateItemVersion={updateItemVersion}
        />
      )}

      {detailTab === "worlds" && (
        <InstanceWorldsTab build={activeBuild} />
      )}

      {detailTab === "servers" && (
        <InstanceServersTab build={activeBuild} updateBuild={updateBuild} />
      )}

      {detailTab === "screenshots" && (
        <InstanceScreenshotsTab build={activeBuild} />
      )}

      <InstanceModal
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        versionsFallback={versionsFallback}
        versionsLoaderFiltered={versionsLoaderFiltered}
        onShowAllVersions={onShowAllVersions}
        allVersionsCount={allVersionsCount}
        onInstallVersion={handleInstallVersion}
        onClose={closeModal}
        activeBuild={activeBuild}
        onUpdateModpack={handleUpdateModpack}
      />

      {depInstallState && (
        <DepInstallDialog
          version={depInstallState.version}
          modName={depInstallState.modName}
          modIcon={depInstallState.modIcon}
          source={depInstallState.source}
          resolvedDeps={depInstallState.resolvedDeps}
          onConfirm={handleDepInstallConfirm}
          onCancel={() => setDepInstallState(null)}
        />
      )}

      <ActionConfirmDialog
        open={lockedTargetTab !== null}
        onClose={() => setLockedTargetTab(null)}
        onConfirm={() => {
          updateBuild(activeBuild.id, { locked: false })
          if (lockedTargetTab) {
            setDetailTab(lockedTargetTab)
            setLockedTargetTab(null)
          }
        }}
        title="Управление контентом заблокировано"
        description={`Этот инстанс привязан к официальному модпаку «${activeBuild.name}».

Добавление, удаление и изменение модов или ресурспаков заблокировано, чтобы избежать поломки сборки.

Хотите отвязать инстанс прямо сейчас, чтобы получить полный доступ к редактированию?`}
        confirmText="Отвязать инстанс"
        cancelText="Оставить привязанным"
        variant="warning"
        icon="lock"
      />
    </div>
  )
})
