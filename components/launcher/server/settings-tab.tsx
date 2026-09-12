import { useState, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconClipboard, IconCoffee, IconCode, IconCpu, IconFolderPlus, IconLoader, IconLoader2, IconServer, IconSettings, IconX, IconGauge } from "@tabler/icons-react"
import type { McServerInfo, XnConnectState, XnConnectUsage } from "@xnlc/types"
import type { JavaInstallation } from "@/components/launcher/settings/types"
import { cn } from "@/lib/utils"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { XnConnectLogo } from "./xn-connect-logo"

interface SettingsTabProps {
  server: McServerInfo
}

export function SettingsTab({ server }: SettingsTabProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(server.name)
  const [xmx, setXmx] = useState(String(server.xmx))
  const [xms, setXms] = useState(String(server.xms))
  const [extraJavaArgs, setExtraJavaArgs] = useState(server.extraJavaArgs)
  const [javaPath, setJavaPath] = useState(server.javaPath ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [detectedJava, setDetectedJava] = useState<JavaInstallation[]>([])
  const [loadingJava, setLoadingJava] = useState(false)
  const [showJavaModal, setShowJavaModal] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(server.relayEnabled)
  const [relayToggling, setRelayToggling] = useState(false)
  const [relayState, setRelayState] = useState<XnConnectState>({ status: "stopped" })
  const [usage, setUsage] = useState<XnConnectUsage | null>(null)
  const { maxMb, snapPoints } = useMemoryOptions()

  const isAuto = !javaPath || javaPath === "auto"

  const save = useCallback(async (update: Record<string, unknown>) => {
    setSaving(true)
    try {
      await window.electronAPI?.mcServerUpdate(server.id, update)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [server.id])

  const handleSaveName = () => {
    if (name.trim() && name !== server.name) save({ name: name.trim() })
  }

  const handleSaveArgs = () => {
    if (extraJavaArgs !== server.extraJavaArgs) save({ extraJavaArgs })
  }

  const handleToggleRelay = async () => {
    if (relayToggling) return
    const next = !relayEnabled
    setRelayToggling(true)
    setRelayEnabled(next)

    if (next) {
      setRelayState({ status: "starting" })
      try {
        const fresh = await window.electronAPI?.xnConnectUsage()
        if (fresh) setUsage(fresh)
        if (fresh && fresh.used >= fresh.max) {
          setRelayEnabled(false)
          setRelayState({ status: "limit_reached", used: fresh.used, max: fresh.max, plan: fresh.plan })
          setRelayToggling(false)
          return
        }
      } catch { /* fall through to normal start */ }
    } else {
      setRelayState({ status: "stopped" })
    }

    try {
      await save({ relayEnabled: next ? 1 : 0 })
      if (next) {
        await window.electronAPI?.xnConnectStart(server.id)
      } else {
        await window.electronAPI?.xnConnectStop(server.id)
      }
    } catch (e) {
      console.error("[XN-Connect] Toggle error:", e)
      setRelayEnabled(!next)
      setRelayState({ status: "stopped" })
    } finally {
      setRelayToggling(false)
    }
  }

  useEffect(() => {
    const unsubState = window.electronAPI?.onXnConnectState((data) => {
      if (data.serverId === server.id) setRelayState(data.state)
    })
    const unsubUsage = window.electronAPI?.onXnConnectUsage((u) => setUsage(u))
    // Get initial state + tunnel usage counter
    window.electronAPI?.xnConnectStatus(server.id).then(s => setRelayState(s))
    window.electronAPI?.xnConnectUsage().then(u => { if (u) setUsage(u) })
    return () => {
      unsubState?.()
      unsubUsage?.()
    }
  }, [server.id])

  const handlePickJava = (path: string) => {
    setJavaPath(path)
    save({ javaPath: path || null })
    setShowJavaModal(false)
  }

  const handlePickJavaFile = async () => {
    const picked = await window.electronAPI?.pickJavaFile()
    if (picked) handlePickJava(picked)
  }

  useEffect(() => {
    window.electronAPI?.detectJavaInstallations().then(list => {
      setDetectedJava(list ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!showJavaModal || detectedJava.length > 0) return
    let cancelled = false
    setLoadingJava(true)
    window.electronAPI?.detectJavaInstallations().then(list => {
      if (!cancelled) setDetectedJava(list ?? [])
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoadingJava(false)
    })
    return () => { cancelled = true }
  }, [showJavaModal, detectedJava.length])

  const selectedJavaLabel = isAuto
    ? t("settings.java.automatic")
    : detectedJava.find(j => j.path === javaPath)?.label || javaPath.split(/[\\/]/).pop() || javaPath

  return (
    <div className="space-y-5 overflow-y-auto h-full p-4 pr-1">
      {/* Status indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground h-5">
        {saving ? (
          <span className="flex items-center gap-1.5">
            <IconLoader className="w-3 h-3 animate-spin text-primary" />
            {t("servers.settings.saving")}
          </span>
        ) : saved ? (
          <span className="flex items-center gap-1.5">
            <IconCheck className="w-3 h-3 text-green-400" />
            {t("servers.settings.saved")}
          </span>
        ) : null}
      </div>

      {/* Name */}
      <SettingGroup label={(
        <span className="flex items-center gap-2">
          <IconServer className="w-5 h-5 text-primary" strokeWidth={1.75} />
          {t("servers.name")}
        </span>
      )}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={e => e.key === "Enter" && handleSaveName()}
          className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </SettingGroup>

      {/* Java */}
      <SettingGroup label={(
        <span className="flex items-center gap-2">
          <IconCoffee className="w-5 h-5 text-primary" strokeWidth={1.75} />
          {t("settings.javaPath")}
        </span>
      )}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowJavaModal(true)}
            className={cn(
              "flex-1 h-11 rounded-xl border px-4 text-left text-sm transition-all duration-200 flex items-center justify-between",
              isAuto ? "border-border bg-muted/40 text-muted-foreground hover:border-primary/50 hover:bg-muted/50" : "border-primary/50 bg-primary/5 text-foreground hover:bg-primary/10"
            )}
          >
            <span className="truncate">{selectedJavaLabel}</span>
          </button>
          <button
            type="button"
            onClick={handlePickJavaFile}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <IconFolderPlus className="h-4 w-4" strokeWidth={1.75} />
            {t("servers.settings.file")}
          </button>
        </div>
      </SettingGroup>

      {/* Memory */}
      <SettingGroup label={(
        <span className="flex items-center gap-2">
          <IconCpu className="w-5 h-5 text-primary" strokeWidth={1.75} />
          {t("settings.ram")} (MB)
        </span>
      )}>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Xmx (max)</label>
            <MemorySlider
              value={parseInt(xmx, 10) || 8192}
              onChange={(v) => { setXmx(String(v)); save({ xmx: v }) }}
              min={512}
              max={maxMb}
              step={64}
              snapPoints={snapPoints}
              snapRange={512}
              unit="MB"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Xms (start)</label>
            <MemorySlider
              value={parseInt(xms, 10) || 1024}
              onChange={(v) => { setXms(String(v)); save({ xms: v }) }}
              min={256}
              max={maxMb}
              step={64}
              snapPoints={snapPoints}
              snapRange={512}
              unit="MB"
            />
          </div>
        </div>
      </SettingGroup>

      {/* Extra Java Args */}
      <SettingGroup label={(
        <span className="flex items-center gap-2">
          <IconCode className="w-5 h-5 text-primary" strokeWidth={1.75} />
          {t("settings.java.args")}
        </span>
      )}>
        <input
          value={extraJavaArgs}
          onChange={e => setExtraJavaArgs(e.target.value)}
          onBlur={handleSaveArgs}
          placeholder={t("settings.java.argsPlaceholder")}
          className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </SettingGroup>

      {/* XN Connect Relay */}
      <SettingGroup
        label={(
          <span className="flex items-center gap-2">
            <XnConnectLogo className="w-5 h-5 text-primary" />
            XN Connect
          </span>
        )}
        action={usage && (
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
              usage.used >= usage.max
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-border bg-muted/50 text-muted-foreground"
            )}
            title={t("servers.settings.xnconnect.usageHint")}
          >
            <IconGauge className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="font-mono">{usage.used}/{usage.max}</span>
            <span>·</span>
            <span className="capitalize">{usage.plan}</span>
          </div>
        )}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">
            {t("servers.settings.xnconnect.desc")}
          </p>
          <button
            onClick={handleToggleRelay}
            disabled={relayToggling}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors",
              relayEnabled ? "bg-primary" : "bg-muted",
              relayToggling && "opacity-70 cursor-wait"
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm flex items-center justify-center",
              relayEnabled ? "translate-x-5.5" : "translate-x-0.5"
            )}>
              {relayToggling && (
                <IconLoader2 className="w-3 h-3 text-primary animate-spin" strokeWidth={2.5} />
              )}
            </div>
          </button>
        </div>
        {relayEnabled && (
          <div className="text-xs text-muted-foreground space-y-1">
            {relayState.status === "stopped" && (
              <span className="text-orange-400">{t("servers.statusStopped")}</span>
            )}
            {relayState.status === "auth_required" && (
              <span className="text-yellow-400">{t("servers.settings.xnconnect.authWaiting")}</span>
            )}
            {relayState.status === "starting" && (
              <span className="text-blue-400">{t("servers.statusStarting")}</span>
            )}
            {relayState.status === "running" && (
              <div>
                <span className="text-green-400">{t("servers.settings.xnconnect.active")}</span>
                <span className="font-mono">{relayState.publicAddress}</span>
              </div>
            )}
          </div>
        )}
        {relayState.status === "limit_reached" && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 space-y-2.5">
            <p className="text-xs font-medium text-red-400">
              {t("servers.settings.xnconnect.limitReached", { used: relayState.used, max: relayState.max })}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("servers.settings.xnconnect.limitReachedDesc")}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => window.electronAPI?.openExternal("https://connect.xneon.org/dashboard")}
                className="px-3 h-8 rounded-lg border border-border bg-muted/30 text-xs text-foreground hover:bg-muted/60 transition-colors"
              >
                {t("servers.settings.xnconnect.openDashboard")}
              </button>
              <button
                onClick={() => window.electronAPI?.openExternal("https://connect.xneon.org/subscribe")}
                className="px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                {t("servers.settings.xnconnect.subscribe")}
              </button>
            </div>
          </div>
        )}
      </SettingGroup>

      {/* XN-Connect Auth Modal */}
      {relayState.status === "auth_required" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <XnConnectLogo className="w-5 h-5 text-primary" />
                {t("servers.settings.xnconnect.authTitle")}
              </h3>
              <button
                onClick={() => {
                  window.electronAPI?.xnConnectStop(server.id)
                  setRelayEnabled(false)
                  save({ relayEnabled: 0 })
                }}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              {t("servers.settings.xnconnect.authDesc")}
            </p>

            <div className="p-3 rounded-xl bg-muted/50 border border-border mb-4">
              <p className="text-xs text-muted-foreground mb-2">{t("servers.settings.xnconnect.authLink")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-foreground break-all font-mono leading-relaxed">
                  {relayState.authUrl}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(relayState.authUrl)}
                  className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  title={t("servers.settings.xnconnect.copy")}
                >
                  <IconClipboard className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <IconLoader2 className="w-3 h-3 animate-spin text-primary" />
              {t("servers.settings.xnconnect.authConfirm")}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  window.electronAPI?.xnConnectStop(server.id)
                  setRelayEnabled(false)
                  save({ relayEnabled: 0 })
                }}
                className="flex-1 h-10 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                {t("servers.cancel")}
              </button>
              <a
                href={relayState.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center hover:bg-primary/90 transition-colors"
              >
                {t("servers.settings.xnconnect.openBrowser")}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Java modal */}
      {showJavaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground">Java</h3>
              <button
                onClick={() => setShowJavaModal(false)}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <button
                onClick={() => handlePickJava("")}
                className={cn(
                  "w-full p-4 rounded-xl border transition-all duration-200 text-left",
                  isAuto
                    ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                    : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-foreground">{t("settings.java.automatic")}</div>
                  <span className={cn(
                    "text-xs px-2 py-1 rounded-md font-medium",
                    isAuto ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {isAuto ? t("settings.java.selected") : t("settings.java.select")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{t("servers.settings.java.autoDesc")}</div>
              </button>

              {loadingJava ? (
                <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                  <span className="text-sm text-muted-foreground">{t("settings.java.searching")}</span>
                </div>
              ) : detectedJava.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground px-1">{t("settings.java.detected")}</div>
                  <div className="max-h-[304px] space-y-2 overflow-y-auto pr-1">
                    {detectedJava.map((java, index) => (
                      <button
                        key={index}
                        onClick={() => handlePickJava(java.path)}
                        className={cn(
                          "w-full min-h-[70px] p-3 rounded-xl border transition-all duration-200 text-left",
                          javaPath === java.path
                            ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-foreground text-sm">{java.label}</div>
                          <span className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                            javaPath === java.path ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            {javaPath === java.path ? t("settings.java.selected") : t("settings.java.select")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                onClick={handlePickJavaFile}
                className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between px-4 text-muted-foreground hover:text-accent"
              >
                <div className="flex items-center gap-2">
                  <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
                  <span className="text-sm">{t("servers.settings.java.selectFile")}</span>
                </div>
                <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">{t("servers.settings.java.browse")}</span>
              </button>
            </div>

            <button
              onClick={() => setShowJavaModal(false)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm transition-colors"
            >
              <IconX className="w-4 h-4" strokeWidth={1.75} />
              {t("servers.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingGroup({ label, action, children }: { label: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        {action}
      </div>
      {children}
    </div>
  )
}
