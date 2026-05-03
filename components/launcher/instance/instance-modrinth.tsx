import { useTranslation } from "react-i18next"
import { IconSearch, IconDownload, IconLoader2 } from "@tabler/icons-react"
import { Spinner } from "./spinner"
import { formatDownloads } from "./utils"
import type { ModSearchResult } from "./types"

interface InstanceModrinthProps {
  search: string
  setSearch: (value: string) => void
  loading: boolean
  results: ModSearchResult[]
  downloadingSlug: string | null
  onDownload: (project: ModSearchResult) => void
}

export function InstanceModrinth({ search, setSearch, loading, results, downloadingSlug, onDownload }: InstanceModrinthProps) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="mb-4 relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t("builds.searchModrinth")}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <Spinner />
        ) : !search.trim() ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <IconSearch className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">{t("builds.searchModrinthDesc")}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t("builds.noResults")}</div>
        ) : (
          <div className="grid gap-3">
            {results.map(project => (
              <div key={project.slug} className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-muted/70 flex items-center justify-center overflow-hidden flex-shrink-0 text-2xl">
                    {project.iconUrl ? <img src={project.iconUrl} alt="" className="w-full h-full object-cover" /> : "📦"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-foreground truncate">{project.name}</p>
                    <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{project.summary}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground">{formatDownloads(project.downloadCount)} {t("builds.downloads")}</span>
                      {project.categories?.slice(0, 3).map(category => (
                        <span key={category} className="px-2 py-0.5 rounded-md bg-primary/10 text-xs text-primary capitalize">{category}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDownload(project)}
                    disabled={downloadingSlug === project.slug}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {downloadingSlug === project.slug ? <><IconLoader2 className="w-4 h-4 animate-spin" />{t("builds.downloading")}</> : <><IconDownload className="w-4 h-4" strokeWidth={1.75} />{t("builds.download")}</>}
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
