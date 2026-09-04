import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { IconTrash, IconUserPlus, IconUsers } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import type { McPlayerEntry } from "@xnlc/types"

interface PlayersTabProps {
  serverId: string
}

type PlayerList = "whitelist" | "ops" | "banned" | "bannedIps"

export function PlayersTab({ serverId }: PlayersTabProps) {
  const { t } = useTranslation()
  const [activeList, setActiveList] = useState<PlayerList>("whitelist")
  const [newUsername, setNewUsername] = useState("")
  const [players, setPlayers] = useState<McPlayerEntry[]>([])
  const [loading, setLoading] = useState(false)

  const loadPlayers = useCallback(async () => {
    setLoading(true)
    try {
      let data: McPlayerEntry[] = []
      const api = window.electronAPI
      if (activeList === "whitelist") {
        data = await api?.mcServerGetWhitelist(serverId) ?? []
      } else if (activeList === "ops") {
        data = await api?.mcServerGetOps(serverId) ?? []
      } else if (activeList === "banned") {
        data = await api?.mcServerGetBanned(serverId) ?? []
      } else if (activeList === "bannedIps") {
        data = await api?.mcServerGetBannedIps(serverId) ?? []
      }
      setPlayers(data)
    } catch {
      setPlayers([])
    }
    setLoading(false)
  }, [serverId, activeList])

  useEffect(() => {
    loadPlayers()
  }, [loadPlayers])

  const handleAdd = async () => {
    if (!newUsername.trim()) return
    const api = window.electronAPI
    if (activeList === "whitelist") {
      await api?.mcServerAddWhitelist(serverId, newUsername.trim())
    } else if (activeList === "ops") {
      await api?.mcServerAddOp(serverId, newUsername.trim())
    } else if (activeList === "banned") {
      await api?.mcServerBanPlayer(serverId, newUsername.trim())
    } else if (activeList === "bannedIps") {
      await api?.mcServerBanIp(serverId, newUsername.trim())
    }
    setNewUsername("")
    loadPlayers()
  }

  const handleRemove = async (entry: McPlayerEntry) => {
    const api = window.electronAPI
    if (activeList === "whitelist") {
      await api?.mcServerRemoveWhitelist(serverId, entry.uuid)
    } else if (activeList === "ops") {
      await api?.mcServerRemoveOp(serverId, entry.uuid)
    } else if (activeList === "banned") {
      await api?.mcServerUnbanPlayer(serverId, entry.uuid)
    } else if (activeList === "bannedIps") {
      await api?.mcServerUnbanIp(serverId, entry.name)
    }
    loadPlayers()
  }

  const tabs: Array<{ id: PlayerList; labelKey: string }> = [
    { id: "whitelist", labelKey: "servers.whitelist" },
    { id: "ops", labelKey: "servers.operators" },
    { id: "banned", labelKey: "servers.banned" },
    { id: "bannedIps", labelKey: "servers.bannedIps" },
  ]

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/40">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveList(tab.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
              activeList === tab.id
                ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Add form */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconUserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            placeholder={t("servers.username")}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            onKeyDown={e => e.key === "Enter" && handleAdd()}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newUsername.trim()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]"
        >
          {t("servers.add")}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : players.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <IconUsers className="w-8 h-8 text-muted-foreground/30 mb-2" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">{t("servers.noEntries")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {players.map((entry) => (
              <div
                key={entry.uuid || entry.name}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={`https://mc-heads.net/avatar/${entry.name}/32`}
                    alt=""
                    className="w-8 h-8 rounded-lg"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
                  />
                  <span className="text-sm font-medium text-foreground">{entry.name}</span>
                </div>
                <button
                  onClick={() => handleRemove(entry)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <IconTrash className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
