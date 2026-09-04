import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { IconPlayerPlay, IconServer, IconArrowLeft, IconCheck, IconFolderPlus, IconLoader2, IconWorld, IconShield, IconRouter, IconUpload, IconClipboard, IconExternalLink } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { cn } from "@/lib/utils"
import { useHomeVersions } from "@/src/hooks/use-home-versions"
import { useLoaderVersionOptions } from "@/src/hooks/use-loader-version-options"
import { LoaderIcon } from "./instance/loader-icon"
import type { JavaInstallation } from "./settings/types"

interface ServerCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (params: { name: string; gameVersion: string; modloader: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string }) => Promise<unknown>
}

const MODLOADERS = [
  { id: "vanilla", label: "Vanilla", desc: "Чистый Minecraft без модов" },
  { id: "forge", label: "Forge", desc: "Самый популярный загрузчик модов" },
  { id: "fabric", label: "Fabric", desc: "Лёгкий и быстрый загрузчик" },
  { id: "quilt", label: "Quilt", desc: "Форк Fabric с дополнениями" },
  { id: "neoforge", label: "NeoForge", desc: "Новое поколение Forge" },
  { id: "paper", label: "Paper", desc: "Высокопроизводительный сервер" },
  { id: "spigot", label: "Spigot", desc: "Оптимизированный Bukkit-сервер" },
  { id: "bukkit", label: "Bukkit", desc: "Классический API сервера" },
  { id: "purpur", label: "Purpur", desc: "Форк Paper с настройками" },
  { id: "folia", label: "Folia", desc: "Многопоточный Paper" },
  { id: "sponge", label: "Sponge", desc: "Альтернативный API сервера" },
  { id: "bungeecord", label: "BungeeCord", desc: "Прокси-сервер" },
  { id: "velocity", label: "Velocity", desc: "Современное прокси" },
  { id: "waterfall", label: "Waterfall", desc: "Форк BungeeCord" },
]

const STEPS_FULL = ["name", "modloader", "version", "port", "settings", "java", "connect"] as const
const STEPS_CUSTOM = ["name", "modloader", "port", "settings", "java", "connect"] as const
type Step = (typeof STEPS_FULL)[number] | (typeof STEPS_CUSTOM)[number]

const STEP_LABELS: Record<(typeof STEPS_FULL)[number], string> = {
  name: "Название",
  modloader: "Загрузчик",
  version: "Версия",
  port: "Порт",
  settings: "Настройки",
  java: "Java",
  connect: "Сеть",
}

