import { memo, useCallback } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACCOUNT_TYPE_LABELS, MOD_LOADERS, type LaunchUiState } from "@/lib/home-page-shared"
import { IconCheck, IconChevronDown, IconFolder, IconLoader2, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react"
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
}

export const HomeControls = memo(function HomeControls(props: HomeControlsProps) {
  const { t } = useTranslation()
  const handleOpenLauncherFolder = useCallback(() => { void window.electronAPI?.openLauncherFolder() }, [])
  const {
    accounts, account, accountComboOpen, setAccountComboOpen, setActiveAccount,
    versions, versionsLoaded, selectedVersion, setSelectedVersion,
    selectedModLoader, setSelectedModLoader, loaderVersions, loaderVersionsLoaded, selectedLoaderVersion, setSelectedLoaderVersion,
    activeAvatarUrl, accountAvatarUrls,
    launchUi, launchDetails, isRunning, onPlay,
  } = props
  const showLoaderVersionSelect = selectedModLoader !== "vanilla" && selectedModLoader !== "instance"
  const loaderVersionSelectionPending = showLoaderVersionSelect && (!loaderVersionsLoaded || !selectedLoaderVersion)
  const playDisabled = (launchUi.isLaunching && !isRunning) || loaderVersionSelectionPending

  return (
    <div className="w-72 flex-shrink-0 flex flex-col justify-start gap-4 px-1">
      <div className="relative overflow-hidden rounded-2xl bg-card/80 border border-border transition-colors">
        <div className="relative z-10">
          <button type="button" className="w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors duration-150" onClick={() => setAccountComboOpen(v => !v)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">{t("home.account")}</span>
              <IconChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200", accountComboOpen && "rotate-180")} size={14} strokeWidth={2} />
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

          {accountComboOpen && accounts.length > 0 && (
            <div className="border-t border-border px-2 pb-2 pt-1">
              <div className="flex flex-col gap-0.5 max-h-[150px] overflow-y-auto pr-1 scrollbar-thin">
                {accounts.map(acc => {
                  const isActive = acc.id === account?.id
                  return (
                    <button key={acc.id} type="button" onClick={() => { setActiveAccount(acc.id); setAccountComboOpen(false) }} className={cn("flex items-center gap-3 w-full px-3 py-2 rounded-xl transition-colors duration-150 text-left", isActive ? "bg-primary/15 border border-primary/25" : "hover:bg-muted/60 border border-transparent")}>
                      <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"><img src={accountAvatarUrls[acc.id]} alt="" className="w-full h-full object-cover" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">{acc.username}</p>
                        <p className="text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</p>
                      </div>
                      {isActive && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" strokeWidth={2} />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
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
            <SelectContent>{MOD_LOADERS.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
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

      <button type="button" onClick={handleOpenLauncherFolder} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-card/80 border border-border text-foreground hover:bg-muted/40 hover:border-primary/40 transition-colors">
        <IconFolder className="w-4 h-4" />
        {t("home.openFolder")}
      </button>

      {(launchUi.status || launchUi.progress !== null) && (
        <div className="px-1 flex flex-col gap-2">
          {launchUi.progress !== null && <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full transition-[width] duration-200", isRunning ? "bg-green-500" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(100, isRunning ? 100 : launchUi.progress))}%` }} /></div>}
          {launchUi.status && <p className="text-[11px] text-muted-foreground line-clamp-2">{launchUi.status}</p>}
          {launchDetails && <p className="text-[11px] text-muted-foreground/80 line-clamp-2">{launchDetails}</p>}
        </div>
      )}
    </div>
  )
})
