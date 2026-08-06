import { memo, useCallback, useEffect, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import type { QuickPlayEntry } from "@xnlc/types"
import type { LauncherWorldInfo } from "@/src/electron.d"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ACCOUNT_TYPE_LABELS, MOD_LOADERS, type LaunchUiState } from "@/lib/home-page-shared"
import { IconBolt, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconFolder, IconLoader2, IconMap, IconPlayerPlay, IconPlayerStop, IconServer, IconWorld, IconX } from "@tabler/icons-react"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
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

function WorldCarousel({ worlds, buildName, onPlay }: { worlds: LauncherWorldInfo[]; buildName?: string; onPlay: (folder: string) => void }) {
  const [index, setIndex] = useState(0)
  const world = worlds[index]

  if (!world) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="group relative overflow-hidden rounded-2xl border border-border bg-card/60 hover:border-emerald-500/50 hover:bg-muted/40 transition-all text-left w-full"
      >
        <div className="relative h-32 w-full overflow-hidden bg-muted/30">
          {world.iconDataUrl ? (
            <img src={world.iconDataUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" style={{ imageRendering: "pixelated" }} />
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
  const [worlds, setWorlds] = useState<LauncherWorldInfo[]>([])
  const [entries, setEntries] = useState<QuickPlayEntry[]>([])
  const [loading, setLoading] = useState(false)

  const buildName = selectedModLoader === "instance" ? selectedVersion : undefined

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
      const mpEntries = list.filter(e => e.type === "multiplayer").slice(0, 3)
      setEntries(mpEntries)
    } catch {
      setWorlds([])
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [buildName])

  useEffect(() => { loadEntries() }, [loadEntries])

  const handleRemove = useCallback(async (entry: QuickPlayEntry) => {
    if (!window.electronAPI) return
    const gameDir = buildName ? await window.electronAPI.getBuildIntentPath(buildName) : await window.electronAPI.getGameDir()
    await window.electronAPI.quickPlayRemove(buildName, gameDir, entry)
    setEntries(prev => prev.filter(e => e.type !== entry.type || e.address !== entry.address))
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
            <span className="text-xs font-medium text-muted-foreground">{t("home.quickPlay")}</span>
          </div>
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <div key={`${entry.type}:${entry.address}`} className="group flex items-center gap-2 px-3 py-2 rounded-xl bg-card/80 border border-border hover:border-primary/40 hover:bg-muted/40 transition-colors">
                <button
                  type="button"
                  onClick={() => onQuickPlayLaunch?.(entry.type, entry.address)}
                  className="flex-1 flex items-center gap-2.5 min-w-0 text-left"
                >
                  {entry.type === "singleplayer"
                    ? <IconWorld className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    : <IconServer className="w-4 h-4 text-blue-400 flex-shrink-0" />}
                  <span className="text-sm text-foreground truncate">{entry.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(entry)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted/60 transition-opacity"
                >
                  <IconX className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
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
    versions, versionsLoaded, selectedVersion, setSelectedVersion,
    selectedModLoader, setSelectedModLoader, loaderVersions, loaderVersionsLoaded, selectedLoaderVersion, setSelectedLoaderVersion,
    activeAvatarUrl, accountAvatarUrls,
    launchUi, launchDetails, isRunning, onPlay, onQuickPlayLaunch,
  } = props
  const showLoaderVersionSelect = selectedModLoader !== "vanilla" && selectedModLoader !== "instance"
  const loaderVersionSelectionPending = showLoaderVersionSelect && (!loaderVersionsLoaded || !selectedLoaderVersion)
  const playDisabled = (launchUi.isLaunching && !isRunning) || loaderVersionSelectionPending

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
                {account ? <img src={activeAvatarUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted flex items-center justify-center"><span className="text-sm font-bold text-muted-foreground">P</span></div>}
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
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"><img src={accountAvatarUrls[acc.id]} alt="" className="w-full h-full object-cover" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">{acc.username}</p>
                        <p className="text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</p>
                      </div>
                      {isActive && <IconCheck className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2} />}
                    </button>
                  )
                })}
                {accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Нет аккаунтов</p>
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
            <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border border-border text-foreground text-sm"><SelectValue placeholder="Minecraft" /></SelectTrigger>
            <SelectContent>
              {!versionsLoaded ? <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                : versions.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">Failed to load versions</div>
                : versions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
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
                  {l.name}
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