export function ServerCreateDialog({ open, onOpenChange, onCreate }: ServerCreateDialogProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("name")
  const [name, setName] = useState("")
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
  const [onlineMode, setOnlineMode] = useState(true)
  const [maxPlayers, setMaxPlayers] = useState(20)
  const [customJarPath, setCustomJarPath] = useState("")
  const customJarInputRef = useRef<HTMLInputElement>(null)
  const [analyzingJar, setAnalyzingJar] = useState(false)
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null)
  const [detectedLoader, setDetectedLoader] = useState<string | null>(null)
  const [jarError, setJarError] = useState<string | null>(null)

  const { maxMb, snapPoints } = useMemoryOptions()

  const { versions, versionsLoaded, selectedVersion, setSelectedVersion } = useHomeVersions(modloader)
  const { loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion } = useLoaderVersionOptions(modloader, selectedVersion)
  const requiresLoaderVersion = !["vanilla", "spigot", "bukkit", "sponge", "bungeecord"].includes(modloader)

  const steps = customJarPath ? STEPS_CUSTOM : STEPS_FULL

  useEffect(() => {
    if (!open) return
    setStep("name")
    setName("")
    setModloader("vanilla")
    setModloaderVersion("")
    setPort("25565")
    setJavaPath("auto")
    setCreating(false)
    setRelayEnabled(false)
    setXmx(2048)
    setXms(1024)
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
    setModloaderVersion(recommendedLoaderVersion ?? "")
  }, [loaderVersions, loaderVersionsLoaded, modloaderVersion, recommendedLoaderVersion, requiresLoaderVersion])

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
          setJarError("Не удалось определить версию Minecraft из JAR. Выберите загрузчик без своего JAR.")
          return
        }
        setSelectedVersion(info.minecraftVersion)
        setDetectedVersion(info.minecraftVersion)
        setDetectedLoader(info.loaderLabel ?? null)
        if (info.loaderId && MODLOADERS.some(m => m.id === info.loaderId)) {
          setModloader(info.loaderId)
        }
      } catch (e: any) {
        setJarError(e?.message ?? "Ошибка анализа JAR")
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
      await onCreate({
        name: name.trim(),
        gameVersion: selectedVersion,
        modloader,
        modloaderVersion: modloaderVersion || undefined,
        port: parseInt(port) || 25565,
        javaPath: javaPath && javaPath !== "auto" ? javaPath : undefined,
        relayEnabled,
        xmx,
        xms,
        onlineMode,
        maxPlayers,
        customJarPath: customJarPath || undefined,
      })
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }

  const loaderName = modloader === "neoforge" ? "NeoForge"
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
                {STEP_LABELS[s as (typeof STEPS_FULL)[number]]}
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
                <h3 className="text-sm font-semibold text-foreground mb-1">Как назовём сервер?</h3>
                <p className="text-xs text-muted-foreground">Придумай название, чтобы потом легко найти</p>
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
                <h3 className="text-sm font-semibold text-foreground mb-1">Выбери загрузчик</h3>
                <p className="text-xs text-muted-foreground">Определяет какие моды будут доступны</p>
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
                      <p className="text-[11px] text-muted-foreground truncate">{loader.desc}</p>
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
                <label className="text-xs font-medium text-muted-foreground">Свой JAR (опционально)</label>
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
                        <p className="text-[11px] text-primary mt-0.5">JAR выбран — заменит скачивание</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground">Mohist, Magma и др.</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Загрузить свой JAR вместо скачивания</p>
                      </>
                    )}
                  </div>
                  {customJarPath && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCustomJarPath("") }}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      Убрать
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
                <h3 className="text-sm font-semibold text-foreground mb-1">Выбери версию</h3>
                <p className="text-xs text-muted-foreground">
                  {modloader === "velocity" ? "Версия прокси" : "Версия Minecraft и загрузчика"}
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {modloader === "velocity" ? "Velocity version" : "Minecraft"}
                  </label>
                  <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                    <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground text-sm">
                      <SelectValue placeholder={versionsLoaded ? "Выбери версию" : "Загрузка..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {!versionsLoaded ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                      ) : versions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No versions</div>
                      ) : (
                        versions.map(v => (
                          <SelectItem key={v} value={v}>{v}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {requiresLoaderVersion && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">{loaderName} version</label>
                    <Select
                      value={modloaderVersion}
                      onValueChange={setModloaderVersion}
                      disabled={!loaderVersionsLoaded || loaderVersions.length === 0}
                    >
                      <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground text-sm">
                        <SelectValue placeholder={loaderVersionsLoaded ? "Выбери версию" : "Загрузка..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {!loaderVersionsLoaded ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                        ) : loaderVersions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No versions</div>
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
                    <p className="text-xs text-muted-foreground">Версия определена из JAR</p>
                    <p className="text-sm font-semibold text-foreground truncate">
                      Minecraft {detectedVersion}{detectedLoader ? ` · ${detectedLoader}` : ""}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Порт сервера</h3>
                <p className="text-xs text-muted-foreground">Стандартный порт — 25565</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Порт</label>
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
                <h3 className="text-sm font-semibold text-foreground mb-1">Настройки</h3>
                <p className="text-xs text-muted-foreground">ОЗУ, макс. игроков, online mode</p>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
                <label className="block text-sm font-medium text-foreground">Выделено памяти (макс. ОЗУ)</label>
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
                <label className="block text-sm font-medium text-foreground">Начальная память (Xms)</label>
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
                  <label className="text-xs font-medium text-muted-foreground">Макс. игроков</label>
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
                  <label className="text-xs font-medium text-muted-foreground">Пиратка</label>
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
                    <span className="text-sm text-foreground">{!onlineMode ? "Вкл" : "Выкл"}</span>
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
            </div>
          )}

          {step === "java" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Java для сервера</h3>
                <p className="text-xs text-muted-foreground">Выбери Java или оставь глобальную настройку</p>
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
                    <div className="font-medium text-foreground">Автоматически</div>
                    <span className={cn(
                      "text-xs px-2 py-1 rounded-md font-medium",
                      javaPath === "auto" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                    )}>
                      {javaPath === "auto" ? "Выбрана" : "Выбрать"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Скачать при первой установке Minecraft</div>
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
                      <div className="font-medium text-foreground text-sm">Глобальная Java</div>
                      <span className={cn(
                        "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                        javaPath === "" ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                      )}>
                        {javaPath === "" ? "Выбрана" : "Выбрать"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">{globalJavaPath}</div>
                  </button>
                )}

                {loadingJava ? (
                  <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                    <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                    <span className="text-sm text-muted-foreground">Поиск Java...</span>
                  </div>
                ) : detectedJava.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground px-1">Обнаруженные установки</div>
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
                              {javaPath === java.path ? "Выбрана" : "Выбрать"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                          {(java.arch || java.vendor || java.fullVersion) && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {java.arch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{java.arch}-бит</span>}
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
                    <span className="text-sm">Выбрать файл вручную</span>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">Обзор</span>
                </button>
              </div>
            </div>
          )}

          {step === "connect" && (
            <div className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Доступ к серверу</h3>
                <p className="text-xs text-muted-foreground">Настрой публичный доступ через XN-Connect</p>
              </div>

              <div className="p-4 rounded-xl border border-border bg-gradient-to-br from-primary/5 via-primary/[0.02] to-accent/5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <IconWorld className="w-5 h-5 text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">XN-Connect</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Бесплатный туннель для Minecraft</p>
                  </div>
                </div>

                <div className="space-y-2.5 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <IconRouter className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                    <div>
                      <span className="font-medium text-foreground">Доступ без порта forwarding</span> — твои друзья смогут зайти по адресу
                      <span className="font-mono text-primary ml-1">connect.xneon.org:PORT</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <IconShield className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                    <div>
                      <span className="font-medium text-foreground">Без настройки роутера</span> — не нужно открывать порты или настраивать порт forwarding
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Включить XN-Connect</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Создать туннель при запуске сервера</p>
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
                        Вы авторизованы в XN-Connect
                      </p>
                    ) : authing ? (
                      <div className="space-y-3">
                        <p className="text-xs text-primary/80 flex items-center gap-1.5">
                          <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                          Ожидание подтверждения в браузере...
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
                                Копировать
                              </button>
                              <a
                                href={authUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-[1] flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                              >
                                <IconExternalLink className="w-3.5 h-3.5" />
                                Открыть в браузере
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-primary/80">
                          Для доступа друзей нужно войти в Xneon Account.
                        </p>
                        <button
                          onClick={handleAuthorize}
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                        >
                          <IconExternalLink className="w-3.5 h-3.5" />
                          Авторизоваться
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
              stepIndex === 0
                ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {stepIndex === 0 ? t("servers.cancel") : (
              <>
                <IconArrowLeft className="w-4 h-4" />
                Назад
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
                  Анализ JAR...
                </>
              ) : (
                "Далее"
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
    </Dialog>
  )
}
