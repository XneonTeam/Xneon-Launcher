import { memo, useCallback, useEffect, useState } from "react"
import type { Dispatch, KeyboardEvent, SetStateAction } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import type { QuickPlayEntry } from "@xnlc/types"
import type { WorldInfo } from "@xnlc/types"
import { cn } from "@/lib/utils"
import { parseMotd } from "@/lib/minecraft-motd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ACCOUNT_TYPE_LABELS, MOD_LOADERS, type LaunchUiState } from "@/lib/home-page-shared"
import { IconBolt, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconFolder, IconLoader2, IconMap, IconPlayerPlay, IconPlayerStop, IconRefresh, IconServer, IconUsers, IconX } from "@tabler/icons-react"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import type { LoaderVersionOption } from "@/src/hooks/use-loader-version-options"

type HomeControlsProps = {
  accounts: Account[]
  account?: Account
  accountComboOpen: boolean
  setAccountComboOpen: Dispatch<SetStateAction<boolean>>
  setActiveAccount: (id: string) => void
  versions: string[]
  versionsLoaded: boolean
  selectedVersion: string
  setSelectedVersion: (value: string) => void
  buildIcons: Record<string, string>
  selectedModLoader: string
  setSelectedModLoader: (value: string) => void
  loaderVersions: LoaderVersionOption[]
  loaderVersionsLoaded: boolean
  selectedLoaderVersion: string
  setSelectedLoaderVersion: (value: string) => void
  activeAvatarUrl: string
  accountAvatarUrls: Record<string, string>
  launchUi: LaunchUiState
  launchDetails: string
  isRunning: boolean
  onPlay: () => void
  onQuickPlayLaunch?: (type: "singleplayer" | "multiplayer", address: string) => void
}

const QUICK_PLAY_MAX = 10

/** Сколько серверов из истории быстрой игры показываем (и пингуем) в сайдбаре. */
const QUICK_PLAY_SERVERS = 3

/** Структурно совпадает с `ServerStatusResult` из `@xnlc/servers` (тянуть его в рендерер нельзя). */
type QuickPlayServerStatus = {
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

type PingState = { loading: boolean; result?: QuickPlayServerStatus }

const entryKey = (entry: QuickPlayEntry) => `${entry.type}:${entry.address}`

function latencyTone(ms: number) {
  if (ms <= 90) return "text-emerald-400"
  if (ms <= 200) return "text-yellow-400"
  return "text-orange-400"
}

/** Стандартная иконка сервера — тот же ассет, что и во вкладке «Серверы». */
const DEFAULT_SERVER_ICON = "./server-icon.png"

function ServerFavicon({ icon, label }: { icon?: string; label: string }) {
  const [customFailed, setCustomFailed] = useState(false)
  const [defaultFailed, setDefaultFailed] = useState(false)

  // Своя иконка есть не у всех серверов: ванильный сервер отдаёт favicon
  // только если рядом с ним лежит server-icon.png. Тогда показываем
  // стандартную иконку сервера, а не заглушку.
  if (icon && !customFailed) {
    return (
      <img
        src={icon}
        alt={label}
        onError={() => setCustomFailed(true)}
        className="h-9 w-9 rounded-lg border border-border/60 object-cover"
      />
    )
  }

  if (!defaultFailed) {
    return (
      <img
        src={DEFAULT_SERVER_ICON}
        alt={label}
        onError={() => setDefaultFailed(true)}
        className="h-9 w-9 rounded-lg border border-border/60 object-cover"
      />
    )
  }

  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
      <IconServer className="h-4 w-4 text-blue-400/70" />
    </span>
  )
}

