import { memo, useCallback, useEffect, useState } from "react"
import type { Dispatch, KeyboardEvent, SetStateAction } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import type { QuickPlayEntry } from "@xnlc/types"
import type { WorldInfo } from "@xnlc/types"
import { useLaunchControls } from "@/src/LaunchLogsContext"
import { cn } from "@/lib/utils"
import { parseMotd } from "@/lib/minecraft-motd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ACCOUNT_TYPE_LABELS, MOD_LOADERS, type LaunchUiState } from "@/lib/home-page-shared"
import { IconBolt, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconFolder, IconLoader2, IconMap, IconPlayerPlay, IconPlayerStop, IconRefresh, IconServer, IconUsers } from "@tabler/icons-react"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import { EntityIcon } from "@/components/launcher/instance/entity-icon"
import { isBuiltinLogo } from "@/components/launcher/instance/builtin-logos"
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
  quickPlayAvailable: boolean
}

const QUICK_PLAY_MAX = 10
/** Сколько серверов из истории быстрой игры показываем (и пингуем) в сайдбаре. */
const QUICK_PLAY_SERVERS = 3
/** Записей на странице в быстрой игре: и миров, и серверов. */
const QUICK_PLAY_PER_PAGE = 2

type QuickPlayTab = "servers" | "worlds"

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
  if (ms <= 90) return "text-success"
  if (ms <= 200) return "text-warning"
  return "text-primary"
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
    if (isBuiltinLogo(icon)) {
      return <EntityIcon src={icon} className="h-9 w-9 rounded-lg border border-border/60 p-1 text-primary" />
    }
    return (
      <img data-ui="home-controls-img-1" data-component="server-favicon"
        src={icon}
        alt={label}
        onError={() => setCustomFailed(true)}
        className="h-9 w-9 rounded-lg border border-border/60 object-cover"
      />
    )
  }

  if (!defaultFailed) {
    return (
      <img data-ui="home-controls-img-2" data-component="server-favicon"
        src={DEFAULT_SERVER_ICON}
        alt={label}
        onError={() => setDefaultFailed(true)}
        className="h-9 w-9 rounded-lg border border-border/60 object-cover"
      />
    )
  }

  return (
    <span data-ui="home-controls-span-1" data-component="server-favicon" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
      <IconServer className="h-4 w-4 text-info/70" />
    </span>
  )
}

