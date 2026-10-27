import { SettingsSwitch } from "./settings-switch"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import { ModalLayer } from "@/components/ui/modal-layer"
import { IconAlertTriangle, IconCircleX, IconPower } from "@tabler/icons-react"

interface SettingsAuthlibProps {
  enabled: boolean
  setEnabled: (v: boolean) => void
  injectorType: "authlib" | "retroauth"
  setInjectorType: (type: "authlib" | "retroauth") => void
  showWarningModal: boolean
  setShowWarningModal: (v: boolean) => void
}

export function SettingsAuthlib({
  enabled,
  setEnabled,
  injectorType,
  setInjectorType,
  showWarningModal,
  setShowWarningModal,
}: SettingsAuthlibProps) {
  const { t } = useTranslation()

  const handleToggle = () => {
    if (enabled) {
      setShowWarningModal(true)
    } else {
      setEnabled(true)
      if (injectorType === "authlib") {
        window.electronAPI?.setSetting("authlibInjectorEnabled", "true")
        window.electronAPI?.setSetting("retroauthInjectorEnabled", "false")
      } else {
        window.electronAPI?.setSetting("authlibInjectorEnabled", "false")
        window.electronAPI?.setSetting("retroauthInjectorEnabled", "true")
      }
    }
  }

  const handleTypeChange = (type: "authlib" | "retroauth") => {
    setInjectorType(type)
    if (type === "retroauth") {
      window.electronAPI?.setSetting("retroauthInjectorEnabled", "true")
      window.electronAPI?.setSetting("authlibInjectorEnabled", "false")
      setEnabled(true)
    } else {
      window.electronAPI?.setSetting("retroauthInjectorEnabled", "false")
      window.electronAPI?.setSetting("authlibInjectorEnabled", "true")
      setEnabled(true)
    }
  }

  return (
    <>
      <div data-ui="settings-settings-authlib-div-1" data-component="settings-authlib" className="p-4 rounded-xl border border-border bg-muted/30">
        <div data-ui="settings-settings-authlib-div-2" className="flex items-center justify-between">
          <div data-ui="settings-settings-authlib-div-3" className="flex-1">
            <div data-ui="settings-settings-authlib-div-4" className="font-medium text-foreground">Authlib Injector</div>
            <p data-ui="settings-settings-authlib-p-1" className="text-sm text-muted-foreground mt-1">{t("settings.authlibDesc")}</p>
          </div>
          <SettingsSwitch checked={enabled} onCheckedChange={() => handleToggle()} label="Authlib Injector" />
        </div>

        {enabled && (
          <div data-ui="settings-settings-authlib-div-5" className="mt-4 pt-4 border-t border-border">
            <div data-ui="settings-settings-authlib-div-6" className="mb-3 grid w-full grid-cols-2 gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1">
              <button data-ui="settings-settings-authlib-button-2"
                type="button"
                data-active={injectorType === "authlib"}
                onClick={() => handleTypeChange("authlib")}
                className={cn(
                  "flex items-center justify-center rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all duration-200",
                  injectorType === "authlib"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
              >
                Authlib Injector
              </button>
              <button data-ui="settings-settings-authlib-button-3"
                type="button"
                data-active={injectorType === "retroauth"}
                onClick={() => handleTypeChange("retroauth")}
                className={cn(
                  "flex items-center justify-center rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all duration-200",
                  injectorType === "retroauth"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
              >
                RetroAuth
              </button>
            </div>
            <div data-ui="settings-settings-authlib-div-7" className="flex gap-3">
              <div data-ui="settings-settings-authlib-div-8" className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10">
                <svg data-ui="settings-settings-authlib-svg-1" data-icon="settings-settings-authlib-svg-1" className="w-4 h-4" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
                  <path data-ui="settings-settings-authlib-path-1" fill="currentColor" d="M262 207.5V351h-37V64h37zM193.5 98v14.5H86V197h93v30H86v94l54.3.2 54.2.3v29l-72.7.3-72.8.2V83l72.3.2 72.2.3zm135.9 55.7c.3 1 7.3 31.7 15.6 68.3 8.4 36.6 15.5 67.3 15.8 68.3.4 1 7.8-26.8 18.2-68.3l17.5-70h20.2c12.5 0 20.3.4 20.3 1 0 .5-6.3 22.9-14 49.7-7.8 26.9-22.4 77.8-32.6 113.3s-19.5 67.2-20.6 70.5c-4.4 12.9-13.6 28.5-20.1 34.2-8.6 7.6-23 11.4-35.5 9.4-8.9-1.5-13.3-2.5-13.4-3.1-.1-.3.7-6.7 1.7-14.3l1.9-13.7 6.2.6c16.6 1.7 21-3.3 30.9-35.2l4.7-15.2-5.1-16.8c-2.7-9.3-10.4-35.6-17.1-58.4-19.1-65.1-35-119.4-35.5-120.8-.3-.9 4.1-1.2 20-1.2 18.5 0 20.4.2 20.9 1.7"/>
                </svg>
                <span data-ui="settings-settings-authlib-span-2" className="text-primary text-sm">Ely.By</span>
              </div>
              <div data-ui="settings-settings-authlib-div-9" className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10">
                <svg data-ui="settings-settings-authlib-svg-2" data-icon="settings-settings-authlib-svg-2" className="w-4 h-4" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
                  <path data-ui="settings-settings-authlib-path-2" fill="currentColor" d="M 121.270 53.270 L 93 81.539 93 86.387 C 93 90.685, 93.440 91.676, 96.882 95.118 C 100.594 98.829, 102.357 99.451, 108 99.039 C 109.813 98.907, 117.168 92.210, 134.750 74.686 L 159 50.515 159 88.493 L 159 126.471 146.236 113.736 L 133.472 101 126.244 101 L 119.016 101 111.008 108.754 L 103 116.508 103 126.876 C 103 138.904, 103.732 138.905, 92.871 126.857 L 85.778 118.988 89.363 115.019 C 93.760 110.153, 94.655 106.955, 92.869 102.487 C 92.037 100.404, 80.782 88.072, 64.162 71.030 L 36.823 43 19.709 43 L 2.595 43 16.024 56.750 C 35.123 76.307, 55.993 97.939, 59.465 101.779 L 62.430 105.058 33.215 134.285 C 17.147 150.360, 4 163.847, 4 164.256 C 4 164.665, 11.982 165, 21.739 165 L 39.477 165 55.296 149.250 L 71.114 133.500 86.307 149.285 L 101.500 165.071 109.827 165.035 C 117.581 165.002, 118.346 164.808, 120.939 162.215 C 123.315 159.838, 123.831 158.300, 124.445 151.746 C 124.841 147.520, 124.845 139.549, 124.454 134.031 C 124.062 128.514, 123.997 124, 124.308 124 C 124.619 124, 133.974 133.225, 145.097 144.500 L 165.320 165 171.144 165 C 176.166 165, 177.418 164.598, 180.234 162.083 L 183.500 159.165 183.774 103.301 L 184.048 47.437 172.678 36.218 L 161.307 25 155.423 25 L 149.539 25 121.270 53.270" stroke="none"/>
                </svg>
                <span data-ui="settings-settings-authlib-span-3" className="text-primary text-sm">XN Skins</span>
              </div>
              <div data-ui="settings-settings-authlib-div-10" className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10">
                <svg data-ui="settings-settings-authlib-svg-3" data-icon="settings-settings-authlib-svg-3" className="w-4 h-4" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
                  <path data-ui="settings-settings-authlib-path-3" fill="currentColor" d="M67.328 67.331h60.669V128H67.328zm-67.325 0h60.669V128H.003zM67.328 0h60.669v60.669H67.328zM.003 0h60.669v60.669H.003z"/>
                </svg>
                <span data-ui="settings-settings-authlib-span-4" className="text-primary text-sm">Microsoft</span>
              </div>
            </div>
          </div>
        )}
        
        {injectorType === "retroauth" && enabled && (
          <div data-ui="settings-settings-authlib-div-11" className="mt-3 text-xs text-muted-foreground">
            {t("settings.authlib.retroauthDesc")}
          </div>
        )}
      </div>

      {showWarningModal && createPortal(
        <ModalLayer windowId="settings-settings-authlib-window-1" onClose={() => setShowWarningModal(false)} className="animate-in fade-in-0">
          <div data-ui="settings-settings-authlib-div-12" className="w-full max-w-md p-6 rounded-2xl bg-card border border-destructive/50 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="settings-settings-authlib-div-13" className="flex items-center gap-4 mb-6">
              <div data-ui="settings-settings-authlib-div-14" className="w-12 h-12 rounded-xl bg-destructive/20 flex items-center justify-center">
                <IconAlertTriangle className="w-6 h-6 text-destructive" strokeWidth={1.5} />
              </div>
              <div data-ui="settings-settings-authlib-div-15">
                <h3 data-ui="settings-settings-authlib-h3-1" className="text-lg font-semibold text-foreground">{t("settings.warning.enableAuthlib.title")}</h3>
                <p data-ui="settings-settings-authlib-p-2" className="text-sm text-muted-foreground">{t("settings.areYouSure")}</p>
              </div>
            </div>
            <div data-ui="settings-settings-authlib-div-16" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-6">
              <p data-ui="settings-settings-authlib-p-3" className="text-foreground">{t("settings.warning.enableAuthlib.message")}</p>
              <p data-ui="settings-settings-authlib-p-4" className="text-sm text-muted-foreground mt-2">{t("settings.warning.enableAuthlib.detail")}</p>
            </div>
            <div data-ui="settings-settings-authlib-div-17" className="flex gap-3">
              <button data-ui="settings-settings-authlib-button-4"
                onClick={() => setShowWarningModal(false)}
                className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
              >
                <IconCircleX className="w-4 h-4" strokeWidth={1.75} />
                {t("settings.cancel")}
              </button>
              <button data-ui="settings-settings-authlib-button-5"
                onClick={() => {
                  setEnabled(false)
                  window.electronAPI?.setSetting("authlibInjectorEnabled", "false")
                  window.electronAPI?.setSetting("retroauthInjectorEnabled", "false")
                  setShowWarningModal(false)
                }}
                className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium transition-colors"
              >
                <IconPower className="w-4 h-4" strokeWidth={1.75} />
                {t("settings.disable")}
              </button>
            </div>
          </div>
        </ModalLayer>,
        document.body
      )}
    </>
  )
}
