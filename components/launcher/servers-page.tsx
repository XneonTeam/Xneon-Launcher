import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconCircleX,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer,
  IconStar,
  IconTrash,
  IconX,
} from "@tabler/icons-react"

const SERVER_LIST = [
  { name: "Hypixel", ip: "mc.hypixel.net" },
  { name: "Mineplex", ip: "us.mineplex.com" },
  { name: "CubeCraft", ip: "play.cubecraft.net" },
  { name: "2b2t", ip: "2b2t.org" },
  { name: "Wynncraft", ip: "play.wynncraft.com" },
  { name: "ManaCube", ip: "play.manacube.com" },
]
const SERVER_STATUS_UPDATE_INTERVAL_MS = 10_000

interface ServerStatus {
  online: boolean
  ip: string
  port: number
  players_online: number
  players_max: number
  motd_raw?: string
  motd_clean?: string
  version: string
  latency_ms: number
  icon?: string
}

interface ServerEntry {
  name: string
  ip: string
  status: ServerStatus | null
  loading: boolean
  error: string | null
  isFavorite: boolean
}

interface MotdExtraEntry {
  text?: string
  extra?: Array<MotdExtraEntry | string>
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
}

const COLOR_MAP: Record<string, string> = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  a: "#55FF55",
  b: "#55FFFF",
  c: "#FF5555",
  d: "#FF55FF",
  e: "#FFFF55",
  f: "#FFFFFF",
  black: "#000000",
  dark_blue: "#0000AA",
  dark_green: "#00AA00",
  dark_aqua: "#00AAAA",
  dark_red: "#AA0000",
  dark_purple: "#AA00AA",
  gold: "#FFAA00",
  gray: "#AAAAAA",
  dark_gray: "#555555",
  blue: "#5555FF",
  green: "#55FF55",
  aqua: "#55FFFF",
  red: "#FF5555",
  light_purple: "#FF55FF",
  yellow: "#FFFF55",
  white: "#FFFFFF",
}

const FORMATTING_MAP: Record<string, string> = {
  l: "font-weight:bold",
  m: "text-decoration:line-through",
  n: "text-decoration:underline",
  o: "font-style:italic",
}

function createOfflineStatus(ip: string): ServerStatus {
  return {
    online: false,
    ip,
    port: 0,
    players_online: 0,
    players_max: 0,
    motd_clean: "",
    version: "",
    latency_ms: 0,
  }
}

function normalizeServerStatus(ip: string, payload: unknown): ServerStatus {
  const value = payload && typeof payload === "object" ? payload as Partial<ServerStatus> : {}

  return {
    online: typeof value.online === "boolean" ? value.online : false,
    ip: typeof value.ip === "string" && value.ip.trim() ? value.ip : ip,
    port: typeof value.port === "number" ? value.port : 0,
    players_online: typeof value.players_online === "number" ? value.players_online : 0,
    players_max: typeof value.players_max === "number" ? value.players_max : 0,
    motd_raw: typeof value.motd_raw === "string" ? value.motd_raw : undefined,
    motd_clean: typeof value.motd_clean === "string" ? value.motd_clean : "",
    version: typeof value.version === "string" ? value.version : "",
    latency_ms: typeof value.latency_ms === "number" ? value.latency_ms : 0,
    icon: typeof value.icon === "string" ? value.icon : undefined,
  }
}

function resolveMinecraftColor(color: string | undefined, fallback: string) {
  if (!color) return fallback
  if (color.startsWith("#")) return color
  return COLOR_MAP[color.toLowerCase()] || fallback
}

