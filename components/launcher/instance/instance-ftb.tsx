import { useTranslation } from "react-i18next"
import { IconDownload, IconInfoCircle, IconLoader2, IconSearch } from "@tabler/icons-react"
import { Spinner } from "./spinner"
import { formatDownloads } from "./utils"
import { Pagination } from "./pagination"
import type { ModSearchResult } from "./types"

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
}

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
}: InstanceFtbProps) {
  const { t } = useTranslation()

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
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {ftbLoading ? (
          <Spinner />
        ) : ftbResults.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t("builds.noResults")}</div>
        ) : (
          <div className="grid gap-3">
            {ftbResults.map(pack => (
              <div key={pack.projectId} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0 text-2xl">
                      {pack.iconUrl ? <img src={pack.iconUrl} alt="" className="w-full h-full object-cover" /> : "FTB"}
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
