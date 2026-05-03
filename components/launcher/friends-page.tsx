import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconDeviceGamepad2, IconUserPlus, IconSearch, IconUsers, IconMessageCircle, IconUserMinus } from "@tabler/icons-react"

const getAvatarUrl = (username: string) => {
  return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(username)}`
}

type FriendStatus = "online" | "offline" | "ingame"

interface Friend {
  id: string
  username: string
  status: FriendStatus
  game?: string
  server?: string
  lastSeen?: string
}

const STATUS_CONFIG: Record<FriendStatus, { dot: string; text: string }> = {
  online: { dot: "bg-green-500", text: "text-green-400" },
  offline: { dot: "bg-gray-500", text: "text-gray-400" },
  ingame: { dot: "bg-blue-500", text: "text-blue-400" },
}

const mockFriends: Friend[] = [
  { id: "1", username: "MAINER4IK", status: "offline", lastSeen: "5 мин назад" },
  { id: "2", username: "Znez999", status: "offline", lastSeen: "10 мин назад" },
  { id: "3", username: "Kreativ4ick", status: "offline", lastSeen: "15 мин назад" },
  { id: "4", username: "DDTYJIJ", status: "offline", lastSeen: "20 мин назад" },
]

const statusIcon = (status: FriendStatus) => {
  if (status === "ingame") {
    return <IconDeviceGamepad2 className="w-4 h-4" strokeWidth={1.5} />
  }
  return null
}

export function FriendsPage() {
  const { t } = useTranslation()
  const [friends] = useState<Friend[]>(mockFriends)
  const [filter, setFilter] = useState<FriendStatus | "all">("all")
  const [searchQuery, setSearchQuery] = useState("")

  const filtered = friends.filter(friend => {
    const matchesFilter = filter === "all" || friend.status === filter
    const matchesSearch = friend.username.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const onlineCount = friends.filter(f => f.status === "online" || f.status === "ingame").length

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border h-full flex flex-col">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

      <div className="relative z-10 p-6 flex flex-col h-full">
<div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <IconUsers className="w-5 h-5 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t("friends.title")}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t("friends.onlineCount", { count: onlineCount, total: friends.length })}
              </p>
            </div>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all duration-200 shadow-[0_0_15px_var(--glow-primary)]">
              <IconUserPlus className="w-5 h-5" strokeWidth={2} />
            {t("friends.addFriend")}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 relative">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={2} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("friends.searchFriends")}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4 p-1 rounded-lg bg-muted/40">
          {([
            { id: "all", label: t("friends.all"), icon: IconUsers },
            { id: "online", label: t("friends.online"), icon: IconUsers },
            { id: "ingame", label: t("friends.inGame"), icon: IconDeviceGamepad2 },
            { id: "offline", label: t("friends.offline"), icon: IconUserMinus },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                filter === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
              <IconUsers className="w-7 h-7 text-muted-foreground/40" strokeWidth={1.5} />
              </div>
              <p className="text-sm text-muted-foreground">{t("friends.noFriends")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((friend) => {
                const cfg = STATUS_CONFIG[friend.status]
                return (
                  <div
                    key={friend.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer"
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        src={getAvatarUrl(friend.username)}
                        alt={friend.username}
                        className="w-12 h-12 rounded-xl object-cover ring-2 ring-primary/30"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                          ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
                        }}
                      />
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center hidden">
                        <span className="text-lg font-bold text-muted-foreground">{friend.username[0]}</span>
                      </div>
                      <span className={cn("absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-card", cfg.dot)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{friend.username}</span>
                        {statusIcon(friend.status)}
                      </div>
                      <p className={cn("text-sm mt-0.5", cfg.text)}>
                        {friend.status === "online" ? t("friends.online") : friend.status === "ingame" ? t("friends.inGame") : t("friends.offline")}
                        {friend.game && ` · ${friend.game}`}
                        {friend.server && <span className="text-muted-foreground/70"> {t("friends.onServer", { server: friend.server })}</span>}
                      </p>
                      {friend.lastSeen && <p className="text-xs text-muted-foreground/60 mt-0.5">{t("friends.lastSeen", { time: friend.lastSeen })}</p>}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {friend.status === "ingame" && (
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-medium transition-colors">
                          <IconDeviceGamepad2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                          {t("friends.join")}
                        </button>
                      )}
                      <button className="p-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors">
                        <IconMessageCircle className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button className="p-2 rounded-lg bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors">
                        <IconUserMinus className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
