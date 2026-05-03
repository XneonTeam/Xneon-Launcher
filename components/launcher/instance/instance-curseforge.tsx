import { useTranslation } from "react-i18next"
import { IconSearch, IconDownload, IconLoader2 } from "@tabler/icons-react"
import { Spinner } from "./spinner"
import type { ModSearchResult } from "./types"

interface InstanceCurseForgeProps {
  cfSearch: string
  setCfSearch: (value: string) => void
  cfLoading: boolean
  cfResults: ModSearchResult[]
  cfDownloadingId: number | null
  onDownload: (pack: ModSearchResult) => void
}

export function InstanceCurseForge({ cfSearch, setCfSearch, cfLoading, cfResults, cfDownloadingId, onDownload }: InstanceCurseForgeProps) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="mb-4 relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={cfSearch}
          onChange={e => setCfSearch(e.target.value)}
          placeholder={t("builds.searchCurseForge")}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {cfLoading ? (
          <Spinner />
        ) : !cfSearch.trim() ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <IconSearch className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">{t("builds.searchModrinthDesc")}</p>
          </div>
        ) : cfResults.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t("builds.noResults")}</div>
        ) : (
          <div className="grid gap-3">
            {cfResults.map(pack => (
              <div key={pack.modId} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {pack.iconUrl ? <img src={pack.iconUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl">📦</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-foreground truncate">{pack.name}</p>
                    <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{pack.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDownload(pack)}
                    disabled={cfDownloadingId === pack.modId}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cfDownloadingId === pack.modId ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t("builds.downloading")}</> : <><IconDownload className="w-4 h-4" strokeWidth={1.75} />{t("builds.download")}</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
