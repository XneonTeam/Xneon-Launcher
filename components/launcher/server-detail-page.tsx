import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  IconArrowLeft, IconTerminal, IconSettings, IconPlayerPlay,
  IconPlayerStop, IconFolder, IconPuzzle, IconAdjustments, IconUsers,
  IconRefresh, IconDownload, IconCpu, IconDatabase, IconClock,
  IconNetwork, IconCopy, IconCheck, IconCamera, IconTrash,
} from "@tabler/icons-react"
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
    <div className="flex flex-col h-full animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      <ServerEulaModal
        open={showEula}
        onAccept={handleEulaAccept}
        onDecline={handleEulaDecline}
      />
      {/* Header */}
      <div className="flex items-start gap-4 pb-4 border-b border-border">
        {/* Back button */}
        <button
          onClick={onBack}
          className="mt-1 p-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <IconArrowLeft className="w-5 h-5" />
        </button>

        {/* Server icon */}
        <button
          onClick={() => setShowIconPicker(true)}
          className="relative w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 border border-border bg-muted/70 hover:border-primary/50 transition-colors cursor-pointer group"
        >
          {icon ? (
            <EntityIcon src={icon} className="w-full h-full p-2 text-primary" imgClassName="w-full h-full object-cover" />
          ) : (
            <>
              <LoaderIcon loaderId={server.modloader} className="w-10 h-10 text-primary/60" />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <IconCamera className="w-5 h-5 text-white" />
              </div>
            </>
          )}
        </button>
        <IconPickerModal open={showIconPicker} onOpenChange={setShowIconPicker} value={icon} onChange={handleIconChange} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h1 className="m-0 text-lg font-bold text-foreground truncate">{server.name}</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-muted/60 text-xs text-muted-foreground">
              <LoaderIcon loaderId={server.modloader} className="w-3 h-3 flex-shrink-0" />
              {loaderName} {server.gameVersion}
            </span>
            {/* Status badge */}
            <div className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium",
              isRunning && "bg-green-500/15 text-green-400 border border-green-500/20",
              isStartingLike && "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
              isInstallLike && "bg-primary/15 text-primary border border-primary/25",
              isStoppingLike && "bg-orange-500/15 text-orange-400 border border-orange-500/20",
              !isRunning && !isBusy && "bg-muted/60 text-muted-foreground border border-border",
            )}>
              <div className={cn(
                "h-2 w-2 rounded-full",
                isRunning && "bg-green-400",
                isStartingLike && "bg-yellow-400 animate-pulse",
                isInstallLike && "bg-primary animate-pulse",
                isStoppingLike && "bg-orange-400",
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
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconCpu className="w-3 h-3 text-green-400" />
                  <span className="font-mono font-bold text-foreground">{metrics.cpuPercent}%</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconDatabase className="w-3 h-3 text-primary" />
                  <span className="font-mono font-bold text-foreground">{metrics.memoryMb} <span className="text-foreground">MB</span></span>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconClock className="w-3 h-3 text-accent" />
                  <span className="font-mono font-bold text-foreground">{formatUptime(metrics.uptimeSeconds)}</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => window.electronAPI?.mcServerOpenFolder(server.id)}
            className="p-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t("servers.openFolder")}
          >
            <IconFolder className="w-5 h-5" />
          </button>
          <button
            onClick={handleRestart}
            disabled={!isRunning || isBusy}
            className={cn(
              "p-2 rounded-xl transition-all active:scale-[0.98]",
              isRunning && !isBusy
                ? "bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 border border-orange-500/30"
                : "bg-muted/30 text-muted-foreground/40 border border-border cursor-not-allowed active:scale-100"
            )}
            title={t("servers.restart")}
          >
            <IconRefresh className="w-4 h-4" />
          </button>
          <button
            onClick={handleStartStop}
            disabled={isStoppingLike}
            className={cn(
              "p-2 rounded-xl transition-all active:scale-[0.98]",
              isRunning || isStartingLike || isInstallLike
                ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)]",
              isStoppingLike && "opacity-50 cursor-not-allowed active:scale-100"
            )}
            title={isRunning || isStartingLike || isInstallLike ? t("servers.stop") : t("servers.start")}
          >
            {isStoppingLike ? (
              <IconRefresh className="w-4 h-4 animate-spin" />
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
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-red-500/10">
          <span className="text-xs text-red-400 min-w-0">
            {t("servers.settings.xnconnect.limitReached", { used: limitState.used, max: limitState.max })}
          </span>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => window.electronAPI?.openExternal("https://connect.xneon.org/dashboard")}
              className="px-2.5 h-7 rounded-lg border border-border bg-muted/30 text-xs text-foreground hover:bg-muted/60 transition-colors"
            >
              {t("servers.settings.xnconnect.openDashboard")}
            </button>
            <button
              onClick={() => window.electronAPI?.openExternal("https://connect.xneon.org/subscribe")}
              className="px-2.5 h-7 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              {t("servers.settings.xnconnect.subscribe")}
            </button>
          </div>
        </div>
      )}

      {/* Addresses */}
      {addresses && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/10">
          <IconNetwork className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <AddressChip label="LAN" value={addresses.local} copied={copiedAddr === addresses.local} onCopy={handleCopyAddr} />
          {addresses.public && (
            <AddressChip label="Public" value={addresses.public} copied={copiedAddr === addresses.public} onCopy={handleCopyAddr} />
          )}
          {addresses.custom ? (
            // Чип показываем только когда адрес XN Connect реально есть: если
            // функция выключена у сервера, никакого «XNEON» в шапке быть не должно.
            <AddressChip label="Xneon" value={addresses.custom} copied={copiedAddr === addresses.custom} onCopy={handleCopyAddr} />
          ) : null}
        </div>
      )}

      {/* Download progress */}
      {downloadProgress && downloadProgress.phase !== "done" && (
        <div className="mx-3 my-3 rounded-2xl border border-border bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <IconDownload className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-foreground truncate">{downloadProgress.message}</span>
                {downloadProgress.percent != null && (
                  <span className="text-xs font-mono text-primary ml-2">{downloadProgress.percent}%</span>
                )}
              </div>
              {downloadProgress.percent != null && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
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
      <div className="flex gap-0.5 p-1 mt-4 rounded-xl bg-muted/30 border border-border/50 mx-auto w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
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
      <div className="flex-1 min-h-0 flex flex-col mt-3">
        {activeTab === "console" && (
          <ConsoleTab
            serverId={server.id}
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

function AddressChip({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: (addr: string) => void }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={() => onCopy(value)}
      className="group flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 hover:bg-muted border border-border/50 transition-colors cursor-pointer"
      title={`${label}: ${value} — ${t("servers.clickToCopy")}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-[11px] font-mono text-foreground/80">{value}</span>
      {copied ? (
        <IconCheck className="w-3 h-3 text-green-400" />
      ) : (
        <IconCopy className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
      )}
    </button>
  )
}
