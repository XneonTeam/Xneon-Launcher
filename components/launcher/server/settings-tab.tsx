import { useState, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconClipboard, IconFolderPlus, IconLoader, IconLoader2, IconSettings, IconWorld, IconX } from "@tabler/icons-react"
import type { McServerInfo, XnConnectState } from "@xnlc/types"
import type { JavaInstallation } from "@/components/launcher/settings/types"
import { IconPickerModal } from "@/components/launcher/instance/icon-picker-modal"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import { cn } from "@/lib/utils"

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
  const [icon, setIcon] = useState(server.icon ?? "")
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [detectedJava, setDetectedJava] = useState<JavaInstallation[]>([])
  const [loadingJava, setLoadingJava] = useState(false)
  const [showJavaModal, setShowJavaModal] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(server.relayEnabled)
  const [relayState, setRelayState] = useState<XnConnectState>({ status: "stopped" })

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

  const handleSaveMemory = () => {
    const newXmx = parseInt(xmx, 10)
    const newXms = parseInt(xms, 10)
    const updates: Record<string, unknown> = {}
    if (newXmx > 0 && newXmx !== server.xmx) updates.xmx = newXmx
    if (newXms > 0 && newXms !== server.xms) updates.xms = newXms
    if (Object.keys(updates).length > 0) save(updates)
  }

  const handleSaveArgs = () => {
    if (extraJavaArgs !== server.extraJavaArgs) save({ extraJavaArgs })
  }

  const handleIconChange = (newIcon: string) => {
    setIcon(newIcon)
    save({ icon: newIcon || null })
  }

  const handleToggleRelay = async () => {
    const next = !relayEnabled
    setRelayEnabled(next)
    save({ relayEnabled: next ? 1 : 0 })
    if (next) {
      await window.electronAPI?.xnConnectStart(server.id)
    } else {
      await window.electronAPI?.xnConnectStop(server.id)
    }
  }

  useEffect(() => {
    const unsubState = window.electronAPI?.onXnConnectState((data) => {
      if (data.serverId === server.id) setRelayState(data.state)
    })
    // Get initial state
    window.electronAPI?.xnConnectStatus(server.id).then(s => setRelayState(s))
    return () => unsubState?.()
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
    ? "Автоматически"
    : detectedJava.find(j => j.path === javaPath)?.label || javaPath.split(/[\\/]/).pop() || javaPath

  return (
    <div className="space-y-5 overflow-y-auto h-full p-4 pr-1">
      {/* Status indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground h-5">
        {saving ? (
          <span className="flex items-center gap-1.5">
            <IconLoader className="w-3 h-3 animate-spin text-primary" />
            Saving...
          </span>
        ) : saved ? (
          <span className="flex items-center gap-1.5">
            <IconCheck className="w-3 h-3 text-green-400" />
            Saved
          </span>
        ) : null}
      </div>

      {/* Icon */}
      <SettingGroup label="Иконка">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowIconPicker(true)}
            className="w-16 h-16 rounded-xl border border-border overflow-hidden flex items-center justify-center bg-muted/30 hover:border-primary/50 transition-colors flex-shrink-0"
          >
            {icon ? (
              <img src={icon} alt="" className="w-full h-full object-cover" />
            ) : (
              <LoaderIcon loaderId={server.modloader} className="w-8 h-8 text-primary/40" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setShowIconPicker(true)}
              className="text-sm text-primary hover:underline"
            >
              {icon ? "Изменить иконку" : "Выбрать иконку"}
            </button>
            {icon && (
              <button
                type="button"
                onClick={() => handleIconChange("")}
                className="ml-3 text-sm text-destructive hover:underline"
              >
                Убрать
              </button>
            )}
          </div>
        </div>
        <IconPickerModal open={showIconPicker} onOpenChange={setShowIconPicker} value={icon} onChange={handleIconChange} />
      </SettingGroup>

      {/* Name */}
      <SettingGroup label={t("servers.name")}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={e => e.key === "Enter" && handleSaveName()}
          className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </SettingGroup>

      {/* Java */}
      <SettingGroup label="Java">
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
            Файл...
          </button>
        </div>
      </SettingGroup>

      {/* Memory */}
      <SettingGroup label={`${t("settings.ram")} (MB)`}>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1.5 block">Xmx (max)</label>
            <input
              value={xmx}
              onChange={e => setXmx(e.target.value)}
              onBlur={handleSaveMemory}
              type="number"
              min={512}
              step={256}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1.5 block">Xms (start)</label>
            <input
              value={xms}
              onChange={e => setXms(e.target.value)}
              onBlur={handleSaveMemory}
              type="number"
              min={256}
              step={256}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>
      </SettingGroup>

      {/* Extra Java Args */}
      <SettingGroup label="Extra Java Args">
        <input
          value={extraJavaArgs}
          onChange={e => setExtraJavaArgs(e.target.value)}
          onBlur={handleSaveArgs}
          placeholder="-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions"
          className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </SettingGroup>

      {/* XN-Connect Relay */}
      <SettingGroup label="XN-Connect">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">
            Доступ через connect.xneon.org
          </p>
          <button
            onClick={handleToggleRelay}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors",
              relayEnabled ? "bg-primary" : "bg-muted"
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm",
              relayEnabled ? "translate-x-5.5" : "translate-x-0.5"
            )} />
          </button>
        </div>
        {relayEnabled && (
          <div className="text-xs text-muted-foreground space-y-1">
            {relayState.status === "stopped" && (
              <span className="text-orange-400">Остановлен</span>
            )}
            {relayState.status === "auth_required" && (
              <span className="text-yellow-400">Ожидание авторизации...</span>
            )}
            {relayState.status === "starting" && (
              <span className="text-blue-400">Запуск...</span>
            )}
            {relayState.status === "running" && (
              <div>
                <span className="text-green-400">Активен: </span>
                <span className="font-mono">{relayState.publicAddress}</span>
              </div>
            )}
          </div>
        )}
      </SettingGroup>

      {/* XN-Connect Auth Modal */}
      {relayState.status === "auth_required" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <IconWorld className="w-5 h-5 text-primary" strokeWidth={1.5} />
                XN-Connect Авторизация
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
              Откройте ссылку в браузере для авторизации через Xneon Account.
            </p>

            <div className="p-3 rounded-xl bg-muted/50 border border-border mb-4">
              <p className="text-xs text-muted-foreground mb-2">Ссылка для авторизации:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-foreground break-all font-mono leading-relaxed">
                  {relayState.authUrl}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(relayState.authUrl)}
                  className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  title="Скопировать"
                >
                  <IconClipboard className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <IconLoader2 className="w-3 h-3 animate-spin text-primary" />
              Ожидание подтверждения в браузере...
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
                Отмена
              </button>
              <a
                href={relayState.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center hover:bg-primary/90 transition-colors"
              >
                Открыть в браузере
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
                  <div className="font-medium text-foreground">Автоматически</div>
                  <span className={cn(
                    "text-xs px-2 py-1 rounded-md font-medium",
                    isAuto ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {isAuto ? "Выбрана" : "Выбрать"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Использовать Java из глобальных настроек</div>
              </button>

              {loadingJava ? (
                <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                  <span className="text-sm text-muted-foreground">Поиск Java...</span>
                </div>
              ) : detectedJava.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground px-1">Обнаруженные</div>
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
                            {javaPath === java.path ? "Выбрана" : "Выбрать"}
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
                  <span className="text-sm">Выбрать файл...</span>
                </div>
                <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">Обзор</span>
              </button>
            </div>

            <button
              onClick={() => setShowJavaModal(false)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm transition-colors"
            >
              <IconX className="w-4 h-4" strokeWidth={1.75} />
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  )
}
