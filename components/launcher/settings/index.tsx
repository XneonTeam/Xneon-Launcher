import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { changeLanguage } from "@/src/i18n"
import { cn } from "@/lib/utils"
import { IconCpu, IconDeviceDesktop, IconShield, IconCloud } from "@tabler/icons-react"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { memoryToMb, mbToMemory } from "@/lib/memory"
import { settingsTabs, presetThemes, applyTheme } from "./data"
import { SettingsTabs } from "./settings-tabs"
import { SettingsResolution } from "./settings-resolution"
import { SettingsJava } from "./settings-java"
import { SettingsAuthlib } from "./settings-authlib"
import { SettingsVersions } from "./settings-versions"
import { SettingsThemes } from "./settings-themes"
import { SettingsLanguage } from "./settings-language-about"
import { SettingsAbout } from "./settings-language-about"
import type { SettingsTab, JavaInstallation } from "./types"

export function SettingsPage() {
  const { t } = useTranslation()
  const { maxMb, snapPoints } = useMemoryOptions()
  const settingsHydratedRef = useRef(false)
  const pendingSettingsRef = useRef<Record<string, number>>({})
  const lastPersistedSettingsRef = useRef<Record<string, string>>({})
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("game")
  const [selectedTheme, setSelectedTheme] = useState<string>("orange")
  const [selectedResolution, setSelectedResolution] = useState("1920x1080 (Full HD)")
  const [customWidth, setCustomWidth] = useState("1920")
  const [customHeight, setCustomHeight] = useState("1080")
  const [useCustomResolution, setUseCustomResolution] = useState(false)
  const [selectedJavaPath, setSelectedJavaPath] = useState("")
  const [javaArgs, setJavaArgs] = useState("")
  const [memoryMin, setMemoryMin] = useState("512M")
  const [memoryMax, setMemoryMax] = useState("4G")
  const [showJavaModal, setShowJavaModal] = useState(false)
  const [editingJavaVersion, setEditingJavaVersion] = useState("")
  const [detectedJavaInstallations, setDetectedJavaInstallations] = useState<JavaInstallation[]>([])
  const [loadingJavaInstallations, setLoadingJavaInstallations] = useState(false)
  const [showAlpha, setShowAlpha] = useState(false)
  const [showBeta, setShowBeta] = useState(false)
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [useBmclapi, setUseBmclapi] = useState(false)
  const [authlibInjectorEnabled, setAuthlibInjectorEnabled] = useState(false)
  const [injectorType, setInjectorType] = useState<"authlib" | "retroauth">("retroauth")
  const [showAuthlibWarningModal, setShowAuthlibWarningModal] = useState(false)
  const [autoJoinServer, setAutoJoinServer] = useState(false)
  const [serverAddress, setServerAddress] = useState("")
  const [serverPort, setServerPort] = useState("25565")
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("language") : null
    return stored || "ru"
  })

  useEffect(() => {
    const stored = localStorage.getItem("theme")
    const id = stored || "orange"
    const theme = presetThemes.find(t => t.id === id)
    if (theme) { setSelectedTheme(id); applyTheme(theme) }
  }, [])

  useEffect(() => {
    const theme = presetThemes.find(t => t.id === selectedTheme)
    if (theme) applyTheme(theme)
  }, [selectedTheme])

  useEffect(() => {
    changeLanguage(selectedLanguage)
    localStorage.setItem("language", selectedLanguage)
  }, [selectedLanguage])

  useEffect(() => {
    let cancelled = false

    const loadSettings = async () => {
      const api = window.electronAPI
      if (!api) {
        settingsHydratedRef.current = true
        return
      }

      const [
        authlibSetting,
        retroauthSetting,
        javaPathSetting,
        javaArgsSetting,
        memoryMinSetting,
        memoryMaxSetting,
        showAlphaSetting,
        showBetaSetting,
        showSnapshotSetting,
        selectedResolutionSetting,
        customWidthSetting,
        customHeightSetting,
        useCustomResolutionSetting,
        useBmclapiSetting,
        autoJoinServerSetting,
        serverSetting,
        serverPortSetting,
      ] = await Promise.all([
        api.getSetting("authlibInjectorEnabled"),
        api.getSetting("retroauthInjectorEnabled"),
        api.getSetting("javaPath"),
        api.getSetting("javaArgs"),
        api.getSetting("memoryMin"),
        api.getSetting("memoryMax"),
        api.getSetting("showAlpha"),
        api.getSetting("showBeta"),
        api.getSetting("showSnapshot"),
        api.getSetting("selectedResolution"),
        api.getSetting("customWidth"),
        api.getSetting("customHeight"),
        api.getSetting("useCustomResolution"),
        api.getSetting("useBmclapi"),
        api.getSetting("autoJoinServer"),
        api.getSetting("server"),
        api.getSetting("serverPort"),
      ])

      if (cancelled) return

      const authlibEnabled = authlibSetting === "true"
      const retroauthEnabled = retroauthSetting === "true"
      setAuthlibInjectorEnabled(authlibEnabled || retroauthEnabled)
      setInjectorType(authlibEnabled ? "authlib" : "retroauth")
      if (javaPathSetting) {
        const base = javaPathSetting.split(/[\\/]/).pop()?.toLowerCase() ?? ""
        const valid = base === "java" || base === "java.exe" || base === "javaw.exe"
        if (!valid) {
          void api.setSetting("javaPath", "")
        } else {
          setSelectedJavaPath(javaPathSetting)
        }
      }
      setJavaArgs(javaArgsSetting ?? "")
      if (memoryMinSetting) setMemoryMin(memoryMinSetting)
      if (memoryMaxSetting) setMemoryMax(memoryMaxSetting)
      setShowAlpha(showAlphaSetting === "true")
      setShowBeta(showBetaSetting === "true")
      setShowSnapshot(showSnapshotSetting === "true")
      setUseBmclapi(useBmclapiSetting === "true")
      setAutoJoinServer(autoJoinServerSetting === "true")
      if (serverSetting) setServerAddress(serverSetting)
      if (serverPortSetting) setServerPort(serverPortSetting)
      if (selectedResolutionSetting) setSelectedResolution(selectedResolutionSetting)
      if (customWidthSetting) setCustomWidth(customWidthSetting)
      if (customHeightSetting) setCustomHeight(customHeightSetting)
      setUseCustomResolution(useCustomResolutionSetting === "true")
      lastPersistedSettingsRef.current = {
        javaArgs: javaArgsSetting ?? "",
        memoryMin: memoryMinSetting ?? "512M",
        memoryMax: memoryMaxSetting ?? "4G",
        showAlpha: String(showAlphaSetting === "true"),
        showBeta: String(showBetaSetting === "true"),
        showSnapshot: String(showSnapshotSetting === "true"),
        useBmclapi: String(useBmclapiSetting === "true"),
        selectedResolution: selectedResolutionSetting ?? "1920x1080 (Full HD)",
        customWidth: customWidthSetting ?? "1920",
        customHeight: customHeightSetting ?? "1080",
        useCustomResolution: String(useCustomResolutionSetting === "true"),
      }
      settingsHydratedRef.current = true
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [])

  const persistSetting = useCallback((key: string, value: string) => {
    if (!settingsHydratedRef.current) return
    if (lastPersistedSettingsRef.current[key] === value) return
    if (pendingSettingsRef.current[key]) {
      window.clearTimeout(pendingSettingsRef.current[key])
    }
    pendingSettingsRef.current[key] = window.setTimeout(() => {
      delete pendingSettingsRef.current[key]
      if (lastPersistedSettingsRef.current[key] === value) return
      lastPersistedSettingsRef.current[key] = value
      void window.electronAPI?.setSetting(key, value)
      window.dispatchEvent(new CustomEvent("launcher-setting-changed", { detail: { key, value } }))
    }, 250)
  }, [])

  useEffect(() => () => {
    Object.values(pendingSettingsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
    pendingSettingsRef.current = {}
  }, [])

  useEffect(() => {
    persistSetting("javaArgs", javaArgs)
  }, [javaArgs, persistSetting])
  useEffect(() => { persistSetting("memoryMin", memoryMin.trim() || "512M") }, [memoryMin, persistSetting])
  useEffect(() => { persistSetting("memoryMax", memoryMax.trim() || "4G") }, [memoryMax, persistSetting])

  useEffect(() => { persistSetting("showAlpha", String(showAlpha)) }, [persistSetting, showAlpha])
  useEffect(() => { persistSetting("showBeta", String(showBeta)) }, [persistSetting, showBeta])
  useEffect(() => { persistSetting("showSnapshot", String(showSnapshot)) }, [persistSetting, showSnapshot])
  useEffect(() => { persistSetting("useBmclapi", String(useBmclapi)) }, [persistSetting, useBmclapi])
  useEffect(() => { persistSetting("autoJoinServer", String(autoJoinServer)) }, [autoJoinServer, persistSetting])
  useEffect(() => { if (serverAddress) persistSetting("server", serverAddress) }, [serverAddress, persistSetting])
  useEffect(() => { persistSetting("serverPort", serverPort.trim() || "25565") }, [serverPort, persistSetting])
  useEffect(() => { persistSetting("selectedResolution", selectedResolution) }, [persistSetting, selectedResolution])
  useEffect(() => { persistSetting("customWidth", customWidth) }, [customWidth, persistSetting])
  useEffect(() => { persistSetting("customHeight", customHeight) }, [customHeight, persistSetting])
  useEffect(() => { persistSetting("useCustomResolution", String(useCustomResolution)) }, [persistSetting, useCustomResolution])

  useEffect(() => {
    if (!showJavaModal) return
    setLoadingJavaInstallations(true)
    void window.electronAPI?.detectJavaInstallations().then(installs => {
      setDetectedJavaInstallations(installs ?? [])
      setLoadingJavaInstallations(false)
    }).catch(() => {
      setDetectedJavaInstallations([])
      setLoadingJavaInstallations(false)
    })
  }, [showJavaModal])

  const handlePickJavaFile = async () => {
    const picked = await window.electronAPI?.pickJavaFile()
    if (picked) {
      setSelectedJavaPath(picked)
      void window.electronAPI?.setSetting("javaPath", picked)
      setShowJavaModal(false)
    }
  }

  return (
    <div className="relative h-[calc(100vh-5rem)] overflow-hidden rounded-2xl bg-card border border-border transition-all duration-300 animate-in fade-in-0 slide-in-from-bottom-4">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

      <div className="relative z-10 p-6 h-full flex flex-col">
        <h2 className="text-xl font-semibold text-foreground mb-4">{t("settings.title")}</h2>

        <SettingsTabs tabs={settingsTabs} activeTab={activeSettingsTab} setActiveTab={setActiveSettingsTab} t={t} />

        {activeSettingsTab === "game" && (
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-6 animate-in fade-in-0 slide-in-from-left-4 duration-300">
            <section className="space-y-4">
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconDeviceDesktop className="w-5 h-5 text-primary" strokeWidth={1.5} />
                {t("settings.resolution")}
              </h3>
              <SettingsResolution
                selectedResolution={selectedResolution}
                setSelectedResolution={setSelectedResolution}
                useCustomResolution={useCustomResolution}
                setUseCustomResolution={setUseCustomResolution}
                customWidth={customWidth}
                setCustomWidth={setCustomWidth}
                customHeight={customHeight}
                setCustomHeight={setCustomHeight}
              />
            </section>

            <section className="space-y-4">
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconCpu className="w-5 h-5 text-primary" strokeWidth={1.5} />
                {t("settings.ram")}
              </h3>
              <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
                <label className="block text-sm font-medium text-foreground">{t("settings.ram.allocated")}</label>
                <MemorySlider
                  value={memoryToMb(memoryMax)}
                  min={512}
                  max={maxMb}
                  step={64}
                  snapPoints={snapPoints}
                  snapRange={512}
                  unit="MB"
                  onChange={(v) => setMemoryMax(mbToMemory(v))}
                />
                <p className="text-xs text-muted-foreground">{t("settings.ram.desc")}</p>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconCloud className="w-5 h-5 text-primary" strokeWidth={1.5} />
                Автоподключение к серверу
              </h3>
              <div className="p-4 rounded-xl border border-border bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-foreground">Автоподключение</div>
                    <p className="text-sm text-muted-foreground mt-1">При запуске Minecraft автоматически подключится к указанному серверу.</p>
                  </div>
                  <button
                    onClick={() => setAutoJoinServer(!autoJoinServer)}
                    className={cn(
                      "relative w-14 h-8 rounded-full transition-all duration-300",
                      autoJoinServer ? "bg-primary shadow-[0_0_15px_var(--glow-primary)]" : "bg-muted"
                    )}
                  >
                    <span className={cn("absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300", autoJoinServer ? "left-7" : "left-1")} />
                  </button>
                </div>
                {autoJoinServer && (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="block text-sm font-medium text-foreground">IP адрес</label>
                      <input
                        type="text"
                        value={serverAddress}
                        onChange={(e) => setServerAddress(e.target.value)}
                        placeholder="play.example.com"
                        className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-foreground">Порт</label>
                      <input
                        type="text"
                        value={serverPort}
                        onChange={(e) => setServerPort(e.target.value)}
                        placeholder="25565"
                        className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                {t("settings.versionTypes")}
              </h3>
              <SettingsVersions
                showAlpha={showAlpha}
                setShowAlpha={setShowAlpha}
                showBeta={showBeta}
                setShowBeta={setShowBeta}
                showSnapshot={showSnapshot}
                setShowSnapshot={setShowSnapshot}
              />
            </section>

            <section className="space-y-4">
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconShield className="w-5 h-5 text-primary" strokeWidth={1.5} />
                {t("settings.authlib")}
              </h3>
              <SettingsAuthlib
                enabled={authlibInjectorEnabled}
                setEnabled={setAuthlibInjectorEnabled}
                injectorType={injectorType}
                setInjectorType={setInjectorType}
                showWarningModal={showAuthlibWarningModal}
                setShowWarningModal={setShowAuthlibWarningModal}
              />
            </section>

            <section className="space-y-4">
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconCloud className="w-5 h-5 text-primary" strokeWidth={1.5} />
                BMCL API
              </h3>
              <div className="p-4 rounded-xl border border-border bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-foreground">BMCL API</div>
                    <p className="text-sm text-muted-foreground mt-1">{t("settings.bmclapiDesc")}</p>
                  </div>
                  <button
                    onClick={() => setUseBmclapi(!useBmclapi)}
                    className={cn(
                      "relative w-14 h-8 rounded-full transition-all duration-300",
                      useBmclapi ? "bg-primary shadow-[0_0_15px_var(--glow-primary)]" : "bg-muted"
                    )}
                  >
                    <span className={cn("absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300", useBmclapi ? "left-7" : "left-1")} />
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeSettingsTab === "java" && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-6 pb-2 animate-in fade-in-0 slide-in-from-left-4 duration-300">
            <SettingsJava
              selectedJavaPath={selectedJavaPath}
              setSelectedJavaPath={setSelectedJavaPath}
              javaArgs={javaArgs}
              setJavaArgs={setJavaArgs}
              showJavaModal={showJavaModal}
              setShowJavaModal={setShowJavaModal}
              editingJavaVersion={editingJavaVersion}
              setEditingJavaVersion={setEditingJavaVersion}
              detectedJavaInstallations={detectedJavaInstallations}
              loadingJavaInstallations={loadingJavaInstallations}
              onPickJavaFile={handlePickJavaFile}
            />
          </div>
        )}

        {activeSettingsTab === "themes" && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsThemes
              selectedTheme={selectedTheme}
              setSelectedTheme={setSelectedTheme}
            />
          </div>
        )}

        {activeSettingsTab === "language" && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsLanguage selectedLanguage={selectedLanguage} setSelectedLanguage={setSelectedLanguage} t={t} />
          </div>
        )}

        {activeSettingsTab === "about" && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsAbout t={t} />
          </div>
        )}
      </div>
    </div>
  )
}
