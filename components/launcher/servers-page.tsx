import { memo, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconCircleX,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer,
  IconStar,
  IconX,
} from "@tabler/icons-react"
import { SERVER_LIST, SERVER_STATUS_UPDATE_INTERVAL_MS } from "./servers/constants"
import type { ServerEntry } from "./servers/types"
import { buildServerEntry, createOfflineStatus, normalizeServerStatus } from "./servers/utils"
import { ServerCard } from "./servers/server-card"
import { SearchResultCard } from "./servers/search-result-card"

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

  const deferredQuery = useDeferredValue(searchQuery)
  const filteredServers = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return servers
    }

    return servers.filter((server) =>
      server.name.toLowerCase().includes(normalizedQuery) ||
      server.ip.toLowerCase().includes(normalizedQuery)
    )
  }, [deferredQuery, servers])

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
