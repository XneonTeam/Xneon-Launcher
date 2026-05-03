import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconSettings, IconPuzzle, IconPhoto, IconSparkles } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { MOD_LOADERS } from "./constants"
import { InstanceContentTab } from "./instance-content-tab"
import { InstanceDetailGeneral } from "./instance-detail-general"
import { InstanceModal } from "./instance-modal"
import type {
  Build,
  DetailTab,
  ModSearchResult,
  Source,
  ModSort,
  ModalTab,
  ModVersion,
  ModDetails,
} from "./types"

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
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  displayedModalVersions: ModVersion[]
  closeModal: () => void
}

export function InstanceDetail(props: InstanceDetailProps) {
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
    setBuilds,
    selectedDetails,
    modalTab,
    setModalTab,
    loadingModal,
    displayedModalVersions,
    closeModal,
  } = props

  const { t } = useTranslation()
  const loader = MOD_LOADERS.find(item => item.id === activeBuild.modLoader) ?? MOD_LOADERS[0]
  const buildHasImage = activeBuild.icon && (activeBuild.icon.startsWith("data:") || activeBuild.icon.startsWith("http"))
  const isVanilla = activeBuild.modLoader === "vanilla"

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
          <button type="button" onClick={() => setDetailTab("general")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all", detailTab === "general" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <IconSettings className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.tab.general")}
          </button>
          {!isVanilla && (
            <>
              <button type="button" onClick={() => setDetailTab("mods")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all", detailTab === "mods" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <IconPuzzle className="w-4 h-4" strokeWidth={1.75} />
                {t("builds.tab.mods", { count: activeBuild.mods?.length ?? 0 })}
              </button>
              <button type="button" onClick={() => setDetailTab("resourcepacks")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all", detailTab === "resourcepacks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <IconPhoto className="w-4 h-4" strokeWidth={1.75} />
                {t("builds.tab.resourcepacks", { count: activeBuild.resourcepacks?.length ?? 0 })}
              </button>
              <button type="button" onClick={() => setDetailTab("shaders")} className={cn("flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all", detailTab === "shaders" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <IconSparkles className="w-4 h-4" strokeWidth={1.75} />
                {t("builds.tab.shaders", { count: activeBuild.shaders?.length ?? 0 })}
              </button>
            </>
          )}
        </div>
      </div>

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
          onUploadFile={(file) => addLocalModToBuild(activeBuild.id, file)}
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
          setBuilds={setBuilds}
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
          onUploadFile={() => {}}
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
          setBuilds={setBuilds}
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
          onUploadFile={() => {}}
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
          setBuilds={setBuilds}
        />
      )}

      <InstanceModal
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        onClose={closeModal}
      />
    </div>
  )
}
