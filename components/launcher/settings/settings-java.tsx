import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconCheck, IconFolderPlus, IconLoader2, IconX } from "@tabler/icons-react"
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
}: SettingsJavaProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="space-y-3">
        {autoVersions.map((java) => (
          <button
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
            <div className="flex items-center gap-3">
              <div className="text-left">
                <div className="font-medium text-foreground">{java.label}</div>
                <div className="text-xs text-muted-foreground">{t("settings.java.auto")}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              {selectedJavaPath === java.version && <IconCheck className="w-4 h-4 text-primary" strokeWidth={2} />}
            </div>
          </button>
        ))}

        <button
          onClick={() => { void onPickJavaFile() }}
          className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all duration-200 flex items-center justify-center gap-2 text-muted-foreground hover:text-accent"
        >
          <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
          {t("settings.selectJavaPath")}
        </button>

        <div className="space-y-2 pt-2">
          <label className="block text-sm font-medium text-foreground">{t("settings.java.args")}</label>
          <textarea
            value={javaArgs}
            onChange={(e) => setJavaArgs(e.target.value)}
            placeholder={t("settings.java.argsPlaceholder")}
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.java.argsDesc")}
          </p>
        </div>
      </div>

      {showJavaModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground">{editingJavaVersion ? `Java ${editingJavaVersion}` : t("settings.java.selectJavaPath")}</h3>
              <button
                onClick={() => { setShowJavaModal(false); setEditingJavaVersion("") }}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <button
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
                <div className="flex items-center justify-between">
                  <div className="font-medium text-foreground">{t("settings.java.automatic")}</div>
                  <span className={cn(
                    "text-xs px-2 py-1 rounded-md font-medium",
                    selectedJavaPath === (editingJavaVersion || "11") ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {selectedJavaPath === (editingJavaVersion || "11") ? t("settings.java.selected") : t("settings.java.select")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{t("settings.java.autoDesc")}</div>
              </button>

              {loadingJavaInstallations ? (
                <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                  <span className="text-sm text-muted-foreground">{t("settings.java.searching")}</span>
                </div>
              ) : detectedJavaInstallations.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground px-1">{t("settings.java.detected")}</div>
                  <div className="max-h-[304px] space-y-2 overflow-y-auto pr-1">
                    {detectedJavaInstallations.map((java, index) => (
                      <button
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
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-foreground text-sm">{java.label}</div>
                          <span className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                            selectedJavaPath === java.path ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            {selectedJavaPath === java.path ? t("settings.java.selected") : t("settings.java.select")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                onClick={() => { void onPickJavaFile() }}
                className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between px-4 text-muted-foreground hover:text-accent"
              >
                <div className="flex items-center gap-2">
                  <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
                  <span className="text-sm">{t("settings.selectJavaPath")}</span>
                </div>
                <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">{t("settings.java.select")}</span>
              </button>
            </div>

            <button
              onClick={() => { setShowJavaModal(false); setEditingJavaVersion("") }}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm transition-colors"
            >
              <IconX className="w-4 h-4" strokeWidth={1.75} />
              {t("settings.cancel")}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
