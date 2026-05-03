import { cn } from "@/lib/utils"
import { IconInfoCircle, IconDownload } from "@tabler/icons-react"
import { Spinner } from "./mods-ui"
import { formatDownloads } from "./utils"
import type { ModSearchResult, Source } from "./types"

interface ModsListProps {
  loading: boolean
  source: Source
  results: ModSearchResult[]
  onOpenMod: (item: ModSearchResult) => void
  onInstallMod: (item: ModSearchResult) => void
}

export function ModsList({ loading, source, results, onOpenMod, onInstallMod }: ModsListProps) {
  if (loading) return <Spinner />

  if (results.length === 0) return <p className="text-center text-muted-foreground py-12">No results found</p>

  const isCF = source === "curseforge"

  return (
    <div className="grid gap-3">
      {results.map(item => (
        <div key={item.id} className={cn("p-4 rounded-xl bg-card border border-border transition-colors flex items-center gap-4 group", isCF ? "hover:border-orange-500/50" : "hover:border-primary/50")}>
          {item.iconUrl ? (
            <img src={item.iconUrl} alt="" className="w-12 h-12 rounded-lg flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-muted-foreground">{item.name[0]}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={cn("font-semibold text-foreground transition-colors", isCF ? "group-hover:text-orange-400" : "group-hover:text-primary")}>{item.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-1">{item.summary}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-muted-foreground">{formatDownloads(item.downloadCount)} downloads</span>
              {item.categories?.slice(0, 2).map(cat => <span key={cat} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground capitalize">{cat}</span>)}
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); onOpenMod(item) }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"><IconInfoCircle className="w-4 h-4" strokeWidth={1.75} />Подробнее</button>
          <button onClick={e => { e.stopPropagation(); onInstallMod(item) }} className={cn("flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0", isCF ? "bg-orange-500 text-white hover:bg-orange-600" : "bg-primary text-primary-foreground hover:bg-primary/90")}><IconDownload className="w-4 h-4" strokeWidth={1.75} />Install</button>
        </div>
      ))}
    </div>
  )
}