function QuickPlayServerRow({ entry, ping, onLaunch, onRemove }: {
  entry: QuickPlayEntry
  ping?: PingState
  onLaunch: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const status = ping?.result
  const online = status?.online === true
  const latency = status?.latency_ms ?? 0
  const tooltip = status?.motd_clean ? `${entry.address}\n${status.motd_clean}` : entry.address

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onLaunch()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onLaunch}
      onKeyDown={handleKeyDown}
      title={tooltip}
      className="group flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-card/80 p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-primary/60 focus-visible:outline-none"
    >
      <span className="relative flex-shrink-0">
        <ServerFavicon icon={status?.icon} label={entry.label} />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/65 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <IconPlayerPlay className="h-4 w-4 text-primary" strokeWidth={2} fill="currentColor" />
        </span>
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground transition-colors group-hover:text-primary">
            {entry.label}
          </span>
          {online && (
            <span className={cn("ml-auto flex-shrink-0 font-mono text-[10px] tabular-nums", latencyTone(latency))}>
              {latency} ms
            </span>
          )}
        </div>

        {ping?.loading ? (
          <span className="mt-0.5 animate-pulse text-[11px] text-muted-foreground">
            {t("home.quickPlayPinging")}
          </span>
        ) : online ? (
          <>
            {status?.motd_raw ? (
              <div className="mt-1 max-h-[27px] overflow-hidden [&_div]:text-[11px] [&_div]:leading-[13px]">
                {parseMotd(status.motd_raw)}
              </div>
            ) : null}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-400">
                <IconUsers className="h-3 w-3" strokeWidth={2} />
                {status?.players_online ?? 0}/{status?.players_max ?? 0}
              </span>
              {status?.version ? (
                <span
                  className="max-w-[130px] truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  title={status.version}
                >
                  {status.version}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <span className="mt-0.5 text-[11px] text-red-400/80" title={status?.error}>
            {t("servers.offline")}
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label={t("servers.delete")}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        className="p-0.5 rounded opacity-0 transition-opacity hover:bg-muted/60 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <IconX className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}

function WorldCarousel({ worlds, buildName, onPlay }: { worlds: WorldInfo[]; buildName?: string; onPlay: (folder: string) => void }) {
  const [index, setIndex] = useState(0)
  const world = worlds[index]

  if (!world) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="group relative overflow-hidden rounded-2xl border border-border bg-card/60 hover:border-primary/50 hover:bg-muted/40 transition-all text-left w-full"
      >
        <div className="relative h-32 w-full overflow-hidden bg-muted/30">
          {world.iconDataUrl ? (
            <img src={world.iconDataUrl} alt="" className="h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-500/10 to-muted/30">
              <IconMap className="h-10 w-10 text-emerald-400/30" strokeWidth={1.5} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
          {buildName && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-background/70 backdrop-blur-sm border border-border/50">
              <IconFolder className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[140px]">{buildName}</span>
            </div>
          )}
          {worlds.length > 1 && (
            <div className="absolute top-2 right-2 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-background/70 backdrop-blur-sm border border-border/50">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setIndex(i => (i - 1 + worlds.length) % worlds.length) }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground font-mono min-w-[20px] text-center">
                {index + 1}/{worlds.length}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setIndex(i => (i + 1) % worlds.length) }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => onPlay(world.folder)}
              className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg shadow-primary/30 group-hover:scale-110 hover:bg-primary/90"
            >
              <IconPlayerPlay className="h-6 w-6 ml-0.5" strokeWidth={2} fill="currentColor" />
            </button>
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-sm font-semibold text-foreground truncate">{world.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="capitalize">{world.gameMode}</span>
            {world.mcVersion && <><span>·</span><span>{world.mcVersion}</span></>}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickPlaySection({ selectedModLoader, selectedVersion, onQuickPlayLaunch }: {
  selectedModLoader: string
  selectedVersion: string
  onQuickPlayLaunch?: (type: "singleplayer" | "multiplayer", address: string) => void
}) {
  const { t } = useTranslation()
  const [worlds, setWorlds] = useState<WorldInfo[]>([])
  const [entries, setEntries] = useState<QuickPlayEntry[]>([])
  const [pings, setPings] = useState<Record<string, PingState>>({})
  const [pinging, setPinging] = useState(false)
  const [loading, setLoading] = useState(false)

  const buildName = selectedModLoader === "instance" ? selectedVersion : undefined

  const pingEntries = useCallback(async (list: QuickPlayEntry[]) => {
    const ping = window.electronAPI?.pingServer
    const multiplayer = list.filter(entry => entry.type === "multiplayer")
    if (!ping || multiplayer.length === 0) return

    setPinging(true)
    setPings(prev => {
      const next = { ...prev }
      for (const entry of multiplayer) next[entryKey(entry)] = { loading: true }
      return next
    })

    await Promise.allSettled(multiplayer.map(async (entry) => {
      const key = entryKey(entry)
      let state: PingState
      try {
        state = { loading: false, result: await ping(entry.address) }
      } catch (error) {
        state = {
          loading: false,
          result: {
            online: false,
            ip: entry.address,
            port: 0,
            players_online: 0,
            players_max: 0,
            version: "",
            latency_ms: 0,
            error: error instanceof Error ? error.message : String(error),
          },
        }
      }
      setPings(prev => ({ ...prev, [key]: state }))
    }))

    setPinging(false)
  }, [])

  const loadEntries = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      if (buildName) {
        const worldsList = await window.electronAPI.listWorlds(buildName)
        const sorted = [...worldsList].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        setWorlds(sorted.slice(0, QUICK_PLAY_MAX))
      }
      const gameDir = buildName ? await window.electronAPI.getBuildIntentPath(buildName) : await window.electronAPI.getGameDir()
      const list = await window.electronAPI.quickPlayList(buildName, gameDir)
      const mpEntries = list.filter(e => e.type === "multiplayer").slice(0, QUICK_PLAY_SERVERS)
      setEntries(mpEntries)
      void pingEntries(mpEntries)
    } catch {
      setWorlds([])
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [buildName, pingEntries])

  useEffect(() => { loadEntries() }, [loadEntries])

  const handleRemove = useCallback(async (entry: QuickPlayEntry) => {
    if (!window.electronAPI) return
    const gameDir = buildName ? await window.electronAPI.getBuildIntentPath(buildName) : await window.electronAPI.getGameDir()
    await window.electronAPI.quickPlayRemove(buildName, gameDir, entry)
    setEntries(prev => prev.filter(e => e.type !== entry.type || e.address !== entry.address))
    setPings(prev => {
      const next = { ...prev }
      delete next[entryKey(entry)]
      return next
    })
  }, [buildName])

  const hasWorlds = worlds.length > 0
  const hasEntries = entries.length > 0

  if (!hasWorlds && !hasEntries && !loading) return null

  return (
    <div className="flex flex-col gap-3">
      {loading && (
        <div className="flex items-center justify-center py-6">
          <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {hasWorlds && (
        <WorldCarousel
          worlds={worlds}
          buildName={buildName}
          onPlay={(folder) => onQuickPlayLaunch?.("singleplayer", folder)}
        />
      )}

      {hasEntries && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <IconBolt className="w-3.5 h-3.5 text-primary" />
            <span className="flex-1 text-xs font-medium text-muted-foreground">{t("home.quickPlay")}</span>
            <button
              type="button"
              onClick={() => void pingEntries(entries)}
              disabled={pinging}
              title={t("home.quickPlayRefresh")}
              aria-label={t("home.quickPlayRefresh")}
              className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            >
              <IconRefresh className={cn("w-3.5 h-3.5", pinging && "animate-spin")} />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {entries.map((entry) => (
              <QuickPlayServerRow
                key={entryKey(entry)}
                entry={entry}
                ping={pings[entryKey(entry)]}
                onLaunch={() => onQuickPlayLaunch?.(entry.type, entry.address)}
                onRemove={() => void handleRemove(entry)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const HomeControls = memo(function HomeControls(props: HomeControlsProps) {
  const { t } = useTranslation()
  const handleOpenLauncherFolder = useCallback(() => { void window.electronAPI?.openLauncherFolder() }, [])
  const {
    accounts, account, accountComboOpen, setAccountComboOpen, setActiveAccount,
    versions, versionsLoaded, selectedVersion, setSelectedVersion, buildIcons,
    selectedModLoader, setSelectedModLoader, loaderVersions, loaderVersionsLoaded, selectedLoaderVersion, setSelectedLoaderVersion,
    activeAvatarUrl, accountAvatarUrls,
    launchUi, launchDetails, isRunning, onPlay, onQuickPlayLaunch,
  } = props
  const showLoaderVersionSelect = selectedModLoader !== "vanilla" && selectedModLoader !== "instance"
  const loaderVersionSelectionPending = showLoaderVersionSelect && (!loaderVersionsLoaded || !selectedLoaderVersion)
  const noVersionsAvailable = versionsLoaded && versions.length === 0
  const playDisabled = (launchUi.isLaunching && !isRunning) || loaderVersionSelectionPending || noVersionsAvailable

  return (
    <div className="w-72 flex-shrink-0 flex flex-col justify-start gap-4 px-1">
      <div className="relative overflow-hidden rounded-2xl bg-card/80 border border-border transition-colors">
        <div className="relative z-10">
          <button type="button" className="w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors duration-150" onClick={() => setAccountComboOpen(true)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">{t("home.account")}</span>
              <IconChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" size={14} strokeWidth={2} />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-primary/30">
                {account ? <CachedAvatar src={activeAvatarUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted flex items-center justify-center"><span className="text-sm font-bold text-muted-foreground">P</span></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm truncate">{account?.username ?? "Player"}</p>
                <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[account?.type ?? "offline"]}</p>
              </div>
            </div>
          </button>

          <Dialog open={accountComboOpen} onOpenChange={setAccountComboOpen}>
            <DialogContent className="max-w-md p-0 gap-0">
              <DialogHeader className="px-5 pt-5 pb-3">
                <DialogTitle>{t("home.account")}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1 px-3 pb-3 max-h-[400px] overflow-y-auto scrollbar-thin">
                {accounts.map(acc => {
                  const isActive = acc.id === account?.id
                  return (
                    <button key={acc.id} type="button" onClick={() => { setActiveAccount(acc.id); setAccountComboOpen(false) }} className={cn("flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors duration-150 text-left", isActive ? "bg-primary/15 border border-primary/25" : "hover:bg-muted/60 border border-transparent")}>
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"><CachedAvatar src={accountAvatarUrls[acc.id]} alt="" className="w-full h-full object-cover" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">{acc.username}</p>
                        <p className="text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</p>
                      </div>
                      {isActive && <IconCheck className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2} />}
                    </button>
                  )
                })}
                {accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("home.noAccounts")}</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-card/80 border border-border p-4 flex flex-col gap-3">
        <div className="relative z-10">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t("home.version")}</label>
          <Select value={selectedVersion} onValueChange={setSelectedVersion}>
            <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border border-border text-foreground text-sm">
              <SelectValue
                placeholder={
                  selectedModLoader === "instance" && versionsLoaded && versions.length === 0
                    ? t("home.noBuilds")
                    : !versionsLoaded
                      ? t("home.loadingVersions")
                      : "Minecraft"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {!versionsLoaded ? <div className="px-3 py-2 text-sm text-muted-foreground">{t("home.loadingVersions")}</div>
                : versions.length === 0
                  ? <div className="px-3 py-2 text-sm text-muted-foreground">
                      {selectedModLoader === "instance" ? t("home.noBuilds") : t("home.failedToLoadVersions")}
                    </div>
                  : versions.map(v => <SelectItem key={v} value={v}>
                    <span className="flex items-center gap-2">
                      {buildIcons[v] ? (
                        <img src={buildIcons[v]} alt="" className="w-4 h-4 rounded-sm object-cover shrink-0" />
                      ) : null}
                      {v}
                    </span>
                  </SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="relative z-10">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t("home.modLoader")}</label>
          <Select value={selectedModLoader} onValueChange={setSelectedModLoader}>
            <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border border-border text-foreground text-sm"><SelectValue placeholder="Mod Loader" /></SelectTrigger>
            <SelectContent>{MOD_LOADERS.map(l => (
              <SelectItem key={l.id} value={l.id}>
                <span className="flex items-center gap-2">
                  <LoaderIcon loaderId={l.id} className="w-4 h-4 flex-shrink-0" />
                  {t(`home.modLoader.${l.id}`, l.name)}
                </span>
              </SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
        {showLoaderVersionSelect && (
          <div className="relative z-10">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Loader Version</label>
            <Select value={selectedLoaderVersion} onValueChange={setSelectedLoaderVersion} disabled={!loaderVersionsLoaded || loaderVersions.length === 0}>
              <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border border-border text-foreground text-sm"><SelectValue placeholder={loaderVersionsLoaded ? "Loader Version" : "Loading..."} /></SelectTrigger>
              <SelectContent>
                {!loaderVersionsLoaded ? <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                  : loaderVersions.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">No versions available</div>
                  : loaderVersions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {loaderVersionSelectionPending && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {!loaderVersionsLoaded ? "Loading available loader versions..." : "Choose a loader version before launch"}
              </p>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={onPlay} disabled={playDisabled} className={cn("relative w-full py-4 rounded-2xl font-bold text-lg text-primary-foreground overflow-hidden", !launchUi.isLaunching && isRunning ? "bg-red-600 hover:bg-red-500" : "bg-primary hover:bg-primary/90", "transition-colors duration-200 group", "active:scale-[0.98]", "disabled:opacity-70 disabled:cursor-not-allowed")}>
        <span className="relative z-10 flex items-center justify-center gap-3">
          {launchUi.isLaunching ? <><IconLoader2 className="w-5 h-5 animate-spin" />{launchUi.phase === "installing" && launchUi.progress !== null ? `${t("home.installing")} ${launchUi.progress}%` : t("home.launching")}</>
            : !launchUi.isLaunching && isRunning ? <><IconPlayerStop className="w-5 h-5" strokeWidth={1.75} />{t("home.stop")}</>
            : <><IconPlayerPlay className="w-5 h-5" strokeWidth={1.75} />{t("home.play")}</>}
        </span>
      </button>

      {(launchUi.status || launchUi.progress !== null) && (
        <div className="relative z-50 px-1 flex flex-col gap-2">
          {launchUi.progress !== null && <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full transition-[width] duration-200", isRunning ? "bg-green-500" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(100, isRunning ? 100 : launchUi.progress))}%` }} /></div>}
          {launchUi.status && <p className="text-[11px] text-muted-foreground line-clamp-2">{launchUi.status}</p>}
          {launchDetails && <p className="text-[11px] text-muted-foreground/80 line-clamp-2">{launchDetails}</p>}
        </div>
      )}

      <button type="button" onClick={handleOpenLauncherFolder} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-card/80 border border-border text-foreground hover:bg-muted/40 hover:border-primary/40 transition-colors">
        <IconFolder className="w-4 h-4" />
        {t("home.openFolder")}
      </button>

      <QuickPlaySection
        selectedModLoader={selectedModLoader}
        selectedVersion={selectedVersion}
        onQuickPlayLaunch={onQuickPlayLaunch}
      />
    </div>
  )
})
