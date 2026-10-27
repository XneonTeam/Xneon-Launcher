import { SETTINGS_CONTENT_ENTER_DELAYED } from "./settings-motion"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { ModalLayer } from "@/components/ui/modal-layer"
import { IconCheck, IconCoffee, IconFolderPlus, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react"
import type { JavaInstallation } from "./types"

interface SettingsJavaProps {
  selectedJavaPath: string
  setSelectedJavaPath: (v: string) => void
  javaArgs: string
  setJavaArgs: (v: string) => void
  showJavaModal: boolean
  setShowJavaModal: (v: boolean) => void
  editingJavaVersion: string
  setEditingJavaVersion: (v: string) => void
  detectedJavaInstallations: JavaInstallation[]
  loadingJavaInstallations: boolean
  onPickJavaFile: () => Promise<void>
  /** Принудительно перечитать список установленных Java (мимо кэша main). */
  onRefreshJava: () => void
}

const autoVersions = [
  { version: "8", label: "Java 8" },
  { version: "11", label: "Java 11" },
  { version: "16", label: "Java 16" },
  { version: "21", label: "Java 21" },
  { version: "26", label: "Java 26" },
]

export function SettingsJava({
  selectedJavaPath,
  setSelectedJavaPath,
  javaArgs,
  setJavaArgs,
  showJavaModal,
  setShowJavaModal,
  editingJavaVersion,
  setEditingJavaVersion,
  detectedJavaInstallations,
  loadingJavaInstallations,
  onPickJavaFile,
  onRefreshJava,
}: SettingsJavaProps) {
  const { t } = useTranslation()
  return (
    <>
      <div data-ui="settings-settings-java-div-1" data-component="settings-java" className={`space-y-3 ${SETTINGS_CONTENT_ENTER_DELAYED}`}>
        <div data-settings-tone="amber" className="settings-color-panel settings-java-list">
        {autoVersions.map((java) => (
          <button data-ui="settings-settings-java-button-1"
            key={java.version}
            type="button"
            onClick={() => {
              setEditingJavaVersion(java.version)
              setShowJavaModal(true)
            }}
            className={cn(
              "w-full p-4 rounded-xl border transition-all duration-200 flex items-center justify-between text-left",
              selectedJavaPath === java.version ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
            )}
          >
            <div data-ui="settings-settings-java-div-2" className="flex items-center gap-3"><IconCoffee className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
              <div data-ui="settings-settings-java-div-3" className="text-left">
                <div data-ui="settings-settings-java-div-4" className="font-medium text-foreground">{java.label}</div>
                <div data-ui="settings-settings-java-div-5" className="text-xs text-muted-foreground">{t("settings.java.auto")}</div>
              </div>
            </div>
            <div data-ui="settings-settings-java-div-6" className="flex items-center gap-2 text-muted-foreground">
              {selectedJavaPath === java.version && <IconCheck className="w-4 h-4 text-primary" strokeWidth={2} />}
            </div>
          </button>
        ))}
        </div>

        <button data-ui="settings-settings-java-button-2" data-settings-tone="amber"
          onClick={() => { void onPickJavaFile() }}
          className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all duration-200 flex items-center justify-center gap-2 text-muted-foreground hover:text-accent"
        >
          <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
          {t("settings.selectJavaPath")}
        </button>

        <div data-ui="settings-settings-java-div-7" data-settings-tone="violet" className="settings-color-panel space-y-2 p-4">
          <label data-ui="settings-settings-java-label-1" className="block text-sm font-medium text-foreground">{t("settings.java.args")}</label>
          <textarea data-ui="settings-settings-java-textarea-1"
            value={javaArgs}
            onChange={(e) => setJavaArgs(e.target.value)}
            placeholder={t("settings.java.argsPlaceholder")}
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
          />
          <p data-ui="settings-settings-java-p-1" className="text-xs text-muted-foreground">
            {t("settings.java.argsDesc")}
          </p>
        </div>
      </div>

      {showJavaModal && createPortal(
        <ModalLayer windowId="settings-settings-java-window-1"
          onClose={() => { setShowJavaModal(false); setEditingJavaVersion("") }}
          className="animate-in fade-in-0"
        >
          <div data-ui="settings-settings-java-div-8" className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="settings-settings-java-div-9" className="flex items-center justify-between mb-5">
              <h3 data-ui="settings-settings-java-h3-1" className="text-lg font-semibold text-foreground">{editingJavaVersion ? `Java ${editingJavaVersion}` : t("settings.java.selectJavaPath")}</h3>
              <button data-ui="settings-settings-java-button-3"
                onClick={() => { setShowJavaModal(false); setEditingJavaVersion("") }}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <div data-ui="settings-settings-java-div-10" className="space-y-3 mb-4">
              <button data-ui="settings-settings-java-button-4"
                onClick={() => {
                  const ver = editingJavaVersion || "11"
                  setSelectedJavaPath(ver)
                  void window.electronAPI?.setSetting("javaPath", ver)
                  setShowJavaModal(false)
                  setEditingJavaVersion("")
                }}
                className={cn(
                  "w-full p-4 rounded-xl border transition-all duration-200 text-left",
                  selectedJavaPath === (editingJavaVersion || "11")
                    ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                    : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                <div data-ui="settings-settings-java-div-11" className="flex items-center justify-between">
                  <div data-ui="settings-settings-java-div-12" className="font-medium text-foreground">{t("settings.java.automatic")}</div>
                  <span data-ui="settings-settings-java-span-1" className={cn(
                    "text-xs px-2 py-1 rounded-md font-medium",
                    selectedJavaPath === (editingJavaVersion || "11") ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {selectedJavaPath === (editingJavaVersion || "11") ? t("settings.java.selected") : t("settings.java.select")}
                  </span>
                </div>
                <div data-ui="settings-settings-java-div-13" className="text-xs text-muted-foreground mt-1">{t("settings.java.autoDesc")}</div>
              </button>

              {loadingJavaInstallations ? (
                <div data-ui="settings-settings-java-div-14" className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                  <span data-ui="settings-settings-java-span-2" className="text-sm text-muted-foreground">{t("settings.java.searching")}</span>
                </div>
              ) : detectedJavaInstallations.length > 0 ? (
                <div data-ui="settings-settings-java-div-15" className="space-y-2">
                  <div data-ui="settings-settings-java-div-16" className="flex items-center justify-between px-1">
                    <div data-ui="settings-settings-java-div-17" className="text-xs font-medium text-muted-foreground">{t("settings.java.detected")}</div>
                    <button data-ui="settings-settings-java-button-5"
                      type="button"
                      onClick={() => onRefreshJava()}
                      title={t("common.refresh")}
                      aria-label={t("common.refresh")}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <IconRefresh className="h-3 w-3" strokeWidth={1.75} />
                      {t("common.refresh")}
                    </button>
                  </div>
                  <div data-ui="settings-settings-java-div-18" className="max-h-[304px] space-y-2 overflow-y-auto pr-1">
                    {detectedJavaInstallations.map((java, index) => (
                      <button data-ui="settings-settings-java-button-6"
                        key={index}
                        onClick={() => {
                          setSelectedJavaPath(java.path)
                          void window.electronAPI?.setSetting("javaPath", java.path)
                          setShowJavaModal(false)
                          setEditingJavaVersion("")
                        }}
                        className={cn(
                          "w-full min-h-[70px] p-3 rounded-xl border transition-all duration-200 text-left",
                          selectedJavaPath === java.path
                            ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div data-ui="settings-settings-java-div-19" className="flex items-center justify-between gap-3">
                          <div data-ui="settings-settings-java-div-20" className="font-medium text-foreground text-sm">{java.label}</div>
                          <span data-ui="settings-settings-java-span-3" className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                            selectedJavaPath === java.path ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            {selectedJavaPath === java.path ? t("settings.java.selected") : t("settings.java.select")}
                          </span>
                        </div>
                        <div data-ui="settings-settings-java-div-21" className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                        {(java.arch || java.vendor || java.fullVersion) && (
                          <div data-ui="settings-settings-java-div-22" className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {java.arch && <span data-ui="settings-settings-java-span-4" className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{t("settings.java.archBits", { arch: java.arch })}</span>}
                            {java.vendor && <span data-ui="settings-settings-java-span-5" className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{java.vendor}</span>}
                            {java.fullVersion && java.fullVersion !== java.version && <span data-ui="settings-settings-java-span-6" className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{java.fullVersion}</span>}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button data-ui="settings-settings-java-button-7"
                onClick={() => { void onPickJavaFile() }}
                className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between px-4 text-muted-foreground hover:text-accent"
              >
                <div data-ui="settings-settings-java-div-23" className="flex items-center gap-2">
                  <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
                  <span data-ui="settings-settings-java-span-7" className="text-sm">{t("settings.selectJavaPath")}</span>
                </div>
                <span data-ui="settings-settings-java-span-8" className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">{t("settings.java.select")}</span>
              </button>
            </div>

            <button data-ui="settings-settings-java-button-8"
              onClick={() => { setShowJavaModal(false); setEditingJavaVersion("") }}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm transition-colors"
            >
              <IconX className="w-4 h-4" strokeWidth={1.75} />
              {t("settings.cancel")}
            </button>
          </div>
        </ModalLayer>,
        document.body
      )}
    </>
  )
}
