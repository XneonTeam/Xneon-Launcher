import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { IconPlayerPlay, IconServer, IconArrowLeft, IconCheck, IconFolderPlus, IconLoader2, IconShield, IconRouter, IconUpload, IconClipboard, IconExternalLink, IconGauge, IconCamera, IconTrash } from "@tabler/icons-react"
import type { XnConnectUsage } from "@xnlc/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { cn } from "@/lib/utils"
import { useHomeVersions } from "@/src/hooks/use-home-versions"
import { useLoaderVersionOptions } from "@/src/hooks/use-loader-version-options"
import { LoaderIcon } from "./instance/loader-icon"
import { XnConnectLogo } from "./server/xn-connect-logo"
import { IconPickerModal } from "./instance/icon-picker-modal"
import { EntityIcon } from "./instance/entity-icon"
import type { JavaInstallation } from "./settings/types"

interface ServerCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (params: { name: string; gameVersion: string; modloader: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string; extraJavaArgs?: string }) => Promise<unknown>
}

const MODLOADERS = [
  { id: "vanilla", label: "Vanilla" },
  { id: "forge", label: "Forge" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "neoforge", label: "NeoForge" },
  { id: "paper", label: "Paper" },
  { id: "spigot", label: "Spigot" },
  { id: "bukkit", label: "Bukkit" },
  { id: "purpur", label: "Purpur" },
  { id: "folia", label: "Folia" },
  { id: "sponge", label: "Sponge" },
  { id: "bungeecord", label: "BungeeCord" },
  { id: "velocity", label: "Velocity" },
  { id: "waterfall", label: "Waterfall" },
]

const STEPS_FULL = ["name", "modloader", "version", "port", "settings", "java", "connect"] as const
const STEPS_CUSTOM = ["name", "modloader", "port", "settings", "java", "connect"] as const
type Step = (typeof STEPS_FULL)[number] | (typeof STEPS_CUSTOM)[number]

const STEP_KEYS: Record<(typeof STEPS_FULL)[number], string> = {
  name: "servers.create.step.name",
  modloader: "servers.create.step.modloader",
  version: "servers.create.step.version",
  port: "servers.create.step.port",
  settings: "servers.create.step.settings",
  java: "Java",
  connect: "servers.create.step.connect",
}

