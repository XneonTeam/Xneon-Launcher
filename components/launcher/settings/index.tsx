import { SETTINGS_CONTENT_ENTER_DELAYED } from "./settings-motion"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { changeLanguage } from "@/src/i18n"
import { cn } from "@/lib/utils"
import { IconCpu, IconDeviceDesktop, IconShield, IconCloud, IconFolder, IconPlayerPlay, IconSettings } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { settingsTabs } from "./data"
import { useThemeRegistry } from "./theme-store"
import { SettingsTabs } from "./settings-tabs"
import { SettingsResolution } from "./settings-resolution"
import { SettingsJava } from "./settings-java"
import { SettingsAuthlib } from "./settings-authlib"
import { SettingsVersions } from "./settings-versions"
import { SettingsThemes } from "./settings-themes"
import { SettingsLanguage } from "./settings-language-about"
import { SettingsAbout } from "./settings-language-about"
import { SettingsUpdate } from "./settings-update"
import { SettingsAi } from "./settings-ai"
import { SettingsStorage } from "./settings-storage"
import { RamAllocation } from "@/components/launcher/ram-allocation"
import type { SettingsTab, JavaInstallation } from "./types"

export function SettingsPage({ initialTab = "game" }: { initialTab?: SettingsTab } = {}) {
  const { t } = useTranslation()
  const settingsHydratedRef = useRef(false)
  const pendingSettingsRef = useRef<Record<string, { timeoutId: number; value: string }>>({})
  const lastPersistedSettingsRef = useRef<Record<string, string>>({})
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(initialTab)
  useEffect(() => { setActiveSettingsTab(initialTab) }, [initialTab])
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
  const [afterLaunch, setAfterLaunch] = useState<"nothing" | "minimize" | "close">("nothing")
  const [autoGameLanguage, setAutoGameLanguage] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("language") : null
    return stored || "ru"
  })
  const [instancesRoot, setInstancesRoot] = useState("")

  /**
   * Тема — из общего реестра: он сам применяет выбранную тему, пишет выбор в
   * localStorage и БД и подхватывает изменения из main, поэтому локального
   * состояния и эффектов применения здесь больше нет.
   */
  const registry = useThemeRegistry()

  useEffect(() => {
    changeLanguage(selectedLanguage)
    localStorage.setItem("language", selectedLanguage)
    // Дублируем в БД, чтобы агент (get_settings) видел реальный язык, а не
    // устаревшее значение — иначе он отвечает не на том языке.
    window.electronAPI?.setSetting("language", selectedLanguage)
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
        afterLaunchSetting,
        autoGameLanguageSetting,
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
        api.getSetting("afterLaunch"),
        api.getSetting("autoGameLanguage"),
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
      if (afterLaunchSetting === "minimize" || afterLaunchSetting === "close") setAfterLaunch(afterLaunchSetting)
      setAutoGameLanguage(autoGameLanguageSetting === "true")
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
        autoGameLanguage: String(autoGameLanguageSetting === "true"),
      }
      try {
        const root = await api.getInstancesRoot()
        if (!cancelled) setInstancesRoot(root ?? "")
      } catch {}
      settingsHydratedRef.current = true
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [])

  /** Единственная точка фактической записи настройки: обновляет снапшот и шлёт событие. */
  const flushSetting = useCallback((key: string, value: string) => {
    if (lastPersistedSettingsRef.current[key] === value) return
    lastPersistedSettingsRef.current[key] = value
    void window.electronAPI?.setSetting(key, value)
    window.dispatchEvent(new CustomEvent("launcher-setting-changed", { detail: { key, value } }))
  }, [])

  const persistSetting = useCallback((key: string, value: string) => {
    if (!settingsHydratedRef.current) return
    if (lastPersistedSettingsRef.current[key] === value) return
    const pending = pendingSettingsRef.current[key]
    if (pending) {
      window.clearTimeout(pending.timeoutId)
    }
    pendingSettingsRef.current[key] = {
      value,
      timeoutId: window.setTimeout(() => {
        delete pendingSettingsRef.current[key]
        flushSetting(key, value)
      }, 250),
    }
  }, [flushSetting])

  // Уходим с вкладки (или закрываем окно) — дописываем несохранённые настройки.
  // Раньше таймеры debounce просто очищались: переключатель успевал отработать
  // в интерфейсе, но в БД не попадал, и настройка откатывалась после перезахода.
  useEffect(() => {
    const flushPending = () => {
      for (const [key, pending] of Object.entries(pendingSettingsRef.current)) {
        window.clearTimeout(pending.timeoutId)
        flushSetting(key, pending.value)
      }
      pendingSettingsRef.current = {}
    }
    window.addEventListener("pagehide", flushPending)
    return () => {
      window.removeEventListener("pagehide", flushPending)
      flushPending()
    }
  }, [flushSetting])

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
  useEffect(() => { persistSetting("afterLaunch", afterLaunch) }, [afterLaunch, persistSetting])
  useEffect(() => { persistSetting("autoGameLanguage", String(autoGameLanguage)) }, [autoGameLanguage, persistSetting])

  /**
   * Список установленных Java кэшируется в main-процессе (скан реестра +
   * запуск java.exe стоят секунды). force — кнопка «Обновить» в модалке:
   * пользователь мог поставить новую Java уже после открытия настроек.
   */
  const loadJavaInstallations = useCallback(async (force = false) => {
    setLoadingJavaInstallations(true)
    try {
      const installs = await window.electronAPI?.detectJavaInstallations(force)
      setDetectedJavaInstallations(installs ?? [])
    } catch {
      setDetectedJavaInstallations([])
    } finally {
      setLoadingJavaInstallations(false)
    }
  }, [])

  useEffect(() => {
    if (!showJavaModal) return
    void loadJavaInstallations()
  }, [showJavaModal, loadJavaInstallations])

  const handlePickJavaFile = async () => {
    const picked = await window.electronAPI?.pickJavaFile()
    if (picked) {
      setSelectedJavaPath(picked)
      void window.electronAPI?.setSetting("javaPath", picked)
      setShowJavaModal(false)
    }
  }

  const handleChangeInstancesDir = async () => {
    if (!window.electronAPI) return
    const picked = await window.electronAPI.pickFolder(t("settings.buildsFolder.pickTitle"))
    if (!picked) return
    const result = await window.electronAPI.setInstancesRoot(picked)
    if (result.success && result.root) {
      setInstancesRoot(result.root)
    } else if (result.error) {
      console.warn("[Settings] Failed to change builds folder:", result.error)
    }
  }

  return (
    <div data-ui="settings-index-div-1" data-component="settings-page" id="settings-page" data-tab={activeSettingsTab} className="flex h-full min-h-0 flex-col">
      <div data-ui="settings-index-div-2" className="flex h-full min-h-0 flex-col">
        {/* Значок у заголовка — как у остальных разделов лаунчера */}
        <div data-ui="settings-index-div-3" className={`mb-4 flex items-center gap-3 ${SETTINGS_CONTENT_ENTER_DELAYED}`}>
          <div data-ui="settings-index-div-4" className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconSettings className="w-5 h-5 text-primary" />
          </div>
          <div data-ui="settings-index-div-5">
            <h2 data-ui="settings-index-h2-1" className="text-xl font-bold text-foreground">{t("settings.title")}</h2>
            <p data-ui="settings-index-p-1" className="mt-0.5 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
          </div>
        </div>

        <SettingsTabs tabs={settingsTabs} activeTab={activeSettingsTab} setActiveTab={setActiveSettingsTab} t={t} />

        {activeSettingsTab === "game" && (
          <div data-ui="settings-index-div-6" data-settings-section="game" className={`min-h-0 flex-1 space-y-8 overflow-y-auto pr-6 pb-6 ${SETTINGS_CONTENT_ENTER_DELAYED}`}>
            <section data-ui="settings-index-section-1" className="space-y-4">
              <h3 data-ui="settings-index-h3-1" className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconDeviceDesktop className="w-5 h-5 text-primary" strokeWidth={1.75} />
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

            {/* Общий блок с первоначальной настройкой: RamAllocation */}
            <RamAllocation memoryMax={memoryMax} onChange={setMemoryMax} />

            <section data-ui="settings-index-section-2" className="space-y-4">
              <h3 data-ui="settings-index-h3-2" className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconCloud className="w-5 h-5 text-primary" strokeWidth={1.5} />
                {t("settings.autoJoin.title")}
              </h3>
              <div data-ui="settings-index-div-7" className="p-4 rounded-xl border border-border bg-muted/30">
                <div data-ui="settings-index-div-8" className="flex items-center justify-between">
                  <div data-ui="settings-index-div-9" className="flex-1">
                    <div data-ui="settings-index-div-10" className="font-medium text-foreground">{t("settings.autoJoin.label")}</div>
                    <p data-ui="settings-index-p-2" className="text-sm text-muted-foreground mt-1">{t("settings.autoJoin.desc")}</p>
                  </div>
                  <button data-ui="settings-index-button-1"
                    onClick={() => setAutoJoinServer(!autoJoinServer)}
                    className={cn(
                      "relative w-14 h-8 rounded-full transition-all duration-300",
                      autoJoinServer ? "bg-primary shadow-[0_0_15px_var(--glow-primary)]" : "bg-muted"
                    )}
                  >
                    <span data-ui="settings-index-span-1" className={cn("absolute top-1 w-6 h-6 rounded-full bg-foreground shadow-md transition-all duration-300", autoJoinServer ? "left-7" : "left-1")} />
                  </button>
                </div>
                {autoJoinServer && (
                  <div data-ui="settings-index-div-11" className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div data-ui="settings-index-div-12" className="sm:col-span-2 space-y-1.5">
                      <label data-ui="settings-index-label-1" className="block text-sm font-medium text-foreground">{t("settings.autoJoin.ip")}</label>
                      <input data-ui="settings-index-input-1"
                        type="text"
                        value={serverAddress}
                        onChange={(e) => setServerAddress(e.target.value)}
                        placeholder="play.example.com"
                        className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      />
                    </div>
                    <div data-ui="settings-index-div-13" className="space-y-1.5">
                      <label data-ui="settings-index-label-2" className="block text-sm font-medium text-foreground">{t("settings.autoJoin.port")}</label>
                      <input data-ui="settings-index-input-2"
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

            <section data-ui="settings-index-section-3" className="space-y-4">
              <h3 data-ui="settings-index-h3-3" className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconPlayerPlay className="w-5 h-5 text-primary" strokeWidth={1.75} />
                {t("settings.afterLaunch.title")}
              </h3>
              <div data-ui="settings-index-div-14" className="p-4 rounded-xl border border-border bg-muted/30">
                <p data-ui="settings-index-p-3" className="text-sm text-muted-foreground mb-3">{t("settings.afterLaunch.desc")}</p>
                <Select value={afterLaunch} onValueChange={(v) => setAfterLaunch(v as "nothing" | "minimize" | "close")}>
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nothing">{t("settings.afterLaunch.nothing")}</SelectItem>
                    <SelectItem value="minimize">{t("settings.afterLaunch.minimize")}</SelectItem>
                    <SelectItem value="close">{t("settings.afterLaunch.close")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section data-ui="settings-index-section-4" className="space-y-4">
              <h3 data-ui="settings-index-h3-4" className="text-lg font-medium text-foreground flex items-center gap-2">
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

            <section data-ui="settings-index-section-5" className="space-y-4">
              <h3 data-ui="settings-index-h3-5" className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconFolder className="w-5 h-5 text-primary" strokeWidth={1.75} />
                {t("settings.buildsFolder.title")}
              </h3>
              <div data-ui="settings-index-div-15" className="p-4 rounded-xl border border-border bg-muted/30">
                <p data-ui="settings-index-p-4" className="text-sm text-muted-foreground mb-3">{t("settings.buildsFolder.desc")}</p>
                <div data-ui="settings-index-div-16" className="flex items-center gap-3">
                  <code data-ui="settings-index-code-1" className="flex-1 truncate rounded-lg bg-background/60 border border-border px-3 py-2 text-xs text-muted-foreground">{instancesRoot || t("settings.buildsFolder.loading")}</code>
                  <button data-ui="settings-index-button-2" type="button" onClick={() => void handleChangeInstancesDir()} className="px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
                    {t("settings.buildsFolder.change")}
                  </button>
                </div>
              </div>
            </section>

            <section data-ui="settings-index-section-6" className="space-y-4">
              <h3 data-ui="settings-index-h3-6" className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconShield className="w-5 h-5 text-primary" strokeWidth={1.75} />
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

            <section data-ui="settings-index-section-7" className="space-y-4">
              <h3 data-ui="settings-index-h3-7" className="text-lg font-medium text-foreground flex items-center gap-2">
                <IconCloud className="w-5 h-5 text-primary" strokeWidth={1.75} />
                BMCL API
              </h3>
              <div data-ui="settings-index-div-17" className="p-4 rounded-xl border border-border bg-muted/30">
                <div data-ui="settings-index-div-18" className="flex items-center justify-between">
                  <div data-ui="settings-index-div-19" className="flex-1">
                    <div data-ui="settings-index-div-20" className="font-medium text-foreground">BMCL API</div>
                    <p data-ui="settings-index-p-5" className="text-sm text-muted-foreground mt-1">{t("settings.bmclapiDesc")}</p>
                  </div>
                  <button data-ui="settings-index-button-3"
                    onClick={() => setUseBmclapi(!useBmclapi)}
                    className={cn(
                      "relative w-14 h-8 rounded-full transition-all duration-300",
                      useBmclapi ? "bg-primary shadow-[0_0_15px_var(--glow-primary)]" : "bg-muted"
                    )}
                  >
                    <span data-ui="settings-index-span-2" className={cn("absolute top-1 w-6 h-6 rounded-full bg-foreground shadow-md transition-all duration-300", useBmclapi ? "left-7" : "left-1")} />
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeSettingsTab === "java" && (
          <div data-ui="settings-index-div-21" data-settings-section="java" className="min-h-0 flex-1 overflow-y-auto pr-6 pb-2">
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
              onRefreshJava={() => void loadJavaInstallations(true)}
            />
          </div>
        )}

        {activeSettingsTab === "themes" && (
          <div data-ui="settings-index-div-22" data-settings-section="themes" className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsThemes registry={registry} />
          </div>
        )}

        {activeSettingsTab === "language" && (
          <div data-ui="settings-index-div-23" data-settings-section="language" className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsLanguage
              selectedLanguage={selectedLanguage}
              setSelectedLanguage={setSelectedLanguage}
              autoGameLanguage={autoGameLanguage}
              setAutoGameLanguage={setAutoGameLanguage}
              t={t}
            />
          </div>
        )}

        {activeSettingsTab === "ai" && (
          <div data-ui="settings-index-div-24" data-settings-section="ai" className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsAi />
          </div>
        )}

        {activeSettingsTab === "storage" && (
          <div data-ui="settings-index-div-25" data-settings-section="storage" className="min-h-0 flex-1 overflow-y-auto pr-6">
            <SettingsStorage />
          </div>
        )}

        {activeSettingsTab === "about" && (
          <div data-ui="settings-index-div-26" data-settings-section="about" className={`min-h-0 flex-1 overflow-y-auto pr-6 space-y-8 ${SETTINGS_CONTENT_ENTER_DELAYED}`}>
            <SettingsAbout t={t} />
            <SettingsUpdate />
          </div>
        )}
      </div>
    </div>
  )
}