function QuickPlayServerRow({ entry, ping, onLaunch }: {
  entry: QuickPlayEntry
  ping?: PingState
  onLaunch: () => void
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
    <div data-ui="home-controls-div-1" data-component="quick-play-server-row"
      role="button"
      tabIndex={0}
      onClick={onLaunch}
      onKeyDown={handleKeyDown}
      title={tooltip}
      className="group flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-card/80 p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-primary/60 focus-visible:outline-none"
    >
      <span data-ui="home-controls-span-2" className="relative flex-shrink-0">
        <ServerFavicon icon={status?.icon} label={entry.label} />
        <span data-ui="home-controls-span-3" className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/65 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <IconPlayerPlay className="h-4 w-4 text-primary" strokeWidth={2} fill="currentColor" />
        </span>
      </span>

      <div data-ui="home-controls-div-2" className="flex min-w-0 flex-1 flex-col">
        <div data-ui="home-controls-div-3" className="flex items-center gap-2">
          <span data-ui="home-controls-span-4" className="truncate text-[13px] font-medium text-foreground transition-colors group-hover:text-primary">
            {entry.label}
          </span>
          {online && (
            <span data-ui="home-controls-span-5" className={cn("ml-auto flex-shrink-0 font-mono text-[10px] tabular-nums", latencyTone(latency))}>
              {latency} ms
            </span>
          )}
        </div>

        {ping?.loading ? (
          <span data-ui="home-controls-span-6" className="mt-0.5 animate-pulse text-[11px] text-muted-foreground">
            {t("home.quickPlayPinging")}
          </span>
        ) : online ? (
          <>
            {status?.motd_raw ? (
              <div data-ui="home-controls-div-4" className="mt-1 max-h-[27px] overflow-hidden [&_div]:text-[11px] [&_div]:leading-[13px]">
                {parseMotd(status.motd_raw)}
              </div>
            ) : null}
            <div data-ui="home-controls-div-5" className="mt-1 flex items-center gap-1.5">
              <span data-ui="home-controls-span-7" className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-success">
                <IconUsers className="h-3 w-3" strokeWidth={2} />
                {status?.players_online ?? 0}/{status?.players_max ?? 0}
              </span>
              {status?.version ? (
                <span data-ui="home-controls-span-8"
                  className="max-w-[130px] truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  title={status.version}
                >
                  {status.version}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <span data-ui="home-controls-span-9" className="mt-0.5 text-[11px] text-destructive/80" title={status?.error}>
            {t("servers.offline")}
          </span>
        )}
      </div>
    </div>
  )
}

function QuickPlayWorldRow({ world, onPlay }: {
  world: WorldInfo
  onPlay: () => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onPlay()
  }

  return (
    <div data-ui="home-controls-div-6" data-component="quick-play-world-row"
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={handleKeyDown}
      title={`${world.name} (${world.folder})`}
      className="group flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-card/80 p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-primary/60 focus-visible:outline-none"
    >
      <span data-ui="home-controls-span-10" className="relative flex-shrink-0">
        <span data-ui="home-controls-span-11" className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/40">
          {world.iconDataUrl ? (
            <img data-ui="home-controls-img-3" src={world.iconDataUrl} alt="" className="h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
          ) : (
            <IconMap className="h-4 w-4 text-success/70" />
          )}
        </span>
        <span data-ui="home-controls-span-12" className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/65 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <IconPlayerPlay className="h-4 w-4 text-primary" strokeWidth={2} fill="currentColor" />
        </span>
      </span>

      <div data-ui="home-controls-div-7" className="flex min-w-0 flex-1 flex-col">
        <span data-ui="home-controls-span-13" className="truncate text-[13px] font-medium text-foreground transition-colors group-hover:text-primary">
          {world.name}
        </span>

        <div data-ui="home-controls-div-8" className="mt-1 flex items-center gap-1.5">
          {world.gameMode ? (
            <span data-ui="home-controls-span-14" className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
              {world.gameMode}
            </span>
          ) : null}
          {world.mcVersion ? (
            <span data-ui="home-controls-span-15" className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {world.mcVersion}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function QuickPlaySection({ selectedModLoader, selectedVersion, available, onQuickPlayLaunch }: {
  selectedModLoader: string
  selectedVersion: string
  available: boolean
  onQuickPlayLaunch?: (type: "singleplayer" | "multiplayer", address: string) => void
}) {
  const { t } = useTranslation()
  const [worlds, setWorlds] = useState<WorldInfo[]>([])
  const [entries, setEntries] = useState<QuickPlayEntry[]>([])
  const [pings, setPings] = useState<Record<string, PingState>>({})
  const [pinging, setPinging] = useState(false)
  const [loading, setLoading] = useState(available)
  const [tab, setTab] = useState<QuickPlayTab | null>(null)
  const [page, setPage] = useState(0)

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
    if (!available || !window.electronAPI) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (buildName) {
        const worldsList = await window.electronAPI.listWorlds(buildName)
        const sorted = [...worldsList].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        setWorlds(sorted.slice(0, QUICK_PLAY_MAX))
      } else {
        // У ванильной версии миров сборки нет: без сброса остался бы список
        // от предыдущей выбранной сборки.
        setWorlds([])
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
  }, [available, buildName, pingEntries])

  useEffect(() => { loadEntries() }, [loadEntries])

  const hasWorlds = worlds.length > 0
  const hasEntries = entries.length > 0

  // Явный выбор вкладки; пока пользователь не кликал, показываем серверы,
  // если они есть (иначе — миры).
  const activeTab: QuickPlayTab = tab ?? (hasEntries ? "servers" : "worlds")
  const totalPages = Math.max(
    1,
    Math.ceil((activeTab === "servers" ? entries.length : worlds.length) / QUICK_PLAY_PER_PAGE),
  )
  // Список мог сократиться (удалили сервер, перезагрузили миры) — страницу
  // прижимаем к последней существующей, а не показываем пустоту.
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * QUICK_PLAY_PER_PAGE
  const visibleWorlds = worlds.slice(pageStart, pageStart + QUICK_PLAY_PER_PAGE)
  const visibleServers = entries.slice(pageStart, pageStart + QUICK_PLAY_PER_PAGE)

  return (
    <div data-ui="home-controls-div-9" data-component="quick-play-section" className="flex flex-col gap-3 rounded-xl bg-card p-3 text-card-foreground">
        <div data-ui="home-controls-div-11" className="flex flex-col gap-2">
          {/* Один заголовок на всю быструю игру: и мир, и сервер запускаются
              через --quickPlay*, поэтому подпись не должна висеть только на
              списке серверов. */}
          <div data-ui="home-controls-div-12" className="flex items-center gap-1.5 px-1">
            <IconBolt className="w-3.5 h-3.5 text-primary" />
            <span data-ui="home-controls-span-16" className="flex-1 text-xs font-medium text-foreground">{t("home.quickPlay")}</span>
            {available && activeTab === "servers" && (
              <button data-ui="home-controls-button-1"
                type="button"
                onClick={() => void pingEntries(entries)}
                disabled={pinging}
                title={t("home.quickPlayRefresh")}
                aria-label={t("home.quickPlayRefresh")}
                className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              >
                {pinging ? <IconLoader2 className="w-3.5 h-3.5 text-primary animate-spin" /> : <IconRefresh className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {/* Переключатель групп виден всегда, даже если одна из групп пуста:
              иначе при одном мире и без серверов вкладок не было вообще, а
              вместо них висела одна подпись. */}
          <div data-ui="home-controls-div-13" className="flex items-center gap-1.5 px-1">
            <div data-ui="home-controls-div-14" className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
              <button data-ui="home-controls-button-2"
                type="button"
                aria-pressed={activeTab === "servers"}
                onClick={() => { setTab("servers"); setPage(0) }}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                  activeTab === "servers" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <IconServer className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("servers.title")}
              </button>
              <button data-ui="home-controls-button-3"
                type="button"
                aria-pressed={activeTab === "worlds"}
                onClick={() => { setTab("worlds"); setPage(0) }}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                  activeTab === "worlds" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <IconMap className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("builds.tab.worlds")}
              </button>
            </div>

            {totalPages > 1 && (
              <div data-ui="home-controls-div-15" className="ml-auto flex items-center gap-0.5">
                <button data-ui="home-controls-button-4"
                  type="button"
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                  aria-label={t("home.quickPlayPrev")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <IconChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span data-ui="home-controls-span-17" className="min-w-[26px] text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                  {safePage + 1}/{totalPages}
                </span>
                <button data-ui="home-controls-button-5"
                  type="button"
                  onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                  disabled={safePage >= totalPages - 1}
                  aria-label={t("home.quickPlayNext")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <IconChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {!available && (
            <p className="py-4 text-center text-[11px] text-muted-foreground">{t("home.quickPlayUnsupported")}</p>
          )}

          {available && loading && (
            <div data-ui="home-controls-div-10" className="flex items-center justify-center py-6">
              <IconLoader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {available && !loading && activeTab === "worlds" && (hasWorlds ? (
            <div data-ui="home-controls-div-16" className="flex flex-col gap-1.5">
              {visibleWorlds.map((world) => (
                <QuickPlayWorldRow
                  key={world.folder}
                  world={world}
                  onPlay={() => onQuickPlayLaunch?.("singleplayer", world.folder)}
                />
              ))}
            </div>
          ) : (
            <p data-ui="home-controls-p-1" className="py-4 text-center text-[11px] text-muted-foreground">{t("home.quickPlayNoWorlds")}</p>
          ))}

          {available && !loading && activeTab === "servers" && (hasEntries ? (
            <div data-ui="home-controls-div-17" className="flex flex-col gap-1.5">
              {visibleServers.map((entry) => (
                <QuickPlayServerRow
                  key={entryKey(entry)}
                  entry={entry}
                  ping={pings[entryKey(entry)]}
                  onLaunch={() => onQuickPlayLaunch?.(entry.type, entry.address)}
                />
              ))}
            </div>
          ) : (
            <p data-ui="home-controls-p-2" className="py-4 text-center text-[11px] text-muted-foreground">{t("home.quickPlayNoServers")}</p>
          ))}
        </div>
    </div>
  )
}

export const HomeControls = memo(function HomeControls(props: HomeControlsProps) {
  const { t } = useTranslation()
  const handleOpenLauncherFolder = useCallback(() => { void window.electronAPI?.openLauncherFolder() }, [])
  const { gameReady } = useLaunchControls()
  const {
    accounts, account, accountComboOpen, setAccountComboOpen, setActiveAccount,
    versions, versionsLoaded, selectedVersion, setSelectedVersion, buildIcons,
    selectedModLoader, setSelectedModLoader, loaderVersions, loaderVersionsLoaded, selectedLoaderVersion, setSelectedLoaderVersion,
    activeAvatarUrl, accountAvatarUrls,
    launchUi, launchDetails, isRunning, onPlay, onQuickPlayLaunch, quickPlayAvailable,
  } = props
  const showLoaderVersionSelect = selectedModLoader !== "vanilla" && selectedModLoader !== "instance"
  const loaderVersionSelectionPending = showLoaderVersionSelect && (!loaderVersionsLoaded || !selectedLoaderVersion)
  const noVersionsAvailable = versionsLoaded && versions.length === 0
  // Процесс уже жив, но игра ещё грузится (окно/звук/атласы не поднялись):
  // показываем «Запускается...» и не превращаем кнопку в kill-switch.
  const isBooting = isRunning && !gameReady
  const playDisabled = isBooting || (launchUi.isLaunching && !isRunning) || loaderVersionSelectionPending || noVersionsAvailable

  return (
    <div data-ui="home-controls-div-18" data-component="home-controls" id="home-controls-panel" className="w-72 flex-shrink-0 flex flex-col justify-start gap-4 px-1">
      <div data-ui="home-controls-div-19" id="home-account-card" className="relative overflow-hidden rounded-2xl bg-card/80 border border-border transition-colors">
        <div data-ui="home-controls-div-20" className="relative z-10">
          <button data-ui="home-controls-button-6" type="button" className="w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors duration-150" onClick={() => setAccountComboOpen(true)}>
            <div data-ui="home-controls-div-21" className="flex items-center justify-between mb-2">
              <span data-ui="home-controls-span-18" className="text-xs font-medium text-muted-foreground">{t("home.account")}</span>
              <IconChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" size={14} strokeWidth={2} />
            </div>
            <div data-ui="home-controls-div-22" className="flex items-center gap-3">
              <div data-ui="home-controls-div-23" className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-primary/30">
                {account ? <CachedAvatar src={activeAvatarUrl} alt="" className="w-full h-full object-cover" /> : <div data-ui="home-controls-div-24" className="w-full h-full bg-muted flex items-center justify-center"><span data-ui="home-controls-span-19" className="text-sm font-bold text-muted-foreground">P</span></div>}
              </div>
              <div data-ui="home-controls-div-25" className="flex-1 min-w-0">
                <p data-ui="home-controls-p-3" className="font-semibold text-foreground text-sm truncate">{account?.username ?? "Player"}</p>
                <p data-ui="home-controls-p-4" className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[account?.type ?? "offline"]}</p>
              </div>
            </div>
          </button>

          <Dialog open={accountComboOpen} onOpenChange={setAccountComboOpen}>
            <DialogContent data-window="home-controls-window-1" className="max-w-md p-0 gap-0">
              <DialogHeader className="px-5 pt-5 pb-3">
                <DialogTitle>{t("home.account")}</DialogTitle>
              </DialogHeader>
              <div data-ui="home-controls-div-26" className="flex flex-col gap-1 px-3 pb-3 max-h-[400px] overflow-y-auto">
                {accounts.map(acc => {
                  const isActive = acc.id === account?.id
                  return (
                    <button data-ui="home-controls-button-7" key={acc.id} type="button" onClick={() => { setActiveAccount(acc.id); setAccountComboOpen(false) }} className={cn("flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors duration-150 text-left", isActive ? "bg-primary/15 border border-primary/25" : "hover:bg-muted/60 border border-transparent")}>
                      <div data-ui="home-controls-div-27" className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"><CachedAvatar src={accountAvatarUrls[acc.id]} alt="" className="w-full h-full object-cover" /></div>
                      <div data-ui="home-controls-div-28" className="flex-1 min-w-0">
                        <p data-ui="home-controls-p-5" className="font-medium text-sm text-foreground truncate">{acc.username}</p>
                        <p data-ui="home-controls-p-6" className="text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</p>
                      </div>
                      {isActive && <IconCheck className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2} />}
                    </button>
                  )
                })}
                {accounts.length === 0 && (
                  <p data-ui="home-controls-p-7" className="text-sm text-muted-foreground text-center py-4">{t("home.noAccounts")}</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div data-ui="home-controls-div-29" id="home-version-card" className="relative overflow-hidden rounded-2xl bg-card/80 border border-border p-4 flex flex-col gap-3">
        <div data-ui="home-controls-div-30" id="home-version-select" className="relative z-10">
          <label data-ui="home-controls-label-1" className="block text-xs font-medium text-muted-foreground mb-1.5">{t("home.version")}</label>
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
              {!versionsLoaded ? <div data-ui="home-controls-div-31" className="px-3 py-2 text-sm text-muted-foreground">{t("home.loadingVersions")}</div>
                : versions.length === 0
                  ? <div data-ui="home-controls-div-32" className="px-3 py-2 text-sm text-muted-foreground">
                      {selectedModLoader === "instance" ? t("home.noBuilds") : t("home.failedToLoadVersions")}
                    </div>
                  : versions.map(v => <SelectItem key={v} value={v}>
                    <span data-ui="home-controls-span-20" className="flex items-center gap-2">
                      {buildIcons[v] ? (
                        <EntityIcon src={buildIcons[v]} className="w-4 h-4 rounded-sm text-primary shrink-0" imgClassName="w-4 h-4 rounded-sm object-cover shrink-0" />
                      ) : null}
                      {v}
                    </span>
                  </SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div data-ui="home-controls-div-33" className="relative z-10">
          <label data-ui="home-controls-label-2" className="block text-xs font-medium text-muted-foreground mb-1.5">{t("home.modLoader")}</label>
          <Select value={selectedModLoader} onValueChange={setSelectedModLoader}>
            <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border border-border text-foreground text-sm"><SelectValue placeholder={t("home.modLoader")} /></SelectTrigger>
            <SelectContent>{MOD_LOADERS.map(l => (
              <SelectItem key={l.id} value={l.id}>
                <span data-ui="home-controls-span-21" className="flex items-center gap-2">
                  <LoaderIcon loaderId={l.id} className="w-4 h-4 flex-shrink-0" />
                  {t(`home.modLoader.${l.id}`, l.name)}
                </span>
              </SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
        {showLoaderVersionSelect && (
          <div data-ui="home-controls-div-34" className="relative z-10">
            <label data-ui="home-controls-label-3" className="block text-xs font-medium text-muted-foreground mb-1.5">{t("home.loaderVersion")}</label>
            <Select value={selectedLoaderVersion} onValueChange={setSelectedLoaderVersion} disabled={!loaderVersionsLoaded || loaderVersions.length === 0}>
              <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border border-border text-foreground text-sm"><SelectValue placeholder={loaderVersionsLoaded ? t("home.loaderVersion") : t("home.loadingVersions")} /></SelectTrigger>
              <SelectContent>
                {!loaderVersionsLoaded ? <div data-ui="home-controls-div-35" className="px-3 py-2 text-sm text-muted-foreground">{t("home.loaderVersionLoading")}</div>
                  : loaderVersions.length === 0 ? <div data-ui="home-controls-div-36" className="px-3 py-2 text-sm text-muted-foreground">{t("home.noLoaderVersions")}</div>
                  : loaderVersions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {loaderVersionSelectionPending && (
              <p data-ui="home-controls-p-8" className="mt-1 text-[11px] text-muted-foreground">
                {!loaderVersionsLoaded ? t("home.loaderVersionLoading") : t("home.chooseLoaderVersion")}
              </p>
            )}
          </div>
        )}
      </div>

      <button data-ui="home-controls-button-8" id="home-play-button" type="button" onClick={onPlay} disabled={playDisabled} className={cn("relative w-full py-4 rounded-2xl font-bold text-lg overflow-hidden", !launchUi.isLaunching && isRunning && !isBooting ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90", "transition-colors duration-200 group", "active:scale-[0.98]", "disabled:opacity-70 disabled:cursor-not-allowed")}>
        <span data-ui="home-controls-span-22" className="relative z-10 flex items-center justify-center gap-3">
          {launchUi.isLaunching || isBooting ? <><IconLoader2 className="w-5 h-5 animate-spin" />{launchUi.phase === "installing" && launchUi.progress !== null ? `${t("home.installing")} ${launchUi.progress}%` : t("home.launching")}</>
            : isRunning ? <><IconPlayerStop className="w-5 h-5" strokeWidth={1.75} />{t("home.stop")}</>
            : <><IconPlayerPlay className="w-5 h-5" strokeWidth={1.75} />{t("home.play")}</>}
        </span>
      </button>

      {(launchUi.status || launchUi.progress !== null) && (
        <div data-ui="home-controls-div-37" className="relative z-50 px-1 flex flex-col gap-2">
          {launchUi.progress !== null && (
            <div data-ui="home-controls-div-38" className="h-1.5 rounded-full bg-muted overflow-hidden">
              {gameReady ? (
                // Полностью запущено — зелёная шкала на 100%.
                <div data-ui="home-controls-div-39" className="h-full w-full rounded-full bg-success transition-colors" />
              ) : isBooting ? (
                // Процесс есть, окно ещё грузится: тот же бегущий градиентный
                // сегмент, что на стартовом экране лаунчера, вместо зелёного.
                <div data-ui="home-controls-div-40" className="progress-launch h-full w-full rounded-full" />
              ) : (
                <div data-ui="home-controls-div-41"
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, launchUi.progress))}%` }}
                />
              )}
            </div>
          )}
          {launchUi.status && <p data-ui="home-controls-p-9" className="text-[11px] text-muted-foreground line-clamp-2">{launchUi.status}</p>}
          {launchDetails && <p data-ui="home-controls-p-10" className="text-[11px] text-muted-foreground/80 line-clamp-2">{launchDetails}</p>}
        </div>
      )}

      <button data-ui="home-controls-button-9" type="button" onClick={handleOpenLauncherFolder} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-card/80 border border-border text-foreground hover:bg-muted/40 hover:border-primary/40 transition-colors">
        <IconFolder className="w-4 h-4" />
        {t("home.openFolder")}
      </button>

      <QuickPlaySection
        key={`${selectedModLoader}:${selectedVersion}:${quickPlayAvailable}`}
        selectedModLoader={selectedModLoader}
        selectedVersion={selectedVersion}
        available={quickPlayAvailable}
        onQuickPlayLaunch={onQuickPlayLaunch}
      />
    </div>
  )
})
