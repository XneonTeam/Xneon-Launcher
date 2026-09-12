import { useTranslation } from "react-i18next"
import { IconDownload, IconLoader2, IconCircleX, IconInfoCircle } from "@tabler/icons-react"
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
    <div className="flex-1 min-h-0 flex flex-col">
      <ServersBrowseToolbar
        search={search}
        setSearch={setSearch}
        searchPlaceholder={t(`servers.marketplace${source === "modrinth" ? "Modrinth" : "Curseforge"}`)}
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

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loading ? (
          <Spinner />
        ) : results.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <IconCircleX className="w-8 h-8 text-muted-foreground/50" />
              {t("builds.noResults")}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {results.map(project => {
              const isInstalling = installingKey === projectKey(project)
              return (
                <div key={projectKey(project)} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0 text-2xl">
                        {project.iconUrl ? <img src={project.iconUrl} alt="" /> : "PK"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-foreground truncate">{project.name}</p>
                        <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{project.summary}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatDownloads(project.downloadCount)} {t("builds.downloads")}</span>
                          {project.categories?.slice(0, 3).map(category => (
                            <CategoryBadge key={category} name={category} source={project.source} />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="ml-auto flex flex-shrink-0 items-center gap-2">
                      <button
                        type="button"
onClick={() => onOpenDetails(project)}
                      className="flex items-center gap-1.5 rounded-xl bg-muted/50 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <IconInfoCircle className="w-4 h-4" strokeWidth={1.75} />
                      {t("builds.details")}
                    </button>
                      <button
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