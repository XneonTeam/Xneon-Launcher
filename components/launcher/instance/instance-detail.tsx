import { memo, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconInfoCircle, IconSettings, IconPuzzle, IconPhoto, IconSparkles, IconWorld, IconCamera, IconServer } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { MOD_LOADERS } from "./constants"
import { pickCompatibleVersion } from "./utils"
import { InstanceContentTab } from "./instance-content-tab"
import { InstanceDetailGeneral } from "./instance-detail-general"
import { InstanceBuildSettings } from "./instance-build-settings"
import { InstanceWorldsTab } from "./instance-worlds-tab"
import { InstanceScreenshotsTab } from "./instance-screenshots-tab"
import { InstanceServersTab } from "./instance-servers-tab"
import { InstanceModal } from "./instance-modal"
import { DepInstallDialog } from "@/components/launcher/dep-install-dialog"
import type {
  Build,
  BuildMod,
  DetailTab,
  ModSearchResult,
  Source,
  ModSort,
  ModalTab,
  ModVersion,
  ModDetails,
  ModDependency,
} from "./types"

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
}

interface InstanceDetailProps {
  activeBuild: Build
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  goToMyBuilds: () => void
  updateBuild: (id: string, fields: Partial<Build>) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  modSearch: string
  setModSearch: (value: string) => void
  modSource: Source
  setModSource: (value: Source) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  addLocalModToBuild: (buildId: string, file: File) => void
  addLocalContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", file: File) => void | Promise<void>
  removeContentFromBuild: (buildId: string, type: "mods" | "resourcepacks" | "shaders", item: Build["mods"][number]) => Promise<boolean>
  reloadBuilds: () => Promise<void>
  modLoading: boolean
  modTotalHits: number
  modPage: number
  setModPrevResults: React.Dispatch<React.SetStateAction<ModSearchResult[]>>
  modResults: ModSearchResult[]
  setModPage: (page: number) => void
  displayResults: ModSearchResult[]
  openProjectModal: (item: ModSearchResult) => void
  installingModSlug: string | null
  setInstallingModSlug: (slug: string | null) => void
  addModToBuild: (buildId: string, mod: ModSearchResult) => void
  addContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", mod: ModSearchResult) => void | Promise<void>
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  toggleItemEnabled: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string) => void
  updateItemVersion: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string, newVersion: ModVersion) => Promise<boolean>
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  displayedModalVersions: ModVersion[]
  closeModal: () => void
}

