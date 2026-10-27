import { CONTENT_ENTER_DELAYED } from "./content-motion"
import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconTerminal, IconSettings, IconPlayerPlay, IconPlayerStop, IconFolder, IconPuzzle, IconAdjustments, IconUsers, IconRefresh, IconDownload, IconCpu, IconDatabase, IconClock, IconNetwork, IconWorld, IconLink, IconCheck, IconCamera, IconTrash, IconLoader2 } from "@tabler/icons-react"
import { useMcServerState, useMcServerLogs, useMcServerMetrics, useMcServerDownloadProgress } from "@/src/hooks/use-mc-servers"
import { cn } from "@/lib/utils"
import { IconPickerModal } from "@/components/launcher/instance/icon-picker-modal"
import { EntityIcon } from "@/components/launcher/instance/entity-icon"
import { LoaderIcon, loaderLabel } from "./instance/loader-icon"
import type { McServerInfo } from "@xnlc/types"
import { ConsoleTab } from "./server/console-tab"
import { SettingsTab } from "./server/settings-tab"
import { PlayersTab } from "./server/players-tab"
import { PropertiesTab } from "./server/properties-tab"
import { FilesTab } from "./server/files-tab"
import { AddonsTab } from "./server/addons-tab"
import { ServerEulaModal } from "./server-eula-modal"

type ServerTab = "console" | "addons" | "properties" | "players" | "settings" | "files"

const ALL_TABS: Array<{ id: ServerTab; labelKey: string; icon: React.ElementType; label?: string }> = [
  { id: "console", labelKey: "servers.tabConsole", icon: IconTerminal },
  { id: "files", labelKey: "servers.tabFiles", icon: IconFolder },
  { id: "addons", labelKey: "servers.tabAddons", icon: IconPuzzle },
  { id: "properties", labelKey: "servers.tabProperties", icon: IconAdjustments },
  { id: "players", labelKey: "servers.tabPlayers", icon: IconUsers },
  { id: "settings", labelKey: "servers.tabSettings", icon: IconSettings },
]

const MODLOADER_MODS = ["forge", "fabric", "quilt", "neoforge"]
const MODLOADER_PLUGINS = ["paper", "spigot", "bukkit", "purpur", "folia", "sponge", "bungeecord", "velocity", "waterfall"]

function getAddonsLabelKey(modloader: string): string {
  if (MODLOADER_PLUGINS.includes(modloader)) return "servers.addons.plugins"
  if (MODLOADER_MODS.includes(modloader)) return "servers.addons.mods"
  return "servers.tabAddons"
}

function hasAddons(modloader: string): boolean {
  return MODLOADER_MODS.includes(modloader) || MODLOADER_PLUGINS.includes(modloader)
}

interface ServerDetailPageProps {
  server: McServerInfo
  onBack: () => void
  /** Обновлённые данные сервера (порт/online-mode/слоты) после записи server.properties. */
  onServerUpdated?: (server: McServerInfo) => void
}

