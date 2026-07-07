import { memo } from "react"
import { cn } from "@/lib/utils"
import { IconPlus } from "@tabler/icons-react"
import { formatPlayers } from "./utils"

type SearchResultCardProps = {
  server: HotmcServerSearchResult
  alreadyAdded: boolean
  addingIp: string | null
  onAdd: (server: HotmcServerSearchResult) => void
}

export const SearchResultCard = memo(function SearchResultCard({
  server,
  alreadyAdded,
  addingIp,
  onAdd,
}: SearchResultCardProps) {
  const banner = server.bannerUrl || server.avatarUrl

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border/70 bg-background/30">
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-muted/50 flex items-center justify-center flex-shrink-0">
        {banner ? (
          <img src={banner} alt={server.name} className="w-full h-full object-cover" />
        ) : (
          <img src="/server-icon.png" alt="" className="w-12 h-12" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground truncate">{server.name}</span>
          <span className={cn("text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full", server.isOnline ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400")}>
            {server.isOnline ? "HotMC online" : "HotMC offline"}
          </span>
        </div>

        <p className="text-sm text-muted-foreground font-mono truncate">{server.ip}</p>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{server.description || "Описание не указано"}</p>

        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>{formatPlayers(server.playersOnline)} / {formatPlayers(server.playersMax)} игроков</span>
          {server.version ? <span className="px-2 py-0.5 rounded bg-muted">{server.version}</span> : null}
          {server.country ? <span>{server.country}</span> : null}
          {server.rank ? <span>{server.rank}</span> : null}
        </div>
      </div>

      <button
        disabled={alreadyAdded || addingIp === server.ip}
        onClick={() => onAdd(server)}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <IconPlus className="w-4 h-4" />
        {alreadyAdded ? "Уже добавлен" : addingIp === server.ip ? "Добавление..." : "Добавить"}
      </button>
    </div>
  )
})
