import { useTranslation } from "react-i18next"
import { EmptyState } from "@/components/ui/empty-state"
import { IconDownload, IconInfoCircle, IconLoader2, IconPackage, IconSearch, IconExternalLink } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { openProjectPage, projectPageUrl } from "@/lib/project-links"
import { Spinner } from "./spinner"
import { formatDownloads, isFtbCategoryTag } from "./utils"
import { Pagination } from "./pagination"
import { CategoryBadge } from "./category-badge"
import { CategoriesDialog, type CategoriesDialogCategory } from "./categories-dialog"
import { MOD_LOADER_OPTIONS } from "./instance-browse-toolbar"
import { LoaderIcon } from "./loader-icon"
import { getSortLabels, SORT_OPTIONS_BY_SOURCE } from "./sort-options"
import type { SelectedModCategory } from "./use-mod-search"
import type { ModSearchResult, ModSort } from "./types"

interface InstanceFtbProps {
  ftbSearch: string
  setFtbSearch: (value: string) => void
  ftbLoading: boolean
  ftbResults: ModSearchResult[]
  ftbDownloadingId: number | null
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onOpenDetails: (pack: ModSearchResult) => void
  onDownload: (pack: ModSearchResult) => void
  sortBy: ModSort
  setSortBy: (value: ModSort) => void
  gameVersion: string
  setGameVersion: (value: string) => void
  gameVersions: string[]
  loader: string
  setLoader: (value: string) => void
  availableLoaders: string[]
  categories: CategoriesDialogCategory[]
  selectedCategories: SelectedModCategory[]
  onApplyCategories: (value: SelectedModCategory[]) => void
}

/**
 * Сортировка и фильтры FTB считаются в main по полному каталогу паков: поиск FTB
 * не принимает ни `sort`, ни `page`, ни фильтры — только `?term=`.
 */
export function InstanceFtb({
  ftbSearch,
  setFtbSearch,
  ftbLoading,
  ftbResults,
  ftbDownloadingId,
  page,
  totalPages,
  onPageChange,
  onOpenDetails,
  onDownload,
  sortBy,
  setSortBy,
  gameVersion,
  setGameVersion,
  gameVersions,
  loader,
  setLoader,
  availableLoaders,
  categories,
  selectedCategories,
  onApplyCategories,
}: InstanceFtbProps) {
  const { t } = useTranslation()
  const sortLabels = getSortLabels(t)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[280px] flex-1 relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={ftbSearch}
            onChange={e => setFtbSearch(e.target.value)}
            placeholder={t("builds.searchFTB")}
            className="w-full h-10 pl-10 pr-4 py-2 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>

        <Select value={sortBy} onValueChange={value => setSortBy(value as ModSort)}>
          <SelectTrigger className="w-[180px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
            <SelectValue placeholder={t("mods.sortBy")} />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS_BY_SOURCE.ftb.map(option => (
              <SelectItem key={option} value={option}>{sortLabels[option]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Порядок как у Modrinth/CurseForge и во вкладке сборки: поиск → сортировка
            → категории → версия → загрузчик. */}
        <CategoriesDialog
          categories={categories}
          selected={selectedCategories}
          onApply={onApplyCategories}
          triggerClassName="px-4 py-2.5 rounded-xl text-sm"
        />

        <Select value={gameVersion} onValueChange={setGameVersion}>
          <SelectTrigger className="w-[180px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
            <SelectValue placeholder={t("builds.version")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("builds.allVersions")}</SelectItem>
            {gameVersions.map(version => (
              <SelectItem key={version} value={version}>{version}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Загрузчиков у FTB мало (forge/neoforge/fabric), поэтому список строим из
            каталога: чего нет ни у одного пака — в селекте не показываем. */}
        <Select value={loader} onValueChange={setLoader}>
          <SelectTrigger className="w-[170px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
            <SelectValue placeholder={t("builds.modLoader")} />
          </SelectTrigger>
          <SelectContent>
            {MOD_LOADER_OPTIONS.filter(option => option.id === "all" || availableLoaders.includes(option.id)).map(option => (
              <SelectItem key={option.id} value={option.id}>
                <span className="flex items-center gap-2">
                  {option.id !== "all" && option.id !== "vanilla" && <LoaderIcon loaderId={option.id} className="w-4 h-4 flex-shrink-0" />}
                  <span>{option.id === "all" ? t("builds.allLoaders") : option.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {ftbLoading ? (
          <Spinner />
        ) : ftbResults.length === 0 ? (
          <EmptyState title={t("builds.noResults")} className="h-full" />
        ) : (
          <div className="grid gap-3">
            {ftbResults.map(pack => (
              <div key={pack.projectId} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {pack.iconUrl
                        ? <img src={pack.iconUrl} alt="" className="w-full h-full object-cover" />
                        : <IconPackage className="w-6 h-6 text-muted-foreground/40" strokeWidth={1.75} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-foreground truncate">{pack.name}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{pack.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatDownloads(pack.downloadCount)} {t("builds.downloads")}</span>
                        {pack.categories?.filter(isFtbCategoryTag).slice(0, 3).map(category => (
                          <CategoryBadge key={category} name={category} source="ftb" />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="ml-auto flex flex-shrink-0 items-center gap-2">
                    {projectPageUrl(pack, "modpack") && (
                      <button
                        type="button"
                        onClick={() => openProjectPage(pack, "modpack")}
                        title={t("common.openOnSite")}
                        aria-label={t("common.openOnSite")}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenDetails(pack)}
                      className="flex items-center gap-1.5 rounded-xl bg-muted/50 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <IconInfoCircle className="w-4 h-4" strokeWidth={1.75} />
                      {t("builds.details")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownload(pack)}
                      disabled={ftbDownloadingId === Number(pack.projectId)}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 hover:bg-primary/90"
                    >
                      {ftbDownloadingId === Number(pack.projectId)
                        ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t("builds.downloading")}</>
                        : <><IconDownload className="w-4 h-4" strokeWidth={1.75} />{t("builds.download")}</>}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          className="mt-auto"
        />
      </div>
    </div>
  )
}