export function ServerDetailPage({ server, onBack, onServerUpdated }: ServerDetailPageProps) {
  const { t } = useTranslation()
  const { state, start, stop } = useMcServerState(server.id)
  const { logs, clearLogs, resetForRestart } = useMcServerLogs(server.id)
  const metrics = useMcServerMetrics(server.id, state.status === "running")
  const downloadProgress = useMcServerDownloadProgress(server.id)
  const [activeTab, setActiveTab] = useState<ServerTab>("console")
  const [command, setCommand] = useState("")
  const [addresses, setAddresses] = useState<{ local: string; public: string | null; custom: string | null } | null>(null)
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)
  const [eulaAccepted, setEulaAccepted] = useState(true)
  const [showEula, setShowEula] = useState(false)
  const [icon, setIcon] = useState(server.icon ?? "")
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [limitState, setLimitState] = useState<{ used: number; max: number } | null>(null)
  // Несохранённые правки server.properties дописываются на диск перед стартом:
  // иначе сервер поднимается со старыми значениями из файла.
  const propertiesFlushRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    window.electronAPI?.mcServerGetAddresses(server.id).then(addrs => {
      if (addrs) setAddresses(addrs)
    })
    window.electronAPI?.mcServerCheckEula(server.id).then(accepted => {
      setEulaAccepted(accepted)
    })

    // XN Connect не запускается отсюда: туннель поднимается вместе с самим
    // сервером (mc-server:start) и гасится вместе с ним (mc-server:stop/kill).
    // Раньше туннель включался уже при открытии страницы, даже если сервер
    // остановлен, — relay стучался в закрытый порт и мигал реконнектами.

    // Re-fetch addresses when relay state changes
    const unsubXn = window.electronAPI?.onXnConnectState((data) => {
      if (data.serverId === server.id) {
        window.electronAPI?.mcServerGetAddresses(server.id).then(addrs => {
          if (addrs) setAddresses(addrs)
        })
        if (data.state.status === "limit_reached") {
          setLimitState({ used: data.state.used, max: data.state.max })
        } else if (data.state.status === "running" || data.state.status === "stopped") {
          setLimitState(null)
        }
      }
    })
    return () => unsubXn?.()
  }, [server.id, server.relayEnabled])

  const handleCopyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr)
    setCopiedAddr(addr)
    setTimeout(() => setCopiedAddr(null), 1500)
  }

  const handleEulaAccept = async () => {
    await window.electronAPI?.mcServerAcceptEula(server.id)
    setEulaAccepted(true)
    setShowEula(false)
    if (!isBusy) {
      await propertiesFlushRef.current?.().catch(() => {})
      start()
    }
  }

  const handleEulaDecline = () => {
    setShowEula(false)
  }

  const handleIconChange = async (newIcon: string) => {
    setIcon(newIcon)
    await window.electronAPI?.mcServerUpdate(server.id, { icon: newIcon || null })
  }

  const isRunning = state.status === "running"
  const isStarting = state.status === "starting"
  const isStopping = state.status === "stopping"
  const isDownloading = downloadProgress !== null && downloadProgress.phase !== "done" && downloadProgress.phase !== "error"
  // Локальная «занятость»: состояние из main приходит с задержкой.
  const [pending, setPending] = useState<null | "start" | "stop">(null)
  const pendingRef = useRef<null | "start" | "stop">(null)
  const isStartingLike = isStarting || pending === "start"
  const isStoppingLike = isStopping || pending === "stop"
  /**
   * Идёт подготовка к запуску (Java, скачивание/сборка ядра), но процесс ещё не
   * поднят. Состояние из main в это время `stopped`, а `pending` после возврата на
   * страницу пуст — без этой ветки интерфейс выглядел простаивающим, хотя установка
   * шла: ни прогресса, ни возможности её отменить.
   */
  const isInstallLike = isDownloading && !isRunning && !isStartingLike
  const isBusy = isStartingLike || isStoppingLike || isDownloading

  /** Пока действие не завершилось, второе такое же не уходит. */
  const runAction = async (kind: "start" | "stop", fn: () => unknown) => {
    if (pendingRef.current === kind) return
    pendingRef.current = kind
    setPending(kind)
    try {
      await fn()
    } finally {
      // Если запросили противоположное действие, маркер уже перезаписан.
      if (pendingRef.current === kind) {
        pendingRef.current = null
        setPending(null)
      }
    }
  }

  const handleSendCommand = async () => {
    if (!command.trim()) return
    try {
      await window.electronAPI?.mcServerSendCommand(server.id, command.trim())
      setCommand("")
    } catch {
      // Причина отказа уже выведена в консоль сервера.
    }
  }

  const handleStartStop = async () => {
    // Гасим и запущенный, и ещё стартующий сервер, и идущую установку ядра:
    // в последнем случае main отменяет подготовку и процесс не поднимает.
    if (isRunning || isStartingLike || isInstallLike) {
      await runAction("stop", () => stop())
      return
    }
    if (isStoppingLike) return
    if (!eulaAccepted) {
      setShowEula(true)
      return
    }
    await propertiesFlushRef.current?.().catch(() => {})
    await runAction("start", () => start())
  }

  const handleRestart = async () => {
    if (!isRunning || isBusy) return
    // Консоль чистится сразу, иначе в ней останется лог прошлой сессии.
    resetForRestart()
    await propertiesFlushRef.current?.().catch(() => {})
    await runAction("stop", () => stop())
    await runAction("start", () => start())
  }

  const loaderName = loaderLabel(server.modloader)

  const tabs = ALL_TABS
    .filter(tab => tab.id !== "addons" || hasAddons(server.modloader))
    .map(tab =>
      tab.id === "addons"
        ? { ...tab, labelKey: getAddonsLabelKey(server.modloader) }
        : tab
    )

  return (
    <div data-ui="server-detail-page-div-1" data-component="server-detail-page" id="server-detail-page" data-tab={activeTab} data-status={state.status} className="flex flex-col h-full">
      <ServerEulaModal
        open={showEula}
        onAccept={handleEulaAccept}
        onDecline={handleEulaDecline}
      />
      {/* Header */}
      <div data-ui="server-detail-page-div-2" className={`launcher-page-header mb-5 flex flex-wrap items-start gap-4 ${CONTENT_ENTER_DELAYED}`}>
        {/* Back button */}
        <button data-ui="server-detail-page-button-1"
          onClick={onBack}
          className="mt-1 p-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <IconArrowLeft className="w-5 h-5" />
        </button>

        {/* Server icon */}
        <button data-ui="server-detail-page-button-2"
          onClick={() => setShowIconPicker(true)}
          className="relative w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 border border-border bg-muted/70 hover:border-primary/50 transition-colors cursor-pointer group"
        >
          {icon ? (
            <EntityIcon src={icon} className="w-full h-full p-2 text-primary" imgClassName="w-full h-full object-cover" />
          ) : (
            <>
              <LoaderIcon loaderId={server.modloader} className="w-10 h-10 text-primary/60" />
              <div data-ui="server-detail-page-div-3" className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <IconCamera className="w-5 h-5 text-white" />
              </div>
            </>
          )}
        </button>
        <IconPickerModal open={showIconPicker} onOpenChange={setShowIconPicker} value={icon} onChange={handleIconChange} />

        {/* Info */}
        <div data-ui="server-detail-page-div-4" className="min-w-0 flex-1 basis-40">
          <h1 data-ui="server-detail-page-h1-1" className="m-0 text-lg font-bold text-foreground truncate">{server.name}</h1>
          <div data-ui="server-detail-page-div-5" className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span data-ui="server-detail-page-span-1" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-muted/60 text-xs text-muted-foreground">
              <LoaderIcon loaderId={server.modloader} className="w-3 h-3 flex-shrink-0" />
              {loaderName} {server.gameVersion}
            </span>
            {/* Status badge */}
            <div data-ui="server-detail-page-div-6" className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium",
              isRunning && "bg-success/15 text-success border border-success/20",
              isStartingLike && "bg-warning/15 text-warning border border-warning/20",
              isInstallLike && "bg-primary/15 text-primary border border-primary/25",
              isStoppingLike && "bg-primary/15 text-primary border border-primary/20",
              !isRunning && !isBusy && "bg-muted/60 text-muted-foreground border border-border",
            )}>
              <div data-ui="server-detail-page-div-7" className={cn(
                "h-2 w-2 rounded-full",
                isRunning && "bg-success",
                isStartingLike && "bg-warning animate-pulse",
                isInstallLike && "bg-primary animate-pulse",
                isStoppingLike && "bg-primary",
                !isRunning && !isBusy && "bg-muted-foreground/50",
              )} />
              {isRunning && t("servers.statusRunning")}
              {isStartingLike && t("servers.statusStarting")}
              {isInstallLike && t("servers.statusInstalling")}
              {isStoppingLike && t("servers.statusStopping")}
              {!isRunning && !isBusy && t("servers.statusStopped")}
            </div>
            {isRunning && (
              <>
                <span data-ui="server-detail-page-span-2" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconCpu className="w-3 h-3 text-success" />
                  <span data-ui="server-detail-page-span-3" className="font-mono font-bold text-foreground">{metrics.cpuPercent}%</span>
                </span>
                <span data-ui="server-detail-page-span-4" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconDatabase className="w-3 h-3 text-primary" />
                  <span data-ui="server-detail-page-span-5" className="font-mono font-bold text-foreground">{metrics.memoryMb} <span data-ui="server-detail-page-span-6" className="text-foreground">MB</span></span>
                </span>
                <span data-ui="server-detail-page-span-7" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconClock className="w-3 h-3 text-accent" />
                  <span data-ui="server-detail-page-span-8" className="font-mono font-bold text-foreground">{formatUptime(metrics.uptimeSeconds)}</span>
                </span>
              </>
            )}
          </div>
      {/* Адреса подключения внутри шапки сервера. */}
      {addresses && (
        <div data-ui="server-detail-page-div-11" className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <AddressChip icon={IconNetwork} label={t("servers.address.local")} value={addresses.local} copied={copiedAddr === addresses.local} onCopy={handleCopyAddr} />
          {addresses.public && (
            <AddressChip icon={IconWorld} label={t("servers.address.public")} value={addresses.public} copied={copiedAddr === addresses.public} onCopy={handleCopyAddr} />
          )}
          {addresses.custom ? (
            // Чип показываем только когда адрес XN Connect реально есть: если
            // функция выключена у сервера, никакого «XNEON» в шапке быть не должно.
            <AddressChip icon={IconLink} label="XN Connect" value={addresses.custom} copied={copiedAddr === addresses.custom} onCopy={handleCopyAddr} />
          ) : null}
        </div>
      )}

        </div>

        {/* Actions */}
        <div data-ui="server-detail-page-div-8" className="flex items-center gap-2 flex-shrink-0">
          <button data-ui="server-detail-page-button-3"
            onClick={() => window.electronAPI?.mcServerOpenFolder(server.id)}
            className="p-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t("servers.openFolder")}
          >
            <IconFolder className="w-5 h-5" />
          </button>
          <button data-ui="server-detail-page-button-4"
            onClick={handleRestart}
            disabled={!isRunning || isBusy}
            className={cn(
              "p-2 rounded-xl transition-all active:scale-[0.98]",
              isRunning && !isBusy
                ? "bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30"
                : "bg-muted/30 text-muted-foreground/40 border border-border cursor-not-allowed active:scale-100"
            )}
            title={t("servers.restart")}
          >
            <IconRefresh className="w-4 h-4" />
          </button>
          <button data-ui="server-detail-page-button-5"
            onClick={handleStartStop}
            disabled={isStoppingLike}
            className={cn(
              "p-2 rounded-xl transition-all active:scale-[0.98]",
              isRunning || isStartingLike || isInstallLike
                ? "bg-destructive hover:bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20"
                : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)]",
              isStoppingLike && "opacity-50 cursor-not-allowed active:scale-100"
            )}
            title={isRunning || isStartingLike || isInstallLike ? t("servers.stop") : t("servers.start")}
          >
            {isStoppingLike ? (
              <IconLoader2 className="w-4 h-4 animate-spin" />
            ) : isRunning || isStartingLike || isInstallLike ? (
              <IconPlayerStop className="w-4 h-4" />
            ) : (
              <IconPlayerPlay className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* XN Connect tunnel limit warning */}
      {limitState && (
        <div data-ui="server-detail-page-div-9" className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-destructive/10">
          <span data-ui="server-detail-page-span-9" className="text-xs text-destructive min-w-0">
            {t("servers.settings.xnconnect.limitReached", { used: limitState.used, max: limitState.max })}
          </span>
          <div data-ui="server-detail-page-div-10" className="flex gap-2 flex-shrink-0">
            <button data-ui="server-detail-page-button-6"
              onClick={() => window.electronAPI?.openExternal("https://connect.xneon.org/dashboard")}
              className="px-2.5 h-7 rounded-lg border border-border bg-muted/30 text-xs text-foreground hover:bg-muted/60 transition-colors"
            >
              {t("servers.settings.xnconnect.openDashboard")}
            </button>
            <button data-ui="server-detail-page-button-7"
              onClick={() => window.electronAPI?.openExternal("https://connect.xneon.org/subscribe")}
              className="px-2.5 h-7 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              {t("servers.settings.xnconnect.subscribe")}
            </button>
          </div>
        </div>
      )}

      {/* Download progress */}
      {downloadProgress && downloadProgress.phase !== "done" && (
        <div data-ui="server-detail-page-div-12" className="mx-3 my-3 rounded-2xl border border-border bg-primary/5 px-4 py-3">
          <div data-ui="server-detail-page-div-13" className="flex items-center gap-3">
            <IconDownload className="w-4 h-4 text-primary flex-shrink-0" />
            <div data-ui="server-detail-page-div-14" className="flex-1 min-w-0">
              <div data-ui="server-detail-page-div-15" className="flex items-center justify-between mb-1.5">
                <span data-ui="server-detail-page-span-10" className="text-xs font-medium text-foreground truncate">{downloadProgress.message}</span>
                {downloadProgress.percent != null && (
                  <span data-ui="server-detail-page-span-11" className="text-xs font-mono text-primary ml-2">{downloadProgress.percent}%</span>
                )}
              </div>
              {downloadProgress.percent != null && (
                <div data-ui="server-detail-page-div-16" className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div data-ui="server-detail-page-div-17"
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div data-ui="server-detail-page-div-18" className="flex gap-0.5 p-1 mt-4 rounded-xl bg-muted/30 border border-border/50 mx-auto w-fit">
        {tabs.map(tab => (
          <button data-ui="server-detail-page-button-8"
            key={tab.id}
              data-tab={tab.id}
              data-active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
            )}
          >
            <tab.icon className="w-4 h-4" strokeWidth={1.75} />
            {tab.label ?? t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div data-ui="server-detail-page-div-19" className="flex-1 min-h-0 flex flex-col mt-3">
        {activeTab === "console" && (
          <ConsoleTab
            serverId={server.id}
            serverName={server.name}
            logs={logs}
            isRunning={isRunning}
            command={command}
            onCommandChange={setCommand}
            onSendCommand={handleSendCommand}
            onClearLogs={clearLogs}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab server={server} onServerUpdated={onServerUpdated} />
        )}
        {activeTab === "players" && (
          <PlayersTab serverId={server.id} />
        )}
        {activeTab === "properties" && (
          <PropertiesTab server={server} flushRef={propertiesFlushRef} onServerUpdated={onServerUpdated} />
        )}
        {activeTab === "files" && (
          <FilesTab serverId={server.id} />
        )}
        {activeTab === "addons" && (
          <AddonsTab server={server} />
        )}
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function AddressChip({ icon: Icon, label, value, copied, onCopy }: { icon: React.ElementType; label: string; value: string; copied: boolean; onCopy: (addr: string) => void }) {
  const { t } = useTranslation()
  return (
    <button data-ui="server-detail-page-button-9" data-component="address-chip"
      onClick={() => onCopy(value)}
      type="button"
      className="group inline-flex h-5 min-w-0 max-w-full items-center gap-1.5 rounded-sm bg-transparent text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      title={`${label}: ${value} — ${t("servers.clickToCopy")}`}
    >
      {copied ? <IconCheck className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" /> : <Icon className="h-3 w-3 shrink-0 text-primary" strokeWidth={1.6} aria-hidden="true" />}
      <span className="min-w-0">
      <span data-ui="server-detail-page-span-12" className="sr-only">{label}: </span>
      <span data-ui="server-detail-page-span-13" className="block truncate font-mono text-[11px] font-normal leading-5">{value}</span>
      </span>

    </button>
  )
}
