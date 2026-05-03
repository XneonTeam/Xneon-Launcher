import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { changeLanguage } from "@/src/i18n"
import { cn } from "@/lib/utils"
import { IconDeviceDesktop, IconShield, IconCloud } from "@tabler/icons-react"
import { settingsTabs, presetThemes, applyTheme } from "./data"
import { SettingsTabs } from "./settings-tabs"
import { SettingsResolution } from "./settings-resolution"
import { SettingsJava } from "./settings-java"
import { SettingsAuthlib } from "./settings-authlib"
import { SettingsVersions } from "./settings-versions"
import { SettingsThemes } from "./settings-themes"
import { SettingsLanguage } from "./settings-language-about"
import { SettingsAbout } from "./settings-language-about"
import type { SettingsTab, Theme, JavaInstallation } from "./types"

export function SettingsPage() {
  const { t } = useTranslation()
  const settingsHydratedRef = useRef(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("game")
  const [selectedTheme, setSelectedTheme] = useState<string>("orange")
  const [customTheme, setCustomTheme] = useState<Theme>({
    id: "custom", name: "Моя тема",
    primary: "#f97316", accent: "#fbbf24", background: "#18181b",
    primaryOklch: "0.65 0.22 40", accentOklch: "0.75 0.18 75", backgroundOklch: "0.08 0.01 260",
  })
  const [useCustomTheme, setUseCustomTheme] = useState(false)
  const [selectedResolution, setSelectedResolution] = useState("1920x1080 (Full HD)")
  const [customWidth, setCustomWidth] = useState("1920")
  const [customHeight, setCustomHeight] = useState("1080")
  const [useCustomResolution, setUseCustomResolution] = useState(false)
  const [selectedJavaPath, setSelectedJavaPath] = useState("")
  const [javaArgs, setJavaArgs] = useState("")
  const [showJavaModal, setShowJavaModal] = useState(false)
  const [editingJavaVersion, setEditingJavaVersion] = useState("")
  const [detectedJavaInstallations, setDetectedJavaInstallations] = useState<JavaInstallation[]>([])
  const [loadingJavaInstallations, setLoadingJavaInstallations] = useState(false)
  const [showAlpha, setShowAlpha] = useState(false)
  const [showBeta, setShowBeta] = useState(false)
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [authlibInjectorEnabled, setAuthlibInjectorEnabled] = useState(true)
  const [showAuthlibWarningModal, setShowAuthlibWarningModal] = useState(false)
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
    if (theme && !useCustomTheme) applyTheme(theme)
  }, [selectedTheme, useCustomTheme])

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
        javaPathSetting,
        javaArgsSetting,
        showAlphaSetting,
        showBetaSetting,
        showSnapshotSetting,
        selectedResolutionSetting,
        customWidthSetting,
        customHeightSetting,
        useCustomResolutionSetting,
      ] = await Promise.all([
        api.getSetting("authlibInjectorEnabled"),
        api.getSetting("javaPath"),
        api.getSetting("javaArgs"),
        api.getSetting("showAlpha"),
        api.getSetting("showBeta"),
        api.getSetting("showSnapshot"),
        api.getSetting("selectedResolution"),
        api.getSetting("customWidth"),
        api.getSetting("customHeight"),
        api.getSetting("useCustomResolution"),
      ])

      if (cancelled) return

      if (authlibSetting !== undefined) setAuthlibInjectorEnabled(authlibSetting !== "false")
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
      setShowAlpha(showAlphaSetting === "true")
      setShowBeta(showBetaSetting === "true")
      setShowSnapshot(showSnapshotSetting === "true")
      if (selectedResolutionSetting) setSelectedResolution(selectedResolutionSetting)
      if (customWidthSetting) setCustomWidth(customWidthSetting)
      if (customHeightSetting) setCustomHeight(customHeightSetting)
      setUseCustomResolution(useCustomResolutionSetting === "true")
      settingsHydratedRef.current = true
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [])

  const persistSetting = useCallback((key: string, value: string) => {
    if (!settingsHydratedRef.current) return
    void window.electronAPI?.setSetting(key, value)
    window.dispatchEvent(new CustomEvent("launcher-setting-changed", { detail: { key, value } }))
  }, [])

  useEffect(() => {
    persistSetting("javaArgs", javaArgs)
  }, [javaArgs, persistSetting])

  useEffect(() => { persistSetting("showAlpha", String(showAlpha)) }, [persistSetting, showAlpha])
  useEffect(() => { persistSetting("showBeta", String(showBeta)) }, [persistSetting, showBeta])
  useEffect(() => { persistSetting("showSnapshot", String(showSnapshot)) }, [persistSetting, showSnapshot])
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
                showWarningModal={showAuthlibWarningModal}
                setShowWarningModal={setShowAuthlibWarningModal}
              />
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
              useCustomTheme={useCustomTheme}
              setUseCustomTheme={setUseCustomTheme}
              customTheme={customTheme}
              setCustomTheme={setCustomTheme}
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