function renderExtraEntry(
  entry: MotdExtraEntry | string,
  inheritedColor: string,
  inheritedBold: boolean,
  inheritedItalic: boolean,
  inheritedUnderline: boolean,
  inheritedStrikethrough: boolean,
  keyPrefix: string,
  keyIdx: number
): ReactNode {
  if (typeof entry === "string") {
    if (entry === "\n") return <br key={`${keyPrefix}-br-${keyIdx}`} />
    return (
      <span
        key={`${keyPrefix}-${keyIdx}`}
        style={{
          color: inheritedColor,
          fontWeight: inheritedBold ? "bold" : "normal",
          fontStyle: inheritedItalic ? "italic" : "normal",
          textDecoration: [
            inheritedUnderline ? "underline" : "",
            inheritedStrikethrough ? "line-through" : "",
          ].filter(Boolean).join(" ") || "none",
          textShadow: inheritedBold ? `0 0 2px ${inheritedColor}40, 0 0 6px ${inheritedColor}20` : "none",
        }}
      >
        {entry}
      </span>
    )
  }

  if (entry.text === "\n") {
    return <br key={`${keyPrefix}-br-${keyIdx}`} />
  }

  const color = resolveMinecraftColor(entry.color, inheritedColor)
  const bold = entry.bold !== undefined ? entry.bold : inheritedBold
  const italic = entry.italic !== undefined ? entry.italic : inheritedItalic
  const underline = entry.underlined !== undefined ? entry.underlined : inheritedUnderline
  const strikethrough = entry.strikethrough !== undefined ? entry.strikethrough : inheritedStrikethrough
  const children: ReactNode[] = []

  if (entry.text && entry.text !== "\n") {
    children.push(
      <span
        key={`${keyPrefix}-${keyIdx}`}
        style={{
          color,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          textDecoration: [underline ? "underline" : "", strikethrough ? "line-through" : ""]
            .filter(Boolean)
            .join(" ") || "none",
          textShadow: bold ? `0 0 2px ${color}40, 0 0 6px ${color}20` : "none",
        }}
      >
        {entry.text}
      </span>
    )
  }

  if (entry.extra) {
    entry.extra.forEach((child, childIdx) => {
      children.push(
        renderExtraEntry(child, color, bold, italic, underline, strikethrough, `${keyPrefix}-${keyIdx}`, childIdx)
      )
    })
  }

  return <span key={`${keyPrefix}-wrap-${keyIdx}`}>{children}</span>
}

function parseMotd(raw: string): ReactNode[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as MotdExtraEntry | MotdExtraEntry[]

    if (Array.isArray(parsed)) {
      return [
        <div key="motd-json-array" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {parsed.map((entry, idx) =>
            renderExtraEntry(entry, "#AAAAAA", false, false, false, false, "motd-array", idx)
          )}
        </div>,
      ]
    }

    if (parsed && typeof parsed === "object") {
      if (parsed.text && /§[0-9a-fk-or]/i.test(parsed.text)) {
        return parseMotd(parsed.text)
      }

      const entries: Array<MotdExtraEntry | string> = []
      if (parsed.text) {
        entries.push({
          text: parsed.text,
          color: parsed.color,
          bold: parsed.bold,
          italic: parsed.italic,
          underlined: parsed.underlined,
          strikethrough: parsed.strikethrough,
        })
      }
      if (parsed.extra) {
        entries.push(...parsed.extra)
      }

      return [
        <div key="motd-json-object" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {entries.map((entry, idx) =>
            renderExtraEntry(entry, "#AAAAAA", false, false, false, false, "motd-object", idx)
          )}
        </div>,
      ]
    }
  } catch {
    // fall back to legacy section-code parsing
  }

  const lines = raw.split(/\r?\n/)
  return lines.map((line, lineIdx) => {
    const parts = line.split(/§([0-9a-fk-or])/gi)
    const rendered: ReactNode[] = []
    let color = "#AAAAAA"
    let bold = false
    let italic = false
    let underline = false
    let strikethrough = false

    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts[index]
      if (index % 2 === 1) {
        const code = segment.toLowerCase()
        if (code === "r") {
          color = "#AAAAAA"
          bold = false
          italic = false
          underline = false
          strikethrough = false
        } else if (COLOR_MAP[code]) {
          color = COLOR_MAP[code]
          bold = false
          italic = false
          underline = false
          strikethrough = false
        } else {
          const style = FORMATTING_MAP[code]
          if (style) {
            if (style.includes("bold")) bold = true
            if (style.includes("italic")) italic = true
            if (style.includes("underline")) underline = true
            if (style.includes("line-through")) strikethrough = true
          }
        }
      } else if (segment) {
        const styleObj: CSSProperties = {
          color,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          textShadow: bold ? `0 0 2px ${color}40, 0 0 6px ${color}20` : "none",
        }
        const decoration = [underline ? "underline" : "", strikethrough ? "line-through" : ""]
          .filter(Boolean)
          .join(" ")
        if (decoration) {
          styleObj.textDecoration = decoration
        }

        rendered.push(
          <span key={`${lineIdx}-${index}`} style={styleObj}>
            {segment}
          </span>
        )
      }
    }

    return (
      <div key={lineIdx} className="leading-tight text-xs whitespace-pre-wrap break-words">
        {rendered}
      </div>
    )
  })
}

