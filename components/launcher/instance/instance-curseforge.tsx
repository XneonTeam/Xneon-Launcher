import { useTranslation } from "react-i18next"
import { IconDownload, IconInfoCircle, IconLoader2 } from "@tabler/icons-react"
import { Spinner } from "./spinner"
import { formatDownloads } from "./utils"
import { InstanceBrowseToolbar } from "./instance-browse-toolbar"
import { Pagination } from "./pagination"
import type { ModSearchResult, ModSort } from "./types"

interface InstanceCurseForgeProps {
  cfSearch: string
  setCfSearch: (value: string) => void
  cfLoading: boolean
  cfResults: ModSearchResult[]
  cfDownloadingId: number | null
  sortBy: ModSort
  setSortBy: (value: ModSort) => void
  sortOptions: ModSort[]
  selectedVersion: string
  setSelectedVersion: (value: string) => void
  versionsLoaded: boolean
  versionOptions: string[]
  selectedModLoader: string
  setSelectedModLoader: (value: string) => void
  selectedCategory: string
  setSelectedCategory: (value: string) => void
  categoryOptions: string[]
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onOpenDetails: (pack: ModSearchResult) => void
  onDownload: (pack: ModSearchResult) => void
}

export function InstanceCurseForge({
  cfSearch,
  setCfSearch,
  cfLoading,
  cfResults,
  cfDownloadingId,
  sortBy,
  setSortBy,
  sortOptions,
  selectedVersion,
  setSelectedVersion,
  versionsLoaded,
  versionOptions,
  selectedModLoader,
  setSelectedModLoader,
  selectedCategory,
  setSelectedCategory,
  categoryOptions,
  page,
  totalPages,
  onPageChange,
  onOpenDetails,
  onDownload,
}: InstanceCurseForgeProps) {
  const { t } = useTranslation()

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <InstanceBrowseToolbar
        search={cfSearch}
        setSearch={setCfSearch}
        searchPlaceholder={t("builds.searchCurseForge")}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOptions={sortOptions}
        selectedVersion={selectedVersion}
        setSelectedVersion={setSelectedVersion}
        versionsLoaded={versionsLoaded}
        versionOptions={versionOptions}
        selectedModLoader={selectedModLoader}
        setSelectedModLoader={setSelectedModLoader}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        categoryOptions={categoryOptions}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {cfLoading ? (
          <Spinner />
        ) : cfResults.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t("builds.noResults")}</div>
        ) : (
          <div className="grid gap-3">
            {cfResults.map(pack => (
              <div key={pack.modId} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0 text-2xl">
                      {pack.iconUrl ? <img src={pack.iconUrl} alt="" className="w-full h-full object-cover" /> : "PK"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-foreground truncate">{pack.name}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{pack.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatDownloads(pack.downloadCount)} {t("builds.downloads")}</span>
                        {pack.categories?.slice(0, 3).map(category => (
                          <span key={category} className="rounded-md bg-primary/10 px-2 py-0.5 text-xs capitalize text-primary">{category}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="ml-auto flex flex-shrink-0 items-center gap-2">
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
                      disabled={cfDownloadingId === pack.modId}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 hover:bg-primary/90"
                    >
                      {cfDownloadingId === pack.modId
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
