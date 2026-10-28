import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { memoryToMb, mbToMemory } from "@/lib/memory"
import { IconFolderPlus, IconLoader2, IconRefresh, IconSettings, IconX } from "@tabler/icons-react"
import { MemorySlider } from "@/components/ui/memory-slider"
import { ModalLayer } from "@/components/ui/modal-layer"
import { ModalTitleIcon } from "@/components/ui/modal-title-icon"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import type { JavaInstallation } from "@/components/launcher/settings/types"
import type { Build } from "./types"
import { useTranslation } from "react-i18next"

interface InstanceBuildJavaProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

export function InstanceBuildJava({ build, updateBuild }: InstanceBuildJavaProps) {
  const { t } = useTranslation()
  const [detected, setDetected] = useState<JavaInstallation[]>([])
  const [loadingDetect, setLoadingDetect] = useState(false)
  const [showJavaModal, setShowJavaModal] = useState(false)

  const override = build.javaOverride === true
  const isAuto = !build.javaPath || build.javaPath === ""

  /**
   * Список установленных Java кэшируется в main-процессе (скан реестра и
   * запуск java.exe стоят секунды). force — принудительное обновление из кнопки
   * «Обновить»: пользователь мог поставить новую Java уже после открытия окна.
   */
  const loadJavaInstallations = useCallback(async (force = false) => {
    setLoadingDetect(true)
    try {
      const list = await window.electronAPI?.detectJavaInstallations(force)
      setDetected(list ?? [])
    } catch {
      setDetected([])
    } finally {
      setLoadingDetect(false)
    }
  }, [])

  useEffect(() => {
    if (!showJavaModal || detected.length > 0) return
    void loadJavaInstallations()
  }, [showJavaModal, detected.length, loadJavaInstallations])

  const handlePickJavaFile = async () => {
    const picked = await window.electronAPI?.pickJavaFile()
    if (picked) {
      updateBuild(build.id, { javaPath: picked })
      setShowJavaModal(false)
    }
  }

  const selectedLabel = isAuto
    ? t("build.java.auto")
    : detected.find(j => j.path === build.javaPath)?.label || build.javaPath?.split(/[\\/]/).pop() || build.javaPath

  const { maxMb, snapPoints } = useMemoryOptions()

  return (
    <div data-ui="instance-instance-build-java-div-1" data-component="instance-build-java" className="rounded-3xl border border-border bg-card/40 p-6">
      <div data-ui="instance-instance-build-java-div-2" className="flex items-start justify-between gap-4">
        <div data-ui="instance-instance-build-java-div-3">
          <div data-ui="instance-instance-build-java-div-4" className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconSettings className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {t("build.java.title")}
          </div>
          <p data-ui="instance-instance-build-java-p-1" className="mt-1 text-sm text-muted-foreground">
            {t("build.java.desc")}
          </p>
        </div>
        <button data-ui="instance-instance-build-java-button-1"
          type="button"
          onClick={() => updateBuild(build.id, { javaOverride: !override })}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
            override ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <span data-ui="instance-instance-build-java-span-1" className={cn("w-2 h-2 rounded-full", override ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
          {override ? t("build.java.overrideOn") : t("build.java.useLauncher")}
        </button>
      </div>

      {override && (
        <div data-ui="instance-instance-build-java-div-5" className="mt-6 grid gap-6">
          <div data-ui="instance-instance-build-java-div-6">
            <label data-ui="instance-instance-build-java-label-1" className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("build.java.memory")}</label>
            <div data-ui="instance-instance-build-java-div-7" className="rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
              <label data-ui="instance-instance-build-java-label-2" className="block text-sm font-medium text-foreground">{t("build.java.allocated")}</label>
              <MemorySlider
                value={memoryToMb(build.memoryMax)}
                min={512}
                max={maxMb}
                step={64}
                snapPoints={snapPoints}
                snapRange={512}
                unit="MB"
                onChange={(v) => updateBuild(build.id, { memoryMax: mbToMemory(v) })}
              />
              <p data-ui="instance-instance-build-java-p-2" className="text-xs text-muted-foreground">{t("build.java.memoryDesc")}</p>
            </div>
          </div>

          <div data-ui="instance-instance-build-java-div-8">
            <label data-ui="instance-instance-build-java-label-3" className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("build.java.path")}</label>
            <div data-ui="instance-instance-build-java-div-9" className="flex items-center gap-3">
              <button data-ui="instance-instance-build-java-button-2"
                type="button"
                onClick={() => setShowJavaModal(true)}
                className={cn(
                  "flex-1 h-11 rounded-2xl border px-4 text-left text-sm transition-all duration-200 flex items-center justify-between",
                  isAuto ? "border-border bg-muted/40 text-muted-foreground hover:border-primary/50 hover:bg-muted/50" : "border-primary/50 bg-primary/5 text-foreground hover:bg-primary/10"
                )}
              >
                <span data-ui="instance-instance-build-java-span-2" className="truncate">{selectedLabel}</span>
              </button>
              <button data-ui="instance-instance-build-java-button-3"
                type="button"
                onClick={handlePickJavaFile}
                className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <IconFolderPlus className="h-4 w-4" strokeWidth={1.75} />
                {t("build.java.pickFile")}
              </button>
            </div>
          </div>

          <div data-ui="instance-instance-build-java-div-10">
            <label data-ui="instance-instance-build-java-label-4" className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("build.java.jvmArgs")}</label>
            <textarea data-ui="instance-instance-build-java-textarea-1"
              value={build.javaArgs ?? ""}
              onChange={e => updateBuild(build.id, { javaArgs: e.target.value })}
              rows={3}
              placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
              className="w-full resize-none rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
            <p data-ui="instance-instance-build-java-p-3" className="mt-1.5 text-xs text-muted-foreground">
              {t("build.java.argsHint")}
            </p>
          </div>
        </div>
      )}

      {showJavaModal && createPortal(
        <ModalLayer windowId="instance-instance-build-java-window-1" onClose={() => setShowJavaModal(false)} className="animate-in fade-in-0">
          <div data-ui="instance-instance-build-java-div-11" className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="instance-instance-build-java-div-12" className="flex items-center justify-between mb-5">
              <h3 data-ui="instance-instance-build-java-h3-1" className="flex items-center gap-2 text-lg font-semibold text-foreground"><ModalTitleIcon><IconSettings className="h-4 w-4" strokeWidth={1.75} /></ModalTitleIcon>{t("build.java.path")}</h3>
              <div data-ui="instance-instance-build-java-div-13" className="flex items-center gap-2">
                <button data-ui="instance-instance-build-java-button-4"
                  type="button"
                  onClick={() => void loadJavaInstallations(true)}
                  disabled={loadingDetect}
                  title={t("common.refresh")}
                  aria-label={t("common.refresh")}
                  className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {loadingDetect ? <IconLoader2 className="w-4 h-4 text-primary animate-spin" strokeWidth={1.5} /> : <IconRefresh className="w-4 h-4" strokeWidth={1.5} />}
                </button>
                <button data-ui="instance-instance-build-java-button-5"
                  onClick={() => setShowJavaModal(false)}
                  className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <IconX className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div data-ui="instance-instance-build-java-div-14" className="space-y-3 mb-4">
              <button data-ui="instance-instance-build-java-button-6"
                onClick={() => {
                  updateBuild(build.id, { javaPath: "" })
                  setShowJavaModal(false)
                }}
                className={cn(
                  "w-full p-4 rounded-xl border transition-all duration-200 text-left",
                  isAuto
                    ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                    : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                <div data-ui="instance-instance-build-java-div-15" className="flex items-center justify-between">
                  <div data-ui="instance-instance-build-java-div-16" className="font-medium text-foreground">{t("build.java.auto")}</div>
                  <span data-ui="instance-instance-build-java-span-3" className={cn(
                    "text-xs px-2 py-1 rounded-md font-medium",
                    isAuto ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {isAuto ? t("build.java.selected") : t("build.java.choose")}
                  </span>
                </div>
                <div data-ui="instance-instance-build-java-div-17" className="text-xs text-muted-foreground mt-1">{t("build.java.autoDesc")}</div>
              </button>

              {loadingDetect ? (
                <div data-ui="instance-instance-build-java-div-18" className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                  <span data-ui="instance-instance-build-java-span-4" className="text-sm text-muted-foreground">{t("build.java.searching")}</span>
                </div>
              ) : detected.length > 0 ? (
                <div data-ui="instance-instance-build-java-div-19" className="space-y-2">
                  <div data-ui="instance-instance-build-java-div-20" className="text-xs font-medium text-muted-foreground px-1">{t("build.java.detected")}</div>
                  <div data-ui="instance-instance-build-java-div-21" className="max-h-[304px] space-y-2 overflow-y-auto pr-1">
                    {detected.map((java, index) => (
                      <button data-ui="instance-instance-build-java-button-7"
                        key={index}
                        onClick={() => {
                          updateBuild(build.id, { javaPath: java.path })
                          setShowJavaModal(false)
                        }}
                        className={cn(
                          "w-full min-h-[70px] p-3 rounded-xl border transition-all duration-200 text-left",
                          build.javaPath === java.path
                            ? "border-primary bg-primary/10 shadow-[0_0_10px_var(--glow-primary)]"
                            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div data-ui="instance-instance-build-java-div-22" className="flex items-center justify-between gap-3">
                          <div data-ui="instance-instance-build-java-div-23" className="font-medium text-foreground text-sm">{java.label}</div>
                          <span data-ui="instance-instance-build-java-span-5" className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                            build.javaPath === java.path ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            {build.javaPath === java.path ? t("build.java.selected") : t("build.java.choose")}
                          </span>
                        </div>
                        <div data-ui="instance-instance-build-java-div-24" className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button data-ui="instance-instance-build-java-button-8"
                onClick={handlePickJavaFile}
                className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between px-4 text-muted-foreground hover:text-accent"
              >
                <div data-ui="instance-instance-build-java-div-25" className="flex items-center gap-2">
                  <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
                  <span data-ui="instance-instance-build-java-span-6" className="text-sm">{t("build.java.pickFile")}</span>
                </div>
                <span data-ui="instance-instance-build-java-span-7" className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">{t("build.java.choose")}</span>
              </button>
            </div>

            <button data-ui="instance-instance-build-java-button-9"
              onClick={() => setShowJavaModal(false)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm transition-colors"
            >
              <IconX className="w-4 h-4" strokeWidth={1.75} />
              {t("common.cancel")}
            </button>
          </div>
        </ModalLayer>,
        document.body
      )}
    </div>
  )
}
