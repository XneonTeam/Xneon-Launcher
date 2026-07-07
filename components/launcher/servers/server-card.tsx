import { memo } from "react"
import { cn } from "@/lib/utils"
import { IconPlugConnected, IconStar, IconTrash } from "@tabler/icons-react"
import type { ServerEntry } from "./types"
import { parseMotd } from "./motd"
import { formatPlayers } from "./utils"

type ServerCardProps = {
  server: ServerEntry
  onToggleFavorite: (ip: string) => void
  onRemove: (ip: string) => void
  onConnect: (server: ServerEntry) => void
}

export const ServerCard = memo(function ServerCard({ server, onToggleFavorite, onRemove, onConnect }: ServerCardProps) {
  const { status, loading, error } = server
  const isOnline = status?.online
  const latency = status?.latency_ms ?? 0
  const icon = status?.icon

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group">
      <div className="relative flex-shrink-0">
        {icon ? (
          <img
            src={icon}
            alt={server.name}
            className="w-14 h-14 rounded-xl object-cover shadow-lg"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none"
              ;(event.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden")
            }}
          />
        ) : null}
        <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center shadow-lg", icon ? "hidden" : "bg-background/80")}>
          <img src="/server-icon.png" alt="" className="w-12 h-12" />
        </div>

        {loading ? (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-card bg-gray-500 animate-pulse" />
        ) : (
          <span
            className={cn(
              "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-card",
              isOnline ? (latency < 60 ? "bg-green-500" : latency < 100 ? "bg-yellow-500" : "bg-red-500") : "bg-red-600"
            )}
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
            {server.name}
          </span>
          <button
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite(server.ip)
            }}
            className="transition-colors"
          >
            <IconStar className={cn("w-4 h-4", server.isFavorite ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30")} />
          </button>
        </div>

        <p className="text-sm text-muted-foreground font-mono">{server.ip}</p>

        {loading ? (
          <p className="text-xs text-muted-foreground mt-1 animate-pulse">Подключение...</p>
        ) : error ? (
          <p className="text-xs text-red-400 mt-1">{error}</p>
        ) : isOnline ? (
          <>
            <div className="mt-1 leading-tight overflow-hidden">
              {parseMotd(status?.motd_raw ?? "")}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-xs text-muted-foreground">
                <span className="text-green-400">{formatPlayers(status?.players_online ?? 0)}</span> / {formatPlayers(status?.players_max ?? 0)} игроков
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                {status?.version ?? ""}
              </span>
              <span className={cn("text-xs font-medium", latency < 60 ? "text-green-400" : latency < 100 ? "text-yellow-400" : "text-red-400")}>
                {latency} ms
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs text-red-400 mt-1">Сервер оффлайн</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {isOnline ? (
          <button
            onClick={() => onConnect(server)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
          >
            <IconPlugConnected className="w-3.5 h-3.5" strokeWidth={1.75} />
            Подключиться
          </button>
        ) : null}
        <button
          onClick={() => onRemove(server.ip)}
          className="p-2 rounded-lg bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <IconTrash className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
})
