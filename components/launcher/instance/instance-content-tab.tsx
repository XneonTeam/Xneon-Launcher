import { useTranslation } from "react-i18next"
import { IconSearch, IconUpload, IconInfoCircle, IconPlus } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MODS_PER_PAGE } from "./constants"
import { Pagination } from "./pagination"
import { Spinner } from "./spinner"
import { formatDownloads } from "./utils"
import type { Build, BuildMod, ModSearchResult, ModSort, Source } from "./types"

interface InstanceContentTabProps {
  activeBuild: Build
  title: string
  placeholder: string
  uploadLabel: string
  type: "mods" | "resourcepacks" | "shaders"
  modSearch: string
  setModSearch: (value: string) => void
  modSource: Source
  setModSource: (value: Source) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  onUploadFile: (file: File) => void
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
}

export function InstanceContentTab({
  activeBuild,
  title,
  placeholder,
  uploadLabel,
  type,
  modSearch,
  setModSearch,
  modSource,
  setModSource,
  modSortBy,
  setModSortBy,
  modFileInputRef,
  onUploadFile,
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
}: InstanceContentTabProps) {
  const { t } = useTranslation()
  const installedItems = type === "mods" ? activeBuild.mods : type === "resourcepacks" ? activeBuild.resourcepacks : activeBuild.shaders
  const emptyStateText = type === "mods" ? t("builds.findMods") : type === "resourcepacks" ? t("builds.findResourcePacks") : t("builds.findShaders")
  const notFoundText = type === "mods" ? t("builds.noModsFound") : type === "resourcepacks" ? t("builds.noResourcePacksFound") : t("builds.noShadersFound")

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[300px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={modSearch}
            onChange={e => setModSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={modSource} onValueChange={(v) => setModSource(v as Source)}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modrinth">Modrinth</SelectItem>
              <SelectItem value="curseforge">CurseForge</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modSortBy} onValueChange={(v) => setModSortBy(v as ModSort)}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="downloads">По загрузкам</SelectItem>
              <SelectItem value="popular">По популярности</SelectItem>
              <SelectItem value="updated">По дате обновления</SelectItem>
              <SelectItem value="published">По дате публикации</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => modFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          >
            <IconUpload className="w-4 h-4" strokeWidth={1.75} />
            {uploadLabel}
          </button>
          <input
            ref={modFileInputRef}
            type="file"
            accept=".jar,.zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) {
                onUploadFile(file)
                e.target.value = ""
              }
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          {!modLoading && (modTotalHits > MODS_PER_PAGE || modSearch) && (
            <Pagination
              currentPage={modPage}
              totalPages={Math.max(1, Math.ceil(modTotalHits / MODS_PER_PAGE))}
              onPageChange={(p) => {
                setModPrevResults(modResults)
                setModPage(p)
              }}
            />
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[540px]">
          {modResults.length > 0 || displayResults.length > 0 ? (
            <div className="grid gap-2 pb-2">
              {displayResults
                .filter(project => !installedItems.some(item => item.slug === project.slug))
                .map(project => (
                  <div key={project.slug} className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4 group">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {project.iconUrl ? (
                        <img src={project.iconUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg font-bold text-muted-foreground">{project.name[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">{project.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{formatDownloads(project.downloadCount)}</span>
                        {type === "mods" && project.categories?.slice(0, 3).map(cat => (
                          <span key={cat} className="text-xs px-1.5 py-0.5 rounded bg-muted/60 capitalize">{cat}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openProjectModal(project)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-muted/80"
                      >
                        <IconInfoCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {t("builds.details")}
                      </button>
                      <button
                        type="button"
                        disabled={type === "mods" && installingModSlug === project.slug}
                        onClick={() => {
                          if (type === "mods") {
                            setInstallingModSlug(project.slug)
                            addModToBuild(activeBuild.id, project)
                            setTimeout(() => setInstallingModSlug(null), 500)
                            return
                          }
                          const newMod: BuildMod = {
                            id: crypto.randomUUID(),
                            slug: project.slug,
                            name: project.name,
                            description: project.summary,
                            icon_url: project.iconUrl,
                            version: "",
                          }
                          setBuilds(prev => prev.map(b => b.id === activeBuild.id ? {
                            ...b,
                            [type]: [...b[type], newMod],
                          } : b) as Build[])
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {type === "mods" && installingModSlug === project.slug ? "..." : <><IconPlus className="w-3.5 h-3.5" strokeWidth={1.75} />{t("builds.add")}</>}
                      </button>
                    </div>
                  </div>
                ))}
              {type === "mods" && displayResults.length > 0 && displayResults.every(project => installedItems.some(item => item.slug === project.slug)) && (
                <p className="text-sm text-muted-foreground py-6 text-center">{t("builds.allModsInstalled")}</p>
              )}
            </div>
          ) : modLoading ? (
            <Spinner />
          ) : modSearch ? (
            <div className="flex flex-col items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">{notFoundText}</p>
            </div>
          ) : installedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <IconSearch className="w-6 h-6 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">{emptyStateText}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
