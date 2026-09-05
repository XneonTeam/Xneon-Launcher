import { useState, useEffect, useCallback } from "react"
import { IconServer, IconArrowLeft, IconCheck, IconFolderPlus, IconLoader2, IconShield, IconRouter, IconClipboard, IconExternalLink } from "@tabler/icons-react"
import { XnConnectLogo } from "./server/xn-connect-logo"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { memoryToMb, mbToMemory } from "@/lib/memory"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import type { JavaInstallation } from "./settings/types"

export interface PackInstallTarget {
  source: "modrinth" | "curseforge"
  projectSlug?: string
  versionId?: string
  modId?: number
  fileId?: number
  name: string
  icon?: string
}

interface ServerPackInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pack: PackInstallTarget | null
  onInstalled?: () => void
}

const STEPS = ["port", "settings", "java", "connect"] as const
type Step = (typeof STEPS)[number]

export function ServerPackInstallDialog({ open, onOpenChange, pack, onInstalled }: ServerPackInstallDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("port")
  const [port, setPort] = useState("25565")
  const [xmx, setXmx] = useState(2048)
  const [xms, setXms] = useState(1024)
  const [extraJavaArgs, setExtraJavaArgs] = useState("")
  const [javaPath, setJavaPath] = useState("auto")
  const [globalJavaPath, setGlobalJavaPath] = useState("")
  const [detectedJava, setDetectedJava] = useState<JavaInstallation[]>([])
  const [loadingJava, setLoadingJava] = useState(false)
  const [onlineMode, setOnlineMode] = useState(true)
  const [maxPlayers, setMaxPlayers] = useState(20)
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [authing, setAuthing] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [authDone, setAuthDone] = useState(false)
  const [installing, setInstalling] = useState(false)

  const { maxMb, snapPoints } = useMemoryOptions()

  const STEP_LABELS: Record<Step, string> = {
    port: t("servers.packInstall.stepPort"),
    settings: t("servers.packInstall.stepSettings"),
    java: t("servers.packInstall.stepJava"),
    connect: t("servers.packInstall.stepConnect"),
  }

  const reset = useCallback(() => {
    setStep("port")
    setPort("25565")
    setXmx(2048)
    setXms(1024)
    setExtraJavaArgs("")
    setJavaPath("auto")
    setOnlineMode(true)
    setMaxPlayers(20)
    setRelayEnabled(false)
    setAuthing(false)
    setAuthUrl(null)
    setAuthDone(false)
    setInstalling(false)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
    window.electronAPI?.getSetting("javaPath").then(p => setGlobalJavaPath(p ?? ""))
  }, [open, reset])

  useEffect(() => {
    if (!open || step !== "java") return
    setLoadingJava(true)
    void window.electronAPI?.detectJavaInstallations().then(installs => {
      setDetectedJava(installs ?? [])
      setLoadingJava(false)
    }).catch(() => {
      setDetectedJava([])
      setLoadingJava(false)
    })
  }, [open, step])

  useEffect(() => {
    if (!open) return
    return window.electronAPI?.onXnConnectAuthState((data) => {
      const s = data.state
      if (s.status === "auth_required" && "authUrl" in s && s.authUrl) {
        setAuthUrl(s.authUrl)
        setAuthing(true)
      } else if (s.status === "starting") {
        setAuthing(true)
        setAuthUrl(null)
      } else if (s.status === "running") {
        setAuthing(false)
        setAuthUrl(null)
        setAuthDone(true)
      } else if (s.status === "stopped") {
        setAuthing(false)
      }
    })
  }, [open])

  const stepIndex = (STEPS as readonly string[]).indexOf(step)

  const canNext = () => {
    if (step === "port") {
      const p = parseInt(port)
      return !Number.isNaN(p) && p >= 1 && p <= 65535
    }
    return true
  }

  const handleBack = () => {
    const idx = (STEPS as readonly string[]).indexOf(step)
    if (idx <= 0) return
    setStep(STEPS[idx - 1])
  }

  const handleNext = () => {
    const idx = (STEPS as readonly string[]).indexOf(step)
    if (idx >= STEPS.length - 1) return
    setStep(STEPS[idx + 1])
  }

  const handleAuthorize = async () => {
    if (authing || authDone) return
    setAuthing(true)
    setAuthUrl(null)
    try {
      const ok = await window.electronAPI?.xnConnectAuthorize()
      if (ok) setAuthDone(true)
    } finally {
      setAuthing(false)
    }
  }

  const handleInstall = async () => {
    if (!pack || installing) return
    setInstalling(true)
    try {
      await window.electronAPI?.mcServerInstallPack({
        source: pack.source,
        projectSlug: pack.projectSlug,
        versionId: pack.versionId,
        modId: pack.modId,
        fileId: pack.fileId,
        name: pack.name,
        icon: pack.icon,
        port: parseInt(port) || 25565,
        xmx,
        xms,
        extraJavaArgs,
        javaPath: javaPath && javaPath !== "auto" ? javaPath : undefined,
        relayEnabled,
        onlineMode,
        maxPlayers,
      })
      onInstalled?.()
      onOpenChange(false)
    } catch (err) {
      console.error("[servers] Pack install failed:", err)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[520px] !max-w-[90vw] sm:!max-w-[520px] p-0 gap-0 overflow-hidden">
        {/* Step indicator */}
        <div className="px-6 pt-5 pb-4">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <IconServer className="w-4 h-4 text-primary" />
              </div>
              <span className="flex items-center gap-2">
                {t("servers.packInstall.title")}
                {pack && (
                  <span className="text-xs font-normal text-muted-foreground truncate max-w-[220px]">
                    · {pack.name}
                  </span>
                )}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all flex-shrink-0",
                  i < stepIndex && "bg-primary text-primary-foreground",
                  i === stepIndex && "bg-primary/20 text-primary ring-2 ring-primary/30",
                  i > stepIndex && "bg-muted text-muted-foreground",
                )}>
                  {i < stepIndex ? <IconCheck className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    "h-0.5 flex-1 rounded-full transition-colors",
                    i < stepIndex ? "bg-primary" : "bg-muted",
                  )} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            {STEPS.map(s => (
              <span key={s} className={cn(
                "text-[10px] font-medium w-7 text-center",
                s === step ? "text-primary" : "text-muted-foreground",
              )}>
                {STEP_LABELS[s]}
              </span>
            ))}
          </div>
        </div>

        <div className="h-px bg-border" />

        <>
          {/* Step content */}
            <div className="px-6 py-5 min-h-[280px]">
              {step === "port" && (
                <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.packInstall.portTitle")}</h3>
                    <p className="text-xs text-muted-foreground">{t("servers.packInstall.portDesc")}</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">{t("servers.packInstall.port")}</label>
                    <input
                      type="number"
                      value={port}
                      onChange={e => setPort(e.target.value.replace(/\D/g, ""))}
                      min={1}
                      max={65535}
                      className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground text-sm focus:outline-none focus:border-primary transition-colors font-mono"
                    />
                  </div>
                </div>
              )}

              {step === "settings" && (
                <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.packInstall.settingsTitle")}</h3>
                    <p className="text-xs text-muted-foreground">{t("servers.packInstall.settingsDesc")}</p>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
                    <label className="block text-sm font-medium text-foreground">{t("servers.packInstall.ramMax")}</label>
                    <MemorySlider
                      value={xmx}
                      min={512}
                      max={maxMb}
                      step={256}
                      snapPoints={snapPoints}
                      snapRange={512}
                      unit="MB"
                      onChange={(v) => {
                        setXmx(v)
                        if (xms > v) setXms(v)
                      }}
                    />
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
                    <label className="block text-sm font-medium text-foreground">{t("servers.packInstall.ramMin")}</label>
                    <MemorySlider
                      value={xms}
                      min={256}
                      max={Math.max(256, xmx)}
                      step={256}
                      unit="MB"
                      onChange={(v) => setXms(Math.min(v, xmx))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">{t("servers.packInstall.maxPlayers")}</label>
                      <input
                        type="number"
                        value={maxPlayers}
                        onChange={e => setMaxPlayers(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                        min={1}
                        max={1000}
                        className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm font-mono focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">{t("servers.packInstall.pirate")}</label>
                      <button
                        type="button"
                        onClick={() => setOnlineMode(!onlineMode)}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-2.5 rounded-xl border transition-all",
                          !onlineMode
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/30"
                        )}
                      >
                        <span className="text-sm text-foreground">{!onlineMode ? t("servers.packInstall.on") : t("servers.packInstall.off")}</span>
                        <div className={cn(
                          "relative w-9 h-5 rounded-full transition-colors",
                          !onlineMode ? "bg-primary" : "bg-muted"
                        )}>
                          <div className={cn(
                            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                            !onlineMode ? "translate-x-4.5" : "translate-x-0.5"
                          )} />
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">{t("servers.packInstall.extraJavaArgs")}</label>
                    <input
                      type="text"
                      value={extraJavaArgs}
                      onChange={e => setExtraJavaArgs(e.target.value)}
                      placeholder="-XX:+UseG1GC"
                      className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                </div>
              )}

              {step === "java" && (
                <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.packInstall.javaTitle")}</h3>
                    <p className="text-xs text-muted-foreground">{t("servers.packInstall.javaDesc")}</p>
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setJavaPath("auto")}
                      className={cn(
                        "w-full p-4 rounded-xl border transition-all duration-200 text-left",
                        javaPath === "auto"
                          ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                          : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-foreground">{t("servers.packInstall.javaAuto")}</div>
                        <span className={cn(
                          "text-xs px-2 py-1 rounded-md font-medium",
                          javaPath === "auto" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                        )}>
                          {javaPath === "auto" ? t("servers.packInstall.javaSelected") : t("servers.packInstall.javaSelect")}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{t("servers.packInstall.javaAutoDesc")}</div>
                    </button>

                    {globalJavaPath && (
                      <button
                        type="button"
                        onClick={() => setJavaPath("")}
                        className={cn(
                          "w-full p-3 rounded-xl border transition-all duration-200 text-left",
                          javaPath === ""
                            ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-foreground text-sm">{t("servers.packInstall.javaGlobal")}</div>
                          <span className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                            javaPath === "" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            {javaPath === "" ? t("servers.packInstall.javaSelected") : t("servers.packInstall.javaSelect")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">{globalJavaPath}</div>
                      </button>
                    )}

                    {loadingJava ? (
                      <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                        <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                        <span className="text-sm text-muted-foreground">{t("servers.packInstall.javaSearching")}</span>
                      </div>
                    ) : detectedJava.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground px-1">{t("servers.packInstall.javaDetected")}</div>
                        <div className="max-h-[200px] space-y-2 overflow-y-auto pr-1">
                          {detectedJava.map((java, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => setJavaPath(java.path)}
                              className={cn(
                                "w-full min-h-[60px] p-3 rounded-xl border transition-all duration-200 text-left",
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
                                   {javaPath === java.path ? t("servers.packInstall.javaSelected") : t("servers.packInstall.javaSelect")}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <button
                      onClick={async () => {
                        const picked = await window.electronAPI?.pickJavaFile()
                        if (picked) setJavaPath(picked)
                      }}
                      className="w-full p-3 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between px-4 text-muted-foreground hover:text-accent"
                    >
                      <div className="flex items-center gap-2">
                        <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
                        <span className="text-sm">{t("servers.packInstall.javaPickFile")}</span>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">{t("servers.packInstall.javaBrowse")}</span>
                    </button>
                  </div>
                </div>
              )}

              {step === "connect" && (
                <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.packInstall.connectTitle")}</h3>
                    <p className="text-xs text-muted-foreground">{t("servers.packInstall.connectDesc")}</p>
                  </div>

                  <div className="p-4 rounded-xl border border-border bg-gradient-to-br from-primary/5 via-primary/[0.02] to-accent/5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <XnConnectLogo className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">{t("servers.packInstall.xnConnect")}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("servers.packInstall.xnConnectDesc")}</p>
                      </div>
                    </div>

                    <div className="space-y-2.5 text-xs text-muted-foreground">
                      <div className="flex items-start gap-2">
                        <IconRouter className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                        <div>
                          <span className="font-medium text-foreground">{t("servers.packInstall.xnFeature1Title")}</span> — {t("servers.packInstall.xnFeature1Desc")}
                          <span className="font-mono text-primary ml-1">connect.xneon.org:PORT</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <IconShield className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                        <div>
                          <span className="font-medium text-foreground">{t("servers.packInstall.xnFeature2Title")}</span> — {t("servers.packInstall.xnFeature2Desc")}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-border bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{t("servers.packInstall.xnEnable")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("servers.packInstall.xnEnableDesc")}</p>
                      </div>
                      <button
                        onClick={() => setRelayEnabled(!relayEnabled)}
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
                      <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                        {authDone ? (
                          <p className="text-xs text-green-500 flex items-center gap-1.5">
                            <IconCheck className="w-4 h-4" strokeWidth={1.75} />
                            {t("servers.packInstall.xnAuthDone")}
                          </p>
                        ) : authing ? (
                          <div className="space-y-3">
                            <p className="text-xs text-primary/80 flex items-center gap-1.5">
                              <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                              {t("servers.packInstall.xnAuthWaiting")}
                            </p>
                            {authUrl && (
                              <div className="space-y-2">
                                <code className="block text-xs text-foreground break-all font-mono leading-relaxed">
                                  {authUrl}
                                </code>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => navigator.clipboard.writeText(authUrl)}
                                    className="flex-[1] flex items-center justify-center gap-1.5 h-8 rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <IconClipboard className="w-3.5 h-3.5" />
                                     {t("servers.packInstall.copy")}
                                  </button>
                                  <a
                                    href={authUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-[1] flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                                  >
                                    <IconExternalLink className="w-3.5 h-3.5" />
                                     {t("servers.packInstall.openBrowser")}
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-primary/80">
                              {t("servers.packInstall.xnAuthRequired")}
                            </p>
                            <button
                              onClick={handleAuthorize}
                              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                            >
                              <IconExternalLink className="w-3.5 h-3.5" />
                               {t("servers.packInstall.authorize")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="h-px bg-border" />

            {/* Navigation */}
            <div className="flex items-center justify-between px-6 py-4">
              <button
                onClick={stepIndex === 0 ? () => onOpenChange(false) : handleBack}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {stepIndex === 0 ? t("servers.packInstall.cancel") : (
                  <>
                    <IconArrowLeft className="w-4 h-4" />
                    {t("servers.packInstall.back")}
                  </>
                )}
              </button>

              {stepIndex < STEPS.length - 1 ? (
                <button
                  onClick={handleNext}
                  disabled={!canNext()}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all",
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                    "shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100"
                  )}
                >
                   {t("servers.packInstall.next")}
                </button>
              ) : (
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all",
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                    "shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100"
                  )}
                >
                  {installing ? (
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  ) : (
                    <IconServer className="w-4 h-4" />
                  )}
                   {installing ? t("servers.packInstall.installing") : t("servers.packInstall.install")}
                </button>
              )}
            </div>
          </>
      </DialogContent>
    </Dialog>
  )
}