export const InstanceDetail = memo(function InstanceDetail(props: InstanceDetailProps) {
  const {
    activeBuild,
    detailTab,
    setDetailTab,
    goToMyBuilds,
    updateBuild,
    fileInputRef,
    modSearch,
    setModSearch,
    modSource,
    setModSource,
    modSortBy,
    setModSortBy,
    modFileInputRef,
    addLocalModToBuild,
    addLocalContentToBuild,
    removeContentFromBuild,
    reloadBuilds,
    modLoading,
    modTotalHits,
    modPage,
    setModPrevResults,
    modResults,
    setModPage,
    displayResults,
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
    closeModal,
  } = props

  const [depInstallState, setDepInstallState] = useState<DepInstallState | null>(null)

  const { t } = useTranslation()
  const loader = MOD_LOADERS.find(item => item.id === activeBuild.modLoader) ?? MOD_LOADERS[0]
  const buildHasImage = activeBuild.icon && (activeBuild.icon.startsWith("data:") || activeBuild.icon.startsWith("http"))
  const isVanilla = activeBuild.modLoader === "vanilla"
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

  const installVersionWithDeps = useCallback(async (version: ModVersion, source: "modrinth" | "curseforge", selectedDeps: ModDependency[]) => {
    if (source === "modrinth") {
      const file = version.files?.[0]
      if (file?.url) {
        await doDownloadMod(file.url, file.filename || version.fileName || `${version.id}.jar`, {
          name: selectedDetails?.name,
          description: selectedDetails?.summary,
          iconUrl: selectedDetails?.iconUrl,
          version: version.name || version.id,
          source: "modrinth",
          projectId: selectedDetails?.projectId || selectedDetails?.id,
          matchSlug: selectedDetails?.slug || selectedDetails?.projectId,
        })
      }
    } else {
      const modId = selectedDetails?.modId
      if (modId) {
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(version.id), modId)
        if (url) {
          const fileName = version.fileName || url.split("/").pop()?.split("?")[0] || `mod-${version.id}.jar`
          await doDownloadMod(url, fileName, {
            name: selectedDetails?.name,
            description: selectedDetails?.summary,
            iconUrl: selectedDetails?.iconUrl,
            version: version.name || version.id,
            source: "curseforge",
            projectId: selectedDetails?.projectId,
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
    if (mod.source !== "modrinth") {
      addModToBuild(activeBuild.id, mod)
      return
    }

    const versions = await window.electronAPI?.modsModrinthVersions(mod.slug)
    const selectedVersion = pickCompatibleVersion(versions, activeBuild)
    if (!selectedVersion) return

    const resolvedDeps = await window.electronAPI?.modsResolveDependencies(selectedVersion, "modrinth") ?? []
    const missingRequiredDeps = resolvedDeps.filter(dep => {
      if (dep.dependencyType !== "required") return false
      return !activeBuild.mods.some(installedMod => isInstalledBuildMod(installedMod, "modrinth", dep.projectId, undefined, dep.slug || dep.projectId))
    })

    if (missingRequiredDeps.length === 0) {
      await installVersionWithDeps(selectedVersion, "modrinth", [])
      return
    }

    setDepInstallState({
      version: selectedVersion,
      modName: mod.name,
      modIcon: mod.iconUrl,
      source: "modrinth",
      resolvedDeps: missingRequiredDeps,
    })
  }, [activeBuild, activeBuild.id, activeBuild.mods, addModToBuild, installVersionWithDeps, isInstalledBuildMod])

  const handleInstallVersion = useCallback(async (version: ModVersion) => {
    if (!selectedDetails) return

    const resolvedDeps = await window.electronAPI?.modsResolveDependencies(version, selectedDetails.source) ?? []
    const missingRequiredDeps = resolvedDeps.filter(dep => {
      if (dep.dependencyType !== "required") return false
      return !activeBuild.mods.some(mod => isInstalledBuildMod(
        mod,
        selectedDetails.source,
        dep.projectId,
        selectedDetails.source === "curseforge" ? Number(dep.projectId) : undefined,
        dep.slug || dep.projectId,
      ))
    })

    if (missingRequiredDeps.length === 0) {
      await installVersionWithDeps(version, selectedDetails.source, [])
      return
    }

    setDepInstallState({
      version,
      modName: selectedDetails.name,
      modIcon: selectedDetails.iconUrl,
      source: selectedDetails.source,
      resolvedDeps: missingRequiredDeps,
    })
  }, [selectedDetails, activeBuild.mods, installVersionWithDeps, isInstalledBuildMod])

  const handleDepInstallConfirm = useCallback(async (selectedDeps: ModDependency[]) => {
    if (!depInstallState) return
    const { version, source } = depInstallState
    try {
      await installVersionWithDeps(version, source, selectedDeps)
    } finally {
      setDepInstallState(null)
    }
  }, [depInstallState, installVersionWithDeps])

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
          {buildHasImage && (
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              <img src={activeBuild.icon} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-foreground">{activeBuild.name}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("w-2 h-2 rounded-full inline-block", loader.dot)} />
              <span>{loader.name} · MC {activeBuild.version}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40">
          <button type="button" onClick={() => setDetailTab("general")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "general" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            <IconInfoCircle className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.tab.general")}
          </button>
          <button type="button" onClick={() => setDetailTab("settings")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "settings" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            <IconSettings className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.tab.settings")}
          </button>
          {!isVanilla && (
            <>
              <button type="button" onClick={() => setDetailTab("mods")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "mods" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
                <IconPuzzle className="w-4 h-4" strokeWidth={1.75} />
                {t("builds.tab.mods")}
              </button>
              <button type="button" onClick={() => setDetailTab("resourcepacks")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "resourcepacks" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
                <IconPhoto className="w-4 h-4" strokeWidth={1.75} />
                {t("builds.tab.resourcepacks")}
              </button>
              <button type="button" onClick={() => setDetailTab("shaders")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "shaders" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
                <IconSparkles className="w-4 h-4" strokeWidth={1.75} />
                {t("builds.tab.shaders")}
              </button>
            </>
          )}
          <button type="button" onClick={() => setDetailTab("servers")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "servers" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            <IconServer className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.tab.servers")}
          </button>
          <button type="button" onClick={() => setDetailTab("worlds")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "worlds" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            <IconWorld className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.tab.worlds")}
          </button>
          <button type="button" onClick={() => setDetailTab("screenshots")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all border", detailTab === "screenshots" ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            <IconCamera className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.tab.screenshots")}
          </button>
        </div>
      </div>

      {detailTab === "settings" && (
        <InstanceBuildSettings build={activeBuild} updateBuild={updateBuild} />
      )}

      {detailTab === "general" && (
        <InstanceDetailGeneral activeBuild={activeBuild} updateBuild={updateBuild} fileInputRef={fileInputRef} />
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
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadModFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modPage={modPage}
          setModPrevResults={setModPrevResults}
          modResults={modResults}
          setModPage={setModPage}
          displayResults={displayResults}
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
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadResourcepackFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modPage={modPage}
          setModPrevResults={setModPrevResults}
          modResults={modResults}
          setModPage={setModPage}
          displayResults={displayResults}
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
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadShaderFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modPage={modPage}
          setModPrevResults={setModPrevResults}
          modResults={modResults}
          setModPage={setModPage}
          displayResults={displayResults}
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
        onInstallVersion={handleInstallVersion}
        onClose={closeModal}
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
    </div>
  )
})