function formatPlayers(value: number) {
  return value.toLocaleString("ru-RU")
}

function buildServerEntry(server: { name: string; ip: string; isFavorite?: boolean }): ServerEntry {
  return {
    name: server.name,
    ip: server.ip,
    status: null,
    loading: true,
    error: null,
    isFavorite: server.isFavorite ?? false,
  }
}

type ServerCardProps = {
  server: ServerEntry
  onToggleFavorite: (ip: string) => void
  onRemove: (ip: string) => void
  onConnect: (server: ServerEntry) => void
}

const ServerCard = memo(function ServerCard({ server, onToggleFavorite, onRemove, onConnect }: ServerCardProps) {
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

type SearchResultCardProps = {
  server: HotmcServerSearchResult
  alreadyAdded: boolean
  addingIp: string | null
  onAdd: (server: HotmcServerSearchResult) => void
}

const SearchResultCard = memo(function SearchResultCard({
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

export function ServersPage() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIp, setNewIp] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [searchingHotmc, setSearchingHotmc] = useState(false)
  const [hotmcError, setHotmcError] = useState<string | null>(null)
  const [hotmcResults, setHotmcResults] = useState<HotmcServerSearchResult[]>([])
  const [addingHotmcIp, setAddingHotmcIp] = useState<string | null>(null)
  const hotmcRequestRef = useRef(0)
  const refreshInFlightRef = useRef(false)

  const refreshServerStatuses = useCallback(async (entries: ServerEntry[], showRefreshing = false) => {
    if (entries.length === 0 || refreshInFlightRef.current) {
      return
    }

    refreshInFlightRef.current = true
    const targetIps = new Set(entries.map((entry) => entry.ip))

    setServers((prev) =>
      prev.map((entry) =>
        targetIps.has(entry.ip)
          ? { ...entry, loading: true, error: null }
          : entry
      )
    )

    if (showRefreshing) {
      setRefreshing(true)
    }

    try {
      const response = await window.electronAPI?.checkServerStatuses(entries.map((entry) => entry.ip))
      if (!response) {
        throw new Error("Server status API is unavailable")
      }

      const resultMap = new Map(response.results.map((entry) => [entry.ip, entry]))
      setServers((prev) =>
        prev.map((entry) => {
          const result = resultMap.get(entry.ip)
          if (!result) {
            return entry
          }

          return {
            ...entry,
            status: normalizeServerStatus(entry.ip, result.result),
            loading: false,
            error: result.error ?? null,
          }
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setServers((prev) =>
        prev.map((entry) =>
          targetIps.has(entry.ip)
            ? { ...entry, status: createOfflineStatus(entry.ip), loading: false, error: message }
            : entry,
        ),
      )
    } finally {
      refreshInFlightRef.current = false
      if (showRefreshing) {
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadSavedServers = async () => {
      let savedServers: Array<{ name: string; ip: string; isFavorite?: boolean }> = []

      try {
        const raw = await window.electronAPI?.getSetting("servers_list")
        if (raw) {
          savedServers = JSON.parse(raw) as Array<{ name: string; ip: string; isFavorite?: boolean }>
        }
      } catch {
        savedServers = []
      }

      const nextServers = (savedServers.length > 0 ? savedServers : SERVER_LIST).map(buildServerEntry)
      if (!cancelled) {
        setServers(nextServers)
        setInitialized(true)
      }
    }

    void loadSavedServers()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!initialized) {
      return
    }

    const persistData = servers.map((server) => ({
      name: server.name,
      ip: server.ip,
      isFavorite: server.isFavorite,
    }))

    void window.electronAPI?.setSetting("servers_list", JSON.stringify(persistData))
    void window.electronAPI?.writeServersDat(servers.map((server) => ({ name: server.name, ip: server.ip })))
  }, [initialized, servers])

  useEffect(() => {
    if (!initialized) {
      return
    }

    const pendingServers = servers.filter((server) => server.loading)
    if (pendingServers.length === 0) {
      return
    }

    void refreshServerStatuses(pendingServers)
  }, [initialized, refreshServerStatuses, servers])

  useEffect(() => {
    if (!initialized || servers.length === 0) {
      return
    }

    const intervalId = window.setInterval(() => {
      void refreshServerStatuses(servers)
    }, SERVER_STATUS_UPDATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [initialized, refreshServerStatuses, servers])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [searchQuery])

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      hotmcRequestRef.current += 1
      setSearchingHotmc(false)
      setHotmcError(null)
      setHotmcResults([])
      return
    }

    const requestId = hotmcRequestRef.current + 1
    hotmcRequestRef.current = requestId
    setSearchingHotmc(true)
    setHotmcError(null)

    const promise = window.electronAPI?.searchHotmcServers(debouncedQuery, 10, 0, false)
    if (!promise) { setSearchingHotmc(false); return }

    promise.then((response) => {
        if (hotmcRequestRef.current !== requestId) {
          return
        }

        if (!response.success) {
          setHotmcResults([])
          setHotmcError(response.error ?? "Не удалось загрузить серверы HotMC")
          return
        }

        setHotmcResults(response.results)
      })
      .catch((error: unknown) => {
        if (hotmcRequestRef.current !== requestId) {
          return
        }

        setHotmcResults([])
        setHotmcError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (hotmcRequestRef.current === requestId) {
          setSearchingHotmc(false)
        }
      })
  }, [debouncedQuery])

  const filteredServers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return servers
    }

    return servers.filter((server) =>
      server.name.toLowerCase().includes(normalizedQuery) ||
      server.ip.toLowerCase().includes(normalizedQuery)
    )
  }, [searchQuery, servers])

  const favoriteServers = useMemo(() => filteredServers.filter((server) => server.isFavorite), [filteredServers])
  const onlineServers = useMemo(() => filteredServers.filter((server) => server.status?.online && !server.isFavorite), [filteredServers])
  const offlineServers = useMemo(() => filteredServers.filter((server) => !server.status?.online && !server.isFavorite), [filteredServers])
  const onlineCount = useMemo(() => servers.filter((server) => server.status?.online).length, [servers])
  const existingIps = useMemo(() => new Set(servers.map((server) => server.ip.toLowerCase())), [servers])

  const toggleFavorite = useCallback((ip: string) => {
    setServers((prev) => prev.map((server) => (server.ip === ip ? { ...server, isFavorite: !server.isFavorite } : server)))
  }, [])

  const removeServer = useCallback((ip: string) => {
    setServers((prev) => prev.filter((server) => server.ip !== ip))
  }, [])

  const handleRefresh = useCallback(() => {
    void refreshServerStatuses(servers, true)
  }, [refreshServerStatuses, servers])

  const handleAddManualServer = useCallback(() => {
    const trimmedName = newName.trim()
    const trimmedIp = newIp.trim()

    if (!trimmedName || !trimmedIp) {
      return
    }

    setServers((prev) => {
      if (prev.some((server) => server.ip.toLowerCase() === trimmedIp.toLowerCase())) {
        return prev
      }

      return [
        ...prev,
        buildServerEntry({ name: trimmedName, ip: trimmedIp, isFavorite: false }),
      ]
    })

    setNewName("")
    setNewIp("")
    setShowAddModal(false)
  }, [newIp, newName])

  const handleAddHotmcServer = useCallback(async (server: HotmcServerSearchResult) => {
    setAddingHotmcIp(server.ip)

    try {
      setServers((prev) => {
        if (prev.some((entry) => entry.ip.toLowerCase() === server.ip.toLowerCase())) {
          return prev
        }

        return [
          ...prev,
          buildServerEntry({
            name: server.name,
            ip: server.ip,
            isFavorite: false,
          }),
        ]
      })
    } finally {
      setAddingHotmcIp(null)
    }
  }, [])

  const handleConnect = useCallback((server: ServerEntry) => {
    void window.electronAPI?.writeServersDat([{ name: server.name, ip: server.ip }])
  }, [])

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border h-[calc(100vh-5rem)] flex flex-col">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

      <div className="relative z-10 p-4 flex flex-col h-full">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t("servers.title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {onlineCount} / {servers.length} онлайн
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm disabled:opacity-50"
            >
              <IconRefresh className={cn("w-4 h-4", refreshing && "animate-spin")} />
              {t("servers.refresh")}
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all duration-200 shadow-[0_0_15px_var(--glow-primary)]"
            >
              <IconPlus className="w-5 h-5" />
              {t("servers.addServer")}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 relative">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("servers.search")}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-6 mt-4 space-y-4">
          {debouncedQuery.length >= 2 ? (
            <div className="rounded-2xl border border-border/70 bg-muted/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Публичный поиск HotMC</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Запрос идёт через `hotmc-parser` с debounce и кэшем в main-процессе.
                  </p>
                </div>
                {searchingHotmc ? <span className="text-xs text-muted-foreground animate-pulse">Загрузка...</span> : null}
              </div>

              {hotmcError ? (
                <p className="text-xs text-red-400 mt-3">{hotmcError}</p>
              ) : null}

              {!searchingHotmc && !hotmcError && hotmcResults.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-3">Совпадений не найдено.</p>
              ) : null}

              {hotmcResults.length > 0 ? (
                <div className="space-y-2 mt-3">
                  {hotmcResults.map((server) => (
                    <SearchResultCard
                      key={server.pageUrl}
                      server={server}
                      alreadyAdded={existingIps.has(server.ip.toLowerCase())}
                      addingIp={addingHotmcIp}
                      onAdd={handleAddHotmcServer}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {filteredServers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
                <IconServer className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">{t("servers.noServers")}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t("servers.noServersDesc")}</p>
            </div>
          ) : (
            <>
              {favoriteServers.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-yellow-400 flex items-center gap-2">
                    <IconStar className="w-4 h-4 fill-yellow-400" />
                    Избранные ({favoriteServers.length})
                  </h3>
                  <div className="space-y-2 mt-2">
                    {favoriteServers.map((server) => (
                      <ServerCard
                        key={server.ip}
                        server={server}
                        onToggleFavorite={toggleFavorite}
                        onRemove={removeServer}
                        onConnect={handleConnect}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {onlineServers.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-green-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Онлайн ({onlineServers.length})
                  </h3>
                  <div className="space-y-2 mt-2">
                    {onlineServers.map((server) => (
                      <ServerCard
                        key={server.ip}
                        server={server}
                        onToggleFavorite={toggleFavorite}
                        onRemove={removeServer}
                        onConnect={handleConnect}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {offlineServers.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    Оффлайн ({offlineServers.length})
                  </h3>
                  <div className="space-y-2 mt-2">
                    {offlineServers.map((server) => (
                      <ServerCard
                        key={server.ip}
                        server={server}
                        onToggleFavorite={toggleFavorite}
                        onRemove={removeServer}
                        onConnect={handleConnect}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {showAddModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">{t("servers.addServer")}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mt-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t("servers.name")}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={t("servers.myServer")}
                  className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t("servers.ipAddress")}</label>
                <input
                  type="text"
                  value={newIp}
                  onChange={(event) => setNewIp(event.target.value)}
                  placeholder="play.example.com"
                  className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                >
                  <IconCircleX className="w-4 h-4" strokeWidth={1.75} />
                  {t("servers.cancel")}
                </button>

                <button
                  disabled={!newName.trim() || !newIp.trim()}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleAddManualServer}
                >
                  <IconPlus className="w-4 h-4" strokeWidth={1.75} />
                  {t("servers.add")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
