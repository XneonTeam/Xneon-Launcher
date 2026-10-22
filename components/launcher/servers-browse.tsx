import { CONTENT_ENTER } from "./content-motion"
import { useTranslation } from "react-i18next"
import { EmptyState } from "@/components/ui/empty-state"
import { IconDownload, IconLoader2, IconInfoCircle } from "@tabler/icons-react"
import { Spinner } from "./instance/spinner"
import { formatDownloads } from "./instance/utils"
import { ServersBrowseToolbar } from "./servers-browse-toolbar"
import { Pagination } from "./instance/pagination"
import { CategoryBadge } from "./instance/category-badge"
import type { ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./instance/use-mod-search"
import type { ModSearchResult, ModSort } from "./instance/types"

interface ServersBrowseProps {
  source: "modrinth" | "curseforge"
  search: string
  setSearch: (value: string) => void
  loading: boolean
  results: ModSearchResult[]
  installingKey: string | null
  sortBy: ModSort
  setSortBy: (value: ModSort) => void
  sortOptions: ModSort[]
  selectedVersion: string
  setSelectedVersion: (value: string) => void
  versionsLoaded: boolean
  versionOptions: string[]
  selectedModLoader: string
  setSelectedModLoader: (value: string) => void
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onInstall: (project: ModSearchResult) => void
  onOpenDetails: (project: ModSearchResult) => void
  categories: Array<ModCategory & { source?: "modrinth" | "curseforge" }>
  modCategories: SelectedModCategory[]
  setModCategories: (value: SelectedModCategory[]) => void
}

export function ServersBrowse({
  source,
  search,
  setSearch,
  loading,
  results,
  installingKey,
  sortBy,
  setSortBy,
  sortOptions,
  selectedVersion,
  setSelectedVersion,
  versionsLoaded,
  versionOptions,
  selectedModLoader,
  setSelectedModLoader,
  page,
  totalPages,
  onPageChange,
  onInstall,
  onOpenDetails,
  categories,
  modCategories,
  setModCategories,
}: ServersBrowseProps) {
  const { t } = useTranslation()

  const projectKey = (project: ModSearchResult) =>
    source === "modrinth" ? project.slug : String(project.modId ?? project.id)

  return (
    <div data-ui="servers-browse-div-1" data-component="servers-browse" className="flex-1 min-h-0 flex flex-col">
      <ServersBrowseToolbar
        search={search}
        setSearch={setSearch}
        searchPlaceholder={t(source === "modrinth" ? "builds.searchModrinth" : "builds.searchCurseForge")}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOptions={sortOptions}
        selectedVersion={selectedVersion}
        setSelectedVersion={setSelectedVersion}
        versionsLoaded={versionsLoaded}
        versionOptions={versionOptions}
        selectedModLoader={selectedModLoader}
        setSelectedModLoader={setSelectedModLoader}
        categories={categories}
        modCategories={modCategories}
        setModCategories={setModCategories}
      />

      <div data-ui="servers-browse-div-2" className={`flex-1 overflow-y-auto overflow-x-hidden ${!loading ? CONTENT_ENTER : ""}`}>
        {loading ? (
          <Spinner />
        ) : results.length === 0 ? (
          <EmptyState title={t("builds.noResults")} className="h-full" />
        ) : (
          <div data-ui="servers-browse-div-3" className="grid gap-3">
            {results.map(project => {
              const isInstalling = installingKey === projectKey(project)
              return (
                <div data-ui="servers-browse-div-4" key={projectKey(project)} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                  <div data-ui="servers-browse-div-5" className="flex flex-wrap items-center gap-4">
                    <div data-ui="servers-browse-div-6" className="flex min-w-0 flex-1 items-center gap-4">
                      <div data-ui="servers-browse-div-7" className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0 text-2xl">
                        {project.iconUrl ? <img data-ui="servers-browse-img-1" src={project.iconUrl} alt="" /> : "PK"}
                      </div>
                      <div data-ui="servers-browse-div-8" className="flex-1 min-w-0">
                        <p data-ui="servers-browse-p-1" className="text-base font-semibold text-foreground truncate">{project.name}</p>
                        <p data-ui="servers-browse-p-2" className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{project.summary}</p>
                        <div data-ui="servers-browse-div-9" className="mt-2 flex flex-wrap items-center gap-2">
                          <span data-ui="servers-browse-span-1" className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatDownloads(project.downloadCount)} {t("builds.downloads")}</span>
                          {project.categories?.slice(0, 3).map(category => (
                            <CategoryBadge key={category} name={category} source={project.source} />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div data-ui="servers-browse-div-10" className="ml-auto flex flex-shrink-0 items-center gap-2">
                      <button data-ui="servers-browse-button-1"
                        type="button"
onClick={() => onOpenDetails(project)}
                      className="flex items-center gap-1.5 rounded-xl bg-muted/50 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <IconInfoCircle className="w-4 h-4" strokeWidth={1.75} />
                      {t("builds.details")}
                    </button>
                      <button data-ui="servers-browse-button-2"
                        type="button"
                        onClick={() => onInstall(project)}
                        disabled={installingKey !== null}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 hover:bg-primary/90"
                      >
                        {isInstalling
                          ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t("servers.installingModpack")}</>
                          : <><IconDownload className="w-4 h-4" strokeWidth={1.75} />{t("servers.installModpack")}</>}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
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
