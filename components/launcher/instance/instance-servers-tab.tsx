import { useContentEnter } from "../content-motion"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { parseMotd } from "@/lib/minecraft-motd"
import { ModalLayer } from "@/components/ui/modal-layer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IconChevronDown, IconChevronUp, IconCircleX, IconPlugConnected, IconPlus, IconPencil, IconRefresh, IconSearch, IconServer, IconStar, IconTrash, IconX, IconLoader2 } from "@tabler/icons-react"
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
  resourcePack?: "prompt" | "enabled" | "disabled"
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

export function InstanceServersTab({ build, updateBuild }: InstanceServersTabProps) {
  const { t } = useTranslation()
  const { activeAccount } = useAccounts()
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIp, setNewIp] = useState("")
  const [resourcePack, setResourcePack] = useState<"prompt" | "enabled" | "disabled">("prompt")
  const [favorite, setFavorite] = useState(false)
  const [editingIp, setEditingIp] = useState<string | null>(null)
  const openEditor = (server?: ServerEntry) => {
    setEditingIp(server?.ip ?? null)
    setNewName(server?.name ?? "")
    setNewIp(server?.ip ?? "")
    setResourcePack(server?.resourcePack ?? "prompt")
    setFavorite(server?.isFavorite ?? false)
    setShowAddModal(true)
  }
  const [refreshing, setRefreshing] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const contentEnter = useContentEnter(initialized)
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
      let serverList: Array<{ name: string; ip: string; resourcePack?: "prompt" | "enabled" | "disabled" }> = []
      try {
        const datServers = await window.electronAPI?.listServers(build.name)
        if (datServers && datServers.length > 0) {
          serverList = datServers
        }
      } catch {}

      const list = serverList.map((s) => ({
        name: s.name,
        ip: s.ip,
        resourcePack: s.resourcePack,
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
    void window.electronAPI?.writeServersDat(build.name, servers.map((s) => ({ name: s.name, ip: s.ip, resourcePack: s.resourcePack })))
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
    const api = window.electronAPI
    if (!api) return
    setConnectingIp(server.ip)
    try {
      const settings = await loadLaunchSettings()
      const { width, height } = resolveLaunchDimensions(settings)

      const intentPath = build.name ? await api.getBuildIntentPath(build.name) : undefined

      await api.launchMinecraft({
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
        ...(build.preLaunchCommand ? { preLaunchCommand: build.preLaunchCommand } : {}),
        ...(build.postLaunchCommand ? { postLaunchCommand: build.postLaunchCommand } : {}),
        ...(build.wrapperCommand ? { wrapperCommand: build.wrapperCommand } : {}),
        ...(build.customEnv ? {
          customEnv: Object.fromEntries(
            build.customEnv.split(/\r?\n/)
              .map(l => l.trim())
              .filter(l => l && !l.startsWith("#"))
              .map(l => { const eq = l.indexOf("="); return eq > 0 ? [l.slice(0, eq).trim(), l.slice(eq + 1).trim()] : null })
              .filter((p): p is [string, string] => p !== null)
          ),
        } : {}),
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
      <div data-ui="instance-instance-servers-tab-div-1"
        key={server.ip}
        className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group"
      >
        <div data-ui="instance-instance-servers-tab-div-2" className="relative flex-shrink-0">
          {icon ? (
            <img data-ui="instance-instance-servers-tab-img-1"
              src={icon}
              alt={server.name}
              className="w-14 h-14 rounded-xl object-cover shadow-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none"
                ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden")
              }}
            />
          ) : null}
          <div data-ui="instance-instance-servers-tab-div-3"
            className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center shadow-lg",
              icon ? "hidden" : "bg-background/80"
            )}
          >
            <img data-ui="instance-instance-servers-tab-img-2" src="./server-icon.png" alt="" className="w-12 h-12" />
          </div>
        </div>

        <div data-ui="instance-instance-servers-tab-div-4" className="flex-1 min-w-0">
          <div data-ui="instance-instance-servers-tab-div-5" className="flex items-center gap-2">
            <span data-ui="instance-instance-servers-tab-span-1" className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {server.name}
            </span>
            <button data-ui="instance-instance-servers-tab-button-1"
              onClick={(e) => {
                e.stopPropagation()
                toggleFavorite(server.ip)
              }}
              className="transition-colors"
            >
              <IconStar className={cn("w-4 h-4", server.isFavorite ? "text-warning fill-warning" : "text-muted-foreground/30")} />
            </button>
            {isBuildServer && (
              <span data-ui="instance-instance-servers-tab-span-2" className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-primary/20 text-primary">
                {t("servers.buildServer")}
              </span>
            )}
          </div>
          <p data-ui="instance-instance-servers-tab-p-1" className="text-sm text-muted-foreground font-mono">{server.ip}</p>

          {loading ? (
            <p data-ui="instance-instance-servers-tab-p-2" className="text-xs text-muted-foreground mt-1 animate-pulse">{t("servers.connecting")}</p>
          ) : error ? (
            <p data-ui="instance-instance-servers-tab-p-3" className="text-xs text-destructive mt-1">{error}</p>
          ) : isOnline ? (
            <>
              <div data-ui="instance-instance-servers-tab-div-6" className="mt-1 leading-tight overflow-hidden">
                {parseMotd(status?.motd_raw ?? "")}
              </div>
              <div data-ui="instance-instance-servers-tab-div-7" className="flex items-center gap-4 mt-1">
                <span data-ui="instance-instance-servers-tab-span-3" className="text-xs text-muted-foreground">
                  <span data-ui="instance-instance-servers-tab-span-4" className="text-success">{formatPlayers(status?.players_online ?? 0)}</span> /{" "}
                  {formatPlayers(status?.players_max ?? 0)} {t("servers.players", { count: status?.players_online ?? 0 })}
                </span>
                <span data-ui="instance-instance-servers-tab-span-5"
                  className="max-w-[220px] truncate text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                  title={status?.version ?? undefined}
                >
                  {status?.version ?? ""}
                </span>
                <span data-ui="instance-instance-servers-tab-span-6" className="text-xs font-medium text-success">
                  {latency} ms
                </span>
              </div>
            </>
          ) : (
            <p data-ui="instance-instance-servers-tab-p-4" className="text-xs text-destructive mt-1">{t("servers.offline")}</p>
          )}
        </div>

        <div data-ui="instance-instance-servers-tab-div-8" className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={() => openEditor(server)} title={t("servers.edit")} className="rounded-lg bg-muted/50 p-2 text-muted-foreground hover:text-foreground"><IconPencil className="h-4 w-4" /></button>
          <div data-ui="instance-instance-servers-tab-div-9" className="flex flex-col gap-0.5">
            <button data-ui="instance-instance-servers-tab-button-2"
              onClick={(e) => {
                e.stopPropagation()
                moveServer(server.ip, -1)
              }}
              className="p-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("servers.moveUp")}
            >
              <IconChevronUp className="w-4 h-4" />
            </button>
            <button data-ui="instance-instance-servers-tab-button-3"
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
            <button data-ui="instance-instance-servers-tab-button-4"
              onClick={() => void connectToServer(server)}
              disabled={connectingIp === server.ip}
              title={t("servers.connectHint")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors disabled:opacity-50"
            >
              <IconPlugConnected className="w-3.5 h-3.5" strokeWidth={1.75} />
              {t("servers.connect")}
            </button>
          )}
          <button data-ui="instance-instance-servers-tab-button-5"
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
    <div data-ui="instance-instance-servers-tab-div-10" data-component="instance-servers-tab" className={`flex-1 min-h-0 flex flex-col gap-3 overflow-hidden ${contentEnter ?? ""}`}>
      {/* Заголовок вкладки — как в «Мирах» и остальном лаунчере: плоский
          контейнер с линией-разделителем, без отдельной закруглённой карточки
          вокруг всей вкладки и без размытых декоративных пятен. */}
      <div data-ui="instance-instance-servers-tab-div-11" className="flex items-center justify-between border-b border-border pb-2.5 shrink-0 pr-1">
        <div data-ui="instance-instance-servers-tab-div-12">
          <h2 data-ui="instance-instance-servers-tab-h2-1" className="text-xl font-semibold text-foreground">{t("servers.title")}</h2>
          <p data-ui="instance-instance-servers-tab-p-5" className="text-sm text-muted-foreground mt-1">{t("servers.tabSubtitle")}</p>
          <p data-ui="instance-instance-servers-tab-p-6" className="text-xs text-muted-foreground/70 mt-0.5">
            {servers.filter((s) => s.status?.online).length} / {servers.length} {t("servers.online")}
          </p>
        </div>
        <div data-ui="instance-instance-servers-tab-div-13" className="flex items-center gap-1.5">
          <button data-ui="instance-instance-servers-tab-button-6"
            onClick={() => void fetchAll()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? <IconLoader2 className="w-3.5 h-3.5 text-primary animate-spin" /> : <IconRefresh className="w-3.5 h-3.5" />}
            {t("servers.refresh")}
          </button>
          <button data-ui="instance-instance-servers-tab-button-7"
            onClick={() => openEditor()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
            {t("servers.addServer")}
          </button>
        </div>
      </div>

          <div data-ui="instance-instance-servers-tab-div-14" className="flex items-center gap-3">
            <div data-ui="instance-instance-servers-tab-div-15" className="flex-1 relative">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input data-ui="instance-instance-servers-tab-input-1"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("servers.search")}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div data-ui="instance-instance-servers-tab-div-16" className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
            {filtered.length === 0 ? (
              // Пустое состояние в том же оформлении, что и вкладка «Миры»:
              // крупная иконка в цветной плашке, жирный заголовок и действие.
              <div data-ui="instance-instance-servers-tab-div-17" className="flex h-full flex-col items-center justify-center gap-4 text-center max-w-md mx-auto py-12">
                <div data-ui="instance-instance-servers-tab-div-18" className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary border border-primary/20">
                  <IconServer className="h-10 w-10" strokeWidth={1.75} />
                </div>
                <div data-ui="instance-instance-servers-tab-div-19">
                  <div data-ui="instance-instance-servers-tab-div-20" className="text-xl font-bold text-foreground">{t("servers.noServers")}</div>
                  <p data-ui="instance-instance-servers-tab-p-7" className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    {t("servers.noServersDesc")}
                  </p>
                </div>
                <div data-ui="instance-instance-servers-tab-div-21" className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
                  <button data-ui="instance-instance-servers-tab-button-8"
                    type="button"
                    onClick={() => openEditor()}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    <IconPlus className="h-4 w-4" strokeWidth={2} />
                    {t("servers.addServer")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {favoriteServers.length > 0 && (
                  <div data-ui="instance-instance-servers-tab-div-22">
                    <h3 data-ui="instance-instance-servers-tab-h3-1" className="text-sm font-medium text-warning flex items-center gap-2">
                      <IconStar className="w-4 h-4 fill-warning" />
                      {t("servers.favorites")} ({favoriteServers.length})
                    </h3>
                    <div data-ui="instance-instance-servers-tab-div-23" className="space-y-2 mt-2">{favoriteServers.map((server, index) => renderServer(server, index))}</div>
                  </div>
                )}
                {onlineServers.filter((s) => s.loading || s.error || s.status?.online).length > 0 && (
                  <div data-ui="instance-instance-servers-tab-div-24">
                    <h3 data-ui="instance-instance-servers-tab-h3-2" className="text-sm font-medium text-success flex items-center gap-2">
                      <span data-ui="instance-instance-servers-tab-span-7" className="w-2 h-2 rounded-full bg-success" />
                      {t("servers.online")} ({onlineServers.length})
                    </h3>
                    <div data-ui="instance-instance-servers-tab-div-25" className="space-y-2 mt-2">{onlineServers.map((server, index) => renderServer(server, index))}</div>
                  </div>
                )}
                {offlineServers.length > 0 && (
                  <div data-ui="instance-instance-servers-tab-div-26">
                    <h3 data-ui="instance-instance-servers-tab-h3-3" className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <span data-ui="instance-instance-servers-tab-span-8" className="w-2 h-2 rounded-full bg-destructive" />
                      {t("servers.offline")} ({offlineServers.length})
                    </h3>
                    <div data-ui="instance-instance-servers-tab-div-27" className="space-y-2 mt-2">{offlineServers.map((server, index) => renderServer(server, index))}</div>
                  </div>
                )}
              </>
            )}
          </div>

      {showAddModal && (
        <ModalLayer windowId="instance-instance-servers-tab-window-1"
          className=""
          onClose={() => setShowAddModal(false)}
        >
          <div data-ui="instance-instance-servers-tab-div-28"
            className="w-full max-w-md max-h-[85vh] overflow-y-auto mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl"
          >
            <div data-ui="instance-instance-servers-tab-div-29" className="flex items-center justify-between">
              <h3 data-ui="instance-instance-servers-tab-h3-4" className="text-lg font-semibold text-foreground">{t(editingIp ? "servers.edit" : "servers.addServer")}</h3>
              <button data-ui="instance-instance-servers-tab-button-9"
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div data-ui="instance-instance-servers-tab-div-30" className="space-y-4">
              <div data-ui="instance-instance-servers-tab-div-31">
                <label data-ui="instance-instance-servers-tab-label-1" className="text-sm text-muted-foreground mb-1 block">{t("servers.name")}</label>
                <input data-ui="instance-instance-servers-tab-input-2"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("servers.myServer")}
                  className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div data-ui="instance-instance-servers-tab-div-32">
                <label data-ui="instance-instance-servers-tab-label-2" className="text-sm text-muted-foreground mb-1 block">{t("servers.ipAddress")}</label>
                <input data-ui="instance-instance-servers-tab-input-3"
                  type="text"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  placeholder="play.example.com"
                  className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-muted-foreground">{t("servers.resourcePack")}</label>
                <Select value={resourcePack} onValueChange={value => setResourcePack(value as typeof resourcePack)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{(["prompt", "enabled", "disabled"] as const).map(value => <SelectItem key={value} value={value}>{t(`servers.resourcePack.${value}`)}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("servers.resourcePack.hint")}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm text-foreground">
                <input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} className="h-4 w-4 accent-primary" />
                <IconStar className="h-4 w-4 text-primary" />{t("servers.favorite")}
              </label>
              <div data-ui="instance-instance-servers-tab-div-33" className="flex gap-3">
                <button data-ui="instance-instance-servers-tab-button-10"
                  onClick={() => setShowAddModal(false)}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                >
                  <IconCircleX className="w-4 h-4" strokeWidth={1.75} />
                  {t("servers.cancel")}
                </button>
                <button data-ui="instance-instance-servers-tab-button-11"
                  disabled={!newName.trim() || !newIp.trim() || servers.some(server => server.ip.toLowerCase() === newIp.trim().toLowerCase() && server.ip !== editingIp)}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    const entry: ServerEntry = { name: newName.trim(), ip: newIp.trim(), resourcePack, isFavorite: favorite, status: null, loading: false, error: null }
                    setServers(prev => editingIp ? prev.map(server => server.ip === editingIp ? entry : server) : [...prev, entry])
                    void fetchServerStatus(entry.ip).then(status => setServers(prev => prev.map(server => server.ip === entry.ip ? { ...server, status } : server))).catch(error => setServers(prev => prev.map(server => server.ip === entry.ip ? { ...server, error: String(error.message) } : server)))
                    setNewName("")
                    setNewIp("")
                    setShowAddModal(false)
                  }}
                >
                  <IconPlus className="w-4 h-4" strokeWidth={1.75} />
                  {t(editingIp ? "common.save" : "servers.add")}
                </button>
              </div>
            </div>
          </div>
        </ModalLayer>
      )}
    </div>
  )
}