export function ServerCreateDialog({ open, onOpenChange, onCreate }: ServerCreateDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("name")
  const [usage, setUsage] = useState<XnConnectUsage | null>(null)
  const [usageLimitShown, setUsageLimitShown] = useState(false)
  const [name, setName] = useState("")
  const [icon, setIcon] = useState("")
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [modloader, setModloader] = useState("vanilla")
  const [modloaderVersion, setModloaderVersion] = useState("")
  const [port, setPort] = useState("25565")
  const [javaPath, setJavaPath] = useState("auto")
  const [globalJavaPath, setGlobalJavaPath] = useState("")
  const [detectedJava, setDetectedJava] = useState<JavaInstallation[]>([])
  const [loadingJava, setLoadingJava] = useState(false)
  const [creating, setCreating] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [authing, setAuthing] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [authDone, setAuthDone] = useState(false)
  const [xmx, setXmx] = useState(2048)
  const [xms, setXms] = useState(1024)
  const [extraJavaArgs, setExtraJavaArgs] = useState("")
  const [onlineMode, setOnlineMode] = useState(true)
  const [maxPlayers, setMaxPlayers] = useState(20)
  const [customJarPath, setCustomJarPath] = useState("")
  const customJarInputRef = useRef<HTMLInputElement>(null)
  const [analyzingJar, setAnalyzingJar] = useState(false)
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null)
  const [detectedLoader, setDetectedLoader] = useState<string | null>(null)
  const [jarError, setJarError] = useState<string | null>(null)

  const { maxMb, snapPoints } = useMemoryOptions()

  const [spongeType, setSpongeType] = useState<"spongevanilla" | "spongeforge" | "spongeneo">("spongevanilla")
  const effectiveLoader = modloader === "sponge" ? "sponge" : modloader
  const { versions, versionsLoaded, selectedVersion, setSelectedVersion } = useHomeVersions(effectiveLoader)
  const loaderForOptions = modloader === "sponge" ? spongeType : modloader
  const { loaderVersions, loaderVersionsLoaded, defaultLoaderVersion } = useLoaderVersionOptions(loaderForOptions, selectedVersion)
  const requiresLoaderVersion = !["vanilla", "spigot", "bukkit", "bungeecord"].includes(modloader)

  const [spongeSupported, setSpongeSupported] = useState<{
    spongevanilla: string[]
    spongeforge: string[]
    spongeneo: string[]
  }>({
    spongevanilla: [],
    spongeforge: [],
    spongeneo: [],
  })

  useEffect(() => {
    if (modloader !== "sponge") return
    let cancelled = false
    Promise.all([
      window.electronAPI?.getSpongeSupported("spongevanilla") ?? Promise.resolve([]),
      window.electronAPI?.getSpongeSupported("spongeforge") ?? Promise.resolve([]),
      window.electronAPI?.getSpongeSupported("spongeneo") ?? Promise.resolve([]),
    ]).then(([sv, sf, sn]) => {
      if (!cancelled) {
        setSpongeSupported({
          spongevanilla: sv ?? [],
          spongeforge: sf ?? [],
          spongeneo: sn ?? [],
        })
      }
    }).catch(err => console.error("Failed to load sponge supported versions", err))

    return () => {
      cancelled = true
    }
  }, [modloader])

  // Automatically switch spongeType if current is unsupported for selected Minecraft version
  useEffect(() => {
    if (modloader !== "sponge" || !selectedVersion) return
    const currentList = spongeSupported[spongeType]
    if (currentList.length > 0 && !currentList.includes(selectedVersion)) {
      const supportedTypes: ("spongevanilla" | "spongeforge" | "spongeneo")[] = ["spongevanilla", "spongeforge", "spongeneo"]
      const candidate = supportedTypes.find(t => spongeSupported[t].includes(selectedVersion))
      if (candidate) {
        setSpongeType(candidate)
        setModloaderVersion("")
      }
    }
  }, [selectedVersion, spongeSupported, spongeType, modloader])

  const steps = customJarPath ? STEPS_CUSTOM : STEPS_FULL

  const loaderDesc = (id: string) => t(`servers.types.${id}.desc`)

  useEffect(() => {
    if (!open) return
    setStep("name")
    setName("")
    setIcon("")
    setShowIconPicker(false)
    setModloader("vanilla")
    setSpongeType("spongevanilla")
    setModloaderVersion("")
    setPort("25565")
    setJavaPath("auto")
    setCreating(false)
    setRelayEnabled(false)
    setXmx(2048)
    setXms(1024)
    setExtraJavaArgs("")
    setOnlineMode(true)
    setMaxPlayers(20)
    setCustomJarPath("")
    setAnalyzingJar(false)
    setDetectedVersion(null)
    setDetectedLoader(null)
    setJarError(null)
    setAuthing(false)
    setAuthUrl(null)
    setAuthDone(false)
    window.electronAPI?.getSetting("javaPath").then(p => setGlobalJavaPath(p ?? ""))
  }, [open])

  useEffect(() => {
    if (!requiresLoaderVersion || !loaderVersionsLoaded) return
    if (loaderVersions.some(v => v.value === modloaderVersion)) return
    setModloaderVersion(defaultLoaderVersion ?? "")
  }, [loaderVersions, loaderVersionsLoaded, modloaderVersion, defaultLoaderVersion, requiresLoaderVersion])

  useEffect(() => {
    if (!open) return
    // Tunnel usage counter (used/max/plan) for the XN-Connect step
    window.electronAPI?.xnConnectUsage().then(u => { if (u) setUsage(u) })
    return window.electronAPI?.onXnConnectUsage((u) => setUsage(u))
  }, [open])

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

  const stepIndex = (steps as readonly string[]).indexOf(step)

  const canNext = () => {
    if (step === "name") return name.trim().length > 0
    if (step === "modloader") return !analyzingJar
    if (step === "version") return !!selectedVersion && (!requiresLoaderVersion || (loaderVersionsLoaded && !!modloaderVersion))
    return true
  }

  const handleNext = async () => {
    const stepsArr = steps as readonly string[]
    const next = stepsArr.indexOf(step) + 1
    if (next >= stepsArr.length) return

    // Если выбран свой JAR — пропускаем шаг «Версия» и авто-определяем версию из JAR
    if (step === "modloader" && customJarPath) {
      setAnalyzingJar(true)
      setJarError(null)
      try {
        const info = await window.electronAPI?.mcServerAnalyzeJar(customJarPath)
        if (info?.error) {
          setJarError(info.error)
          return
        }
        if (!info?.minecraftVersion) {
          setJarError(t("servers.create.jarErrorDetect"))
          return
        }
        setSelectedVersion(info.minecraftVersion)
        setDetectedVersion(info.minecraftVersion)
        setDetectedLoader(info.loaderLabel ?? null)
        if (info.loaderId && MODLOADERS.some(m => m.id === info.loaderId)) {
          setModloader(info.loaderId)
        }
      } catch (e: any) {
        setJarError(e?.message ?? t("servers.create.jarErrorAnalysis"))
        return
      } finally {
        setAnalyzingJar(false)
      }
    }

    setStep(stepsArr[next] as Step)
  }

  const handleBack = () => {
    const stepsArr = steps as readonly string[]
    const prev = stepsArr.indexOf(step) - 1
    if (prev >= 0) setStep(stepsArr[prev] as Step)
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

  const handleCreate = async () => {
    if (!name.trim() || !selectedVersion || creating) return
    setCreating(true)
    try {
      const finalLoader = modloader === "sponge" ? spongeType : modloader
      await onCreate({
        name: name.trim(),
        gameVersion: selectedVersion,
        modloader: finalLoader,
        modloaderVersion: modloaderVersion || undefined,
        port: parseInt(port) || 25565,
        javaPath: javaPath && javaPath !== "auto" ? javaPath : undefined,
        relayEnabled,
        xmx,
        xms,
        extraJavaArgs: extraJavaArgs || undefined,
        onlineMode,
        maxPlayers,
        customJarPath: customJarPath || undefined,
        icon: icon || undefined,
      })
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }

  const loaderName = modloader === "sponge" ? (spongeType === "spongevanilla" ? "SpongeVanilla" : spongeType === "spongeforge" ? "SpongeForge" : "SpongeNeo")
    : modloader === "neoforge" ? "NeoForge"
    : modloader.charAt(0).toUpperCase() + modloader.slice(1)

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
              {t("servers.addServer")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all flex-shrink-0",
                  i < stepIndex && "bg-primary text-primary-foreground",
                  i === stepIndex && "bg-primary/20 text-primary ring-2 ring-primary/30",
                  i > stepIndex && "bg-muted text-muted-foreground",
                )}>
                  {i < stepIndex ? <IconCheck className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={cn(
                    "h-0.5 flex-1 rounded-full transition-colors",
                    i < stepIndex ? "bg-primary" : "bg-muted",
                  )} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            {steps.map(s => (
              <span key={s} className={cn(
                "text-[10px] font-medium w-7 text-center",
                s === step ? "text-primary" : "text-muted-foreground",
              )}>
                {t(STEP_KEYS[s as (typeof STEPS_FULL)[number]])}
              </span>
            ))}
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Step content */}
        <div className="px-6 py-5 min-h-[280px]">
          {step === "name" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.nameTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("servers.create.nameDesc")}</p>
              </div>

              <div className="flex items-center gap-4 p-3 rounded-2xl border border-border bg-muted/20">
                <div
                  className="w-16 h-16 rounded-xl bg-muted/60 overflow-hidden border border-border cursor-pointer hover:border-primary/50 transition-colors flex-shrink-0 flex items-center justify-center relative group"
                  onClick={() => setShowIconPicker(true)}
                  title={t("servers.create.iconTitle")}
                >
                  {icon ? (
                    <EntityIcon src={icon} className="w-full h-full p-2 text-primary" imgClassName="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
                      <IconCamera className="w-6 h-6" />
                      <span className="text-[10px] mt-0.5 font-medium">{t("servers.create.iconLabel")}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowIconPicker(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {icon ? t("servers.create.iconChange") : t("servers.create.iconChoose")}
                    </button>
                    {icon && (
                      <button
                        type="button"
                        onClick={() => setIcon("")}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {t("servers.create.iconHint")}
                  </p>
                </div>
              </div>

              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t("servers.myServer")}
                className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                autoFocus
                onKeyDown={e => e.key === "Enter" && canNext() && handleNext()}
              />
            </div>
          )}

          {step === "modloader" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.modloaderTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("servers.create.modloaderDesc")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 max-h-[190px] overflow-y-auto pr-1">
                {MODLOADERS.map(loader => (
                  <button
                    key={loader.id}
                    type="button"
                    onClick={() => { setModloader(loader.id); setModloaderVersion(""); setCustomJarPath("") }}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                      modloader === loader.id
                        ? "border-primary bg-primary/10 shadow-[0_0_12px_var(--glow-primary)]"
                        : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/30"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                      modloader === loader.id ? "bg-primary/20" : "bg-muted/50",
                    )}>
                      <LoaderIcon loaderId={loader.id} className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{loader.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{loaderDesc(loader.id)}</p>
                    </div>
                    {modloader === loader.id && (
                      <div className="ml-auto w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <IconCheck className="w-3 h-3 text-primary-foreground" strokeWidth={2.5} />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Custom JAR */}
              <div className="space-y-2">
                <div className="h-px bg-border" />
                <label className="text-xs font-medium text-muted-foreground">{t("servers.create.customJar")}</label>
                <input
                  ref={customJarInputRef}
                  type="file"
                  accept=".jar"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const filePath = window.electronAPI?.getFilePath(file)
                      if (filePath) setCustomJarPath(filePath)
                    }
                    e.target.value = ""
                  }}
                />
                <button
                  type="button"
                  onClick={() => customJarInputRef.current?.click()}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                    customJarPath
                      ? "border-primary bg-primary/10"
                      : "border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5"
                  )}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                    customJarPath ? "bg-primary/20" : "bg-muted/50",
                  )}>
                    <IconUpload className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {customJarPath ? (
                      <>
                        <p className="text-sm font-medium text-foreground truncate">{customJarPath.split(/[\\/]/).pop()}</p>
                        <p className="text-[11px] text-primary mt-0.5">{t("servers.create.customJarSelected")}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground">{t("servers.create.customJarExample")}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t("servers.create.customJarDesc")}</p>
                      </>
                    )}
                  </div>
                  {customJarPath && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCustomJarPath("") }}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      {t("servers.create.remove")}
                    </button>
                  )}
                </button>
              </div>
            </div>
          )}

          {jarError && (
            <div className="mt-3 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-xs text-destructive">
              {jarError}
            </div>
          )}

          {step === "version" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.versionTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {modloader === "velocity" ? t("servers.create.versionProxy") : t("servers.create.versionDesc")}
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {modloader === "velocity" ? "Velocity version" : "Minecraft"}
                  </label>
                  <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                    <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground text-sm">
                      <SelectValue placeholder={versionsLoaded ? t("servers.create.versionPlaceholder") : t("servers.create.loading")} />
                    </SelectTrigger>
                    <SelectContent>
                      {!versionsLoaded ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">{t("servers.create.loading")}</div>
                      ) : versions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">{t("home.noLoaderVersions")}</div>
                      ) : (
                        versions.map(v => (
                          <SelectItem key={v} value={v}>{v}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {modloader === "sponge" && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">{t("servers.create.spongeType")}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "spongevanilla" as const, loaderIconId: "vanilla", label: "SpongeVanilla", desc: t("servers.create.spongevanillaDesc") },
                        { id: "spongeforge" as const, loaderIconId: "forge", label: "SpongeForge", desc: t("servers.create.spongeforgeDesc") },
                        { id: "spongeneo" as const, loaderIconId: "neoforge", label: "SpongeNeo", desc: t("servers.create.spongeneoDesc") },
                      ].map(type => {
                        const isSupported = selectedVersion
                          ? spongeSupported[type.id].length === 0 || spongeSupported[type.id].includes(selectedVersion)
                          : true

                        return (
                          <button
                            key={type.id}
                            type="button"
                            disabled={!isSupported}
                            onClick={() => {
                              if (!isSupported) return
                              setSpongeType(type.id)
                              setModloaderVersion("")
                            }}
                            className={cn(
                              "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all gap-1.5",
                              !isSupported && "opacity-40 cursor-not-allowed grayscale",
                              isSupported && spongeType === type.id
                                ? "border-primary bg-primary/15 text-primary shadow-sm"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            )}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <div className={cn(
                                "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0",
                                isSupported && spongeType === type.id ? "bg-primary/25 text-primary" : "bg-muted/60 text-muted-foreground"
                              )}>
                                <LoaderIcon loaderId={type.loaderIconId} className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-xs font-semibold truncate text-foreground">{type.label}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground leading-tight">
                              {!isSupported ? t("servers.create.notForMc") : type.desc}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {requiresLoaderVersion && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">{loaderName} version</label>
                    <Select
                      value={modloaderVersion}
                      onValueChange={setModloaderVersion}
                      disabled={!loaderVersionsLoaded || loaderVersions.length === 0}
                    >
                      <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground text-sm">
                        <SelectValue placeholder={loaderVersionsLoaded ? t("servers.create.versionPlaceholder") : t("servers.create.loading")} />
                      </SelectTrigger>
                      <SelectContent>
                        {!loaderVersionsLoaded ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">{t("servers.create.loading")}</div>
                        ) : loaderVersions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">{t("home.noLoaderVersions")}</div>
                        ) : (
                          loaderVersions.map(v => (
                            <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "port" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              {detectedVersion && (
                <div className="p-3 rounded-xl border border-primary/30 bg-primary/10 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <IconCheck className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("servers.create.portDetected")}</p>
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground truncate">
                      <span>{detectedVersion}</span>
                      {detectedLoader && (
                        <>
                          <span>·</span>
                          <LoaderIcon loaderId={detectedLoader.toLowerCase()} className="w-4 h-4 flex-shrink-0" />
                          <span className="capitalize">{detectedLoader}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.portTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("servers.create.portDesc")}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">{t("servers.create.portLabel")}</label>
                <input
                  type="number"
                  value={port}
                  onChange={e => setPort(e.target.value)}
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
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.settingsTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("servers.create.settingsDesc")}</p>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <label className="block text-xs font-medium text-foreground">{t("servers.create.memoryAllocated")}</label>
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
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <label className="block text-xs font-medium text-foreground">{t("servers.create.memoryInitial")}</label>
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
                  <label className="text-xs font-medium text-muted-foreground">{t("servers.create.maxPlayers")}</label>
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
                  <label className="text-xs font-medium text-muted-foreground">{t("servers.create.pirateMode")}</label>
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
                    <span className="text-sm text-foreground">{!onlineMode ? t("servers.create.on") : t("servers.create.off")}</span>
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
                <label className="text-xs font-medium text-muted-foreground">{t("settings.java.args")}</label>
                <input
                  type="text"
                  value={extraJavaArgs}
                  onChange={e => setExtraJavaArgs(e.target.value)}
                  placeholder={t("settings.java.argsPlaceholder")}
                  className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>
          )}

          {step === "java" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.javaTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("servers.create.javaDesc")}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">{t("servers.create.javaExecutable")}</label>
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
                    <div className="font-medium text-foreground">{t("servers.create.autoJava")}</div>
                    <span className={cn(
                      "text-xs px-2 py-1 rounded-md font-medium",
                      javaPath === "auto" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                    )}>
                      {javaPath === "auto" ? t("servers.create.selected") : t("servers.create.select")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{t("servers.create.autoJavaDesc")}</div>
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
                      <div className="font-medium text-foreground text-sm">{t("servers.create.globalJava")}</div>
                      <span className={cn(
                        "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                        javaPath === "" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                      )}>
                        {javaPath === "" ? t("servers.create.selected") : t("servers.create.select")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">{globalJavaPath}</div>
                  </button>
                )}

                {loadingJava ? (
                  <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                    <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                    <span className="text-sm text-muted-foreground">{t("servers.create.searchingJava")}</span>
                  </div>
                ) : detectedJava.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground px-1">{t("servers.create.detectedInstalls")}</div>
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
                              {javaPath === java.path ? t("servers.create.selected") : t("servers.create.select")}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                          {(java.arch || java.vendor || java.fullVersion) && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {java.arch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{java.arch}{t("servers.create.bit")}</span>}
                              {java.vendor && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{java.vendor}</span>}
                              {java.fullVersion && java.fullVersion !== java.version && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{java.fullVersion}</span>}
                            </div>
                          )}
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
                    <span className="text-sm">{t("servers.create.browseFile")}</span>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">{t("servers.create.browse")}</span>
                </button>
              </div>
            </div>
          )}

          {step === "connect" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{t("servers.create.connectTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("servers.create.connectDesc")}</p>
              </div>

              <div className="p-4 rounded-xl border border-border bg-gradient-to-br from-primary/5 via-primary/[0.02] to-accent/5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <XnConnectLogo className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-foreground">XN Connect</h4>
                      {usage && (
                        <div
                          className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                            usage.used >= usage.max
                              ? "border-red-500/30 bg-red-500/10 text-red-400"
                              : "border-border bg-muted/50 text-muted-foreground"
                          )}
                          title={t("servers.settings.xnconnect.usageHint")}
                        >
                          <IconGauge className="w-3 h-3" strokeWidth={1.75} />
                          <span className="font-mono">{usage.used}/{usage.max}</span>
                          <span>·</span>
                          <span className="capitalize">{usage.plan}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("servers.create.xnConnectDesc")}</p>
                  </div>
                </div>

                <div className="space-y-2.5 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <IconRouter className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                    <div>
                      <span className="font-medium text-foreground">{t("servers.create.xnConnectFeature1")}</span> — {t("servers.create.xnConnectFeature1Desc")}
                      <span className="font-mono text-primary ml-1">connect.xneon.org:PORT</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <IconShield className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                    <div>
                      <span className="font-medium text-foreground">{t("servers.create.xnConnectFeature2")}</span> — {t("servers.create.xnConnectFeature2Desc")}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("servers.create.enableXnConnect")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("servers.create.enableXnConnectDesc")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!relayEnabled && usage && usage.used >= usage.max) {
                        setUsageLimitShown(true)
                        return
                      }
                      setUsageLimitShown(false)
                      setRelayEnabled(!relayEnabled)
                    }}
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
                        {t("servers.create.authDone")}
                      </p>
                    ) : authing ? (
                      <div className="space-y-3">
                        <p className="text-xs text-primary/80 flex items-center gap-1.5">
                          <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                          {t("servers.create.authWaiting")}
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
                                {t("servers.create.copy")}
                              </button>
                              <a
                                href={authUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-[1] flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                              >
                                <IconExternalLink className="w-3.5 h-3.5" />
                                {t("servers.create.openBrowser")}
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-primary/80">
                          {t("servers.create.authRequired")}
                        </p>
                        <button
                          onClick={handleAuthorize}
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                        >
                          <IconExternalLink className="w-3.5 h-3.5" />
                          {t("servers.create.authorize")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {usageLimitShown && (
                  <div className="mt-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10">
                    <p className="text-xs font-medium text-red-400">
                      {t("servers.settings.xnconnect.limitReached", {
                        used: usage?.used ?? 0,
                        max: usage?.max ?? 0,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {t("servers.settings.xnconnect.limitReachedDesc")}
                    </p>
                    <div className="flex gap-2 mt-2.5">
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
              stepIndex === 0
                ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {stepIndex === 0 ? t("servers.cancel") : (
              <>
                <IconArrowLeft className="w-4 h-4" />
                {t("servers.create.back")}
              </>
            )}
          </button>

          {stepIndex < steps.length - 1 ? (
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
              {analyzingJar ? (
                <>
                  <IconLoader2 className="w-4 h-4 animate-spin" />
                  {t("servers.create.analyzing")}
                </>
              ) : (
                t("servers.create.next")
              )}
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!canNext() || creating}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "shadow-[0_0_15px_var(--glow-primary)] active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100"
              )}
            >
              {creating ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <IconPlayerPlay className="w-4 h-4" />
              )}
              {t("servers.add")}
            </button>
          )}
        </div>
      </DialogContent>

      <IconPickerModal
        open={showIconPicker}
        onOpenChange={setShowIconPicker}
        value={icon}
        onChange={(newIcon: string) => setIcon(newIcon)}
      />
    </Dialog>
  )
}
