import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconChevronDown,
  IconChevronUp,
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
import { useAccounts } from "@/src/AccountsContext"
import { loadLaunchSettings, resolveLaunchDimensions } from "@/src/hooks/use-build-launch"
import type { Build } from "./types"

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
  error?: string
}

interface ServerEntry {
  name: string
  ip: string
  status: ServerStatus | null
  loading: boolean
  error: string | null
  isFavorite: boolean
}

interface InstanceServersTabProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

async function fetchServerStatus(ip: string): Promise<ServerStatus> {
  const api = window.electronAPI
  if (!api?.pingServer) throw new Error("Ping API unavailable")
  const result = await api.pingServer(ip)
  if (!result.online && result.error) throw new Error(result.error)
  return result
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

interface MotdExtraEntry {
  text?: string
  extra?: Array<MotdExtraEntry | string>
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
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
          ]
            .filter(Boolean)
            .join(" ") || "none",
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
      if (parsed.text && /\u00A7[0-9a-fk-or]/i.test(parsed.text)) {
        return parseMotd(parsed.text)
      }
      const entries: Array<MotdExtraEntry | string> = []
      if (parsed.text) entries.push({ text: parsed.text, color: parsed.color, bold: parsed.bold, italic: parsed.italic, underlined: parsed.underlined, strikethrough: parsed.strikethrough })
      if (parsed.extra) entries.push(...parsed.extra)

      return [
        <div key="motd-json-object" className="leading-tight text-xs whitespace-pre-wrap break-words">
          {entries.map((entry, idx) =>
            renderExtraEntry(entry, "#AAAAAA", false, false, false, false, "motd-object", idx)
          )}
        </div>,
      ]
    }
  } catch {
    // Not JSON, fall back to legacy parsing
  }

  const lines = raw.split(/\r?\n/)
  return lines.map((line, lineIdx) => {
    const parts = line.split(/\u00A7([0-9a-fk-or])/gi)
    const rendered: React.ReactNode[] = []
    let color = "#AAAAAA"
    let bold = false
    let italic = false
    let underline = false
    let strikethrough = false

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]
      if (i % 2 === 1) {
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
        const styleObj: React.CSSProperties = {
          color,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          textShadow:
            bold
              ? `0 0 2px ${color}40, 0 0 6px ${color}20`
              : "none",
        }
        const decoration = [
          underline ? "underline" : "",
          strikethrough ? "line-through" : "",
        ]
          .filter(Boolean)
          .join(" ")
        if (decoration) styleObj.textDecoration = decoration

        rendered.push(
          <span
            key={`${lineIdx}-${i}`}
            style={styleObj}
          >
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

export function InstanceServersTab({ build, updateBuild }: InstanceServersTabProps) {
  const { t } = useTranslation()
  const { activeAccount } = useAccounts()
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIp, setNewIp] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [connectingIp, setConnectingIp] = useState<string | null>(null)

  // Load saved servers on mount (from servers.dat + favorites from localStorage)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Load favorites from localStorage
      let favoriteIps: Set<string> = new Set()
      try {
        const raw = await window.electronAPI?.getSetting("servers_favorites")
        if (raw) {
          const favs: string[] = JSON.parse(raw)
          favoriteIps = new Set(favs)
        }
      } catch {}

      // Load base server list from servers.dat
      let serverList: Array<{ name: string; ip: string }> = []
      try {
        const datServers = await window.electronAPI?.listServers(build.name)
        if (datServers && datServers.length > 0) {
          serverList = datServers
        }
      } catch {}

      const list = serverList.map((s) => ({
        name: s.name,
        ip: s.ip,
        status: null,
        loading: true,
        error: null,
        isFavorite: favoriteIps.has(s.ip),
      }))

      if (!cancelled) {
        setServers(list)
        setInitialized(true)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [build.name])

  // Save servers to servers.dat + favorites to localStorage whenever servers change
  useEffect(() => {
    if (!initialized) return

    const favoriteIps = servers.filter((s) => s.isFavorite).map((s) => s.ip)
    void window.electronAPI?.setSetting("servers_favorites", JSON.stringify(favoriteIps))
    void window.electronAPI?.writeServersDat(build.name, servers.map((s) => ({ name: s.name, ip: s.ip })))
  }, [servers, initialized, build.name])

  const fetchAll = useCallback(async () => {
    setRefreshing(true)
    const currentServers = servers
    await Promise.allSettled(
      currentServers.map(async (s) => {
        try {
          const status = await fetchServerStatus(s.ip)
          setServers((prev) =>
            prev.map((p) => (p.ip === s.ip ? { ...p, status, loading: false, error: null } : p))
          )
        } catch (err: any) {
          setServers((prev) =>
            prev.map((p) => (p.ip === s.ip ? { ...p, loading: false, error: err.message } : p))
          )
        }
      })
    )
    setRefreshing(false)
  }, [servers])

  // Fetch status for all servers once initialized
  useEffect(() => {
    if (!initialized) return
    let cancelled = false
    const run = async () => {
      setServers((prev) => prev.map((p) => ({ ...p, loading: true, error: null })))
      const currentServers = servers.length > 0 ? servers : []
      await Promise.allSettled(
        currentServers.map(async (s) => {
          try {
            const status = await fetchServerStatus(s.ip)
            if (!cancelled) {
              setServers((prev) =>
                prev.map((p) => (p.ip === s.ip ? { ...p, status, loading: false, error: null } : p))
              )
            }
          } catch (err: any) {
            if (!cancelled) {
              setServers((prev) =>
                prev.map((p) =>
                  p.ip === s.ip
                    ? { ...p, loading: false, error: err.message, status: { online: false, ip: s.ip, port: 0, players_online: 0, players_max: 0, motd_clean: "", version: "", latency_ms: 0 } }
                    : p
                )
              )
            }
          }
        })
      )
    }
    void run()
    return () => { cancelled = true }
  }, [initialized])

  const filtered = servers.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.ip.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const favoriteServers = filtered.filter((s) => s.isFavorite)
  const onlineServers = filtered.filter((s) => s.status?.online && !s.isFavorite)
  const offlineServers = filtered.filter((s) => !s.status?.online && !s.isFavorite)

  const toggleFavorite = (ip: string) =>
    setServers((prev) => prev.map((p) => (p.ip === ip ? { ...p, isFavorite: !p.isFavorite } : p)))

  const moveServer = (ip: string, dir: -1 | 1) =>
    setServers((prev) => {
      const idx = prev.findIndex((p) => p.ip === ip)
      const target = idx + dir
      if (idx < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return next
    })

  const formatPlayers = (n: number) => n.toLocaleString("ru-RU")

  const connectToServer = async (server: ServerEntry) => {
    const status = server.status
    if (!status?.online || !status.ip || !activeAccount) return
    setConnectingIp(server.ip)
    try {
      const settings = await loadLaunchSettings()
      const { width, height } = resolveLaunchDimensions(settings)

      const intentPath = build.name ? await window.electronAPI.getBuildIntentPath(build.name) : undefined

      await window.electronAPI.launchMinecraft({
        version: build.version,
        modLoader: build.modLoader as "vanilla" | "forge" | "fabric" | "quilt" | "liteloader" | "optifine" | "neoforge",
        ...(build.loaderVersion ? { loaderVersion: build.loaderVersion } : {}),
        account: { type: activeAccount.type, username: activeAccount.username, uuid: activeAccount.uuid, accessToken: activeAccount.accessToken },
        memory: { min: build.javaOverride && build.memoryMin ? build.memoryMin : (settings.savedMemoryMin || "512M"), max: build.javaOverride && build.memoryMax ? build.memoryMax : (settings.savedMemoryMax || "4G") },
        javaPath: build.javaOverride ? build.javaPath : undefined,
        javaArgs: build.javaOverride ? build.javaArgs : undefined,
        width,
        height,
        buildName: build.name,
        gameDir: intentPath,
        quickPlayMultiplayer: `${status.ip}:${status.port || 25565}`,
      })
    } finally {
      setConnectingIp(null)
    }
  }

  const renderServer = (server: ServerEntry, index: number) => {
    const { status, loading, error } = server
    const isOnline = status?.online
    const latency = status?.latency_ms ?? 0
    const icon = status?.icon

    const isBuildServer = build.serverOverride === true &&
      !!build.server &&
      server.ip.split(":")[0].toLowerCase() === build.server.split(":")[0].toLowerCase()

    return (
      <div
        key={server.ip}
        className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group"
      >
        <div className="relative flex-shrink-0">
          {icon ? (
            <img
              src={icon}
              alt={server.name}
              className="w-14 h-14 rounded-xl object-cover shadow-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none"
                ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden")
              }}
            />
          ) : null}
          <div
            className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center shadow-lg",
              icon ? "hidden" : "bg-background/80"
            )}
          >
            <img src="./server-icon.png" alt="" className="w-12 h-12" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {server.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleFavorite(server.ip)
              }}
              className="transition-colors"
            >
              <IconStar className={cn("w-4 h-4", server.isFavorite ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30")} />
            </button>
            {isBuildServer && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-primary/20 text-primary">
                {t("servers.buildServer")}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-mono">{server.ip}</p>

          {loading ? (
            <p className="text-xs text-muted-foreground mt-1 animate-pulse">{t("servers.connecting")}</p>
          ) : error ? (
            <p className="text-xs text-red-400 mt-1">{error}</p>
          ) : isOnline ? (
            <>
              <div className="mt-1 leading-tight overflow-hidden">
                {parseMotd(status?.motd_raw ?? "")}
              </div>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs text-muted-foreground">
                  <span className="text-green-400">{formatPlayers(status?.players_online ?? 0)}</span> /{" "}
                  {formatPlayers(status?.players_max ?? 0)} {t("servers.players", { count: status?.players_online ?? 0 })}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {status?.version ?? ""}
                </span>
                <span className="text-xs font-medium text-green-400">
                  {latency} ms
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-red-400 mt-1">{t("servers.offline")}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex flex-col gap-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation()
                moveServer(server.ip, -1)
              }}
              className="p-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("servers.moveUp")}
            >
              <IconChevronUp className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                moveServer(server.ip, 1)
              }}
              className="p-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("servers.moveDown")}
            >
              <IconChevronDown className="w-4 h-4" />
            </button>
          </div>
          {isOnline && (
            <button
              onClick={() => void connectToServer(server)}
              disabled={connectingIp === server.ip}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors disabled:opacity-50"
            >
              <IconPlugConnected className="w-3.5 h-3.5" strokeWidth={1.75} />
              {t("servers.connect")}
            </button>
          )}
          <button
            onClick={() => setServers((prev) => prev.filter((p) => p.ip !== server.ip))}
            className="p-2 rounded-lg bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          >
            <IconTrash className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative overflow-hidden rounded-2xl bg-card border border-border">
        <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

        <div className="relative z-10 p-4 flex flex-col min-h-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t("servers.title")}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {servers.filter((s) => s.status?.online).length} / {servers.length} {t("servers.online")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void fetchAll()}
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
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("servers.search")}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex-1 space-y-4 mt-4">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
                  <IconServer className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">{t("servers.noServers")}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">{t("servers.noServersDesc")}</p>
              </div>
            ) : (
              <>
                {favoriteServers.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-yellow-400 flex items-center gap-2">
                      <IconStar className="w-4 h-4 fill-yellow-400" />
                      {t("servers.favorites")} ({favoriteServers.length})
                    </h3>
                    <div className="space-y-2 mt-2">{favoriteServers.map((server, index) => renderServer(server, index))}</div>
                  </div>
                )}
                {onlineServers.filter((s) => s.loading || s.error || s.status?.online).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-green-400 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      {t("servers.online")} ({onlineServers.length})
                    </h3>
                    <div className="space-y-2 mt-2">{onlineServers.map((server, index) => renderServer(server, index))}</div>
                  </div>
                )}
                {offlineServers.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      {t("servers.offline")} ({offlineServers.length})
                    </h3>
                    <div className="space-y-2 mt-2">{offlineServers.map((server, index) => renderServer(server, index))}</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
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

            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t("servers.name")}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("servers.myServer")}
                  className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t("servers.ipAddress")}</label>
                <input
                  type="text"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
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
                  onClick={() => {
                    setServers((prev) => [
                      ...prev,
                      {
                        name: newName.trim(),
                        ip: newIp.trim(),
                        status: null,
                        loading: true,
                        error: null,
                        isFavorite: false,
                      },
                    ])
                    setNewName("")
                    setNewIp("")
                    setShowAddModal(false)
                  }}
                >
                  <IconPlus className="w-4 h-4" strokeWidth={1.75} />
                  {t("servers.add")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}