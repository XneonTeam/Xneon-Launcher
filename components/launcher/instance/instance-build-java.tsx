import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { IconFolderPlus, IconLoader2, IconSettings, IconX } from "@tabler/icons-react"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import type { JavaInstallation } from "@/components/launcher/settings/types"
import type { Build } from "./types"

interface InstanceBuildJavaProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

function memoryToMb(val?: string): number {
  if (!val) return 2048
  const s = val.trim().toUpperCase()
  if (s.endsWith("G")) return parseInt(s, 10) * 1024
  if (s.endsWith("M")) return parseInt(s, 10)
  return parseInt(s, 10) || 2048
}

function mbToMemory(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}G`
  return `${mb}M`
}

export function InstanceBuildJava({ build, updateBuild }: InstanceBuildJavaProps) {
  const [detected, setDetected] = useState<JavaInstallation[]>([])
  const [loadingDetect, setLoadingDetect] = useState(false)
  const [showJavaModal, setShowJavaModal] = useState(false)

  const override = build.javaOverride === true
  const isAuto = !build.javaPath || build.javaPath === ""

  useEffect(() => {
    if (!showJavaModal || detected.length > 0) return
    let cancelled = false
    setLoadingDetect(true)
    window.electronAPI?.detectJavaInstallations().then(list => {
      if (!cancelled) setDetected(list ?? [])
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoadingDetect(false)
    })
    return () => { cancelled = true }
  }, [showJavaModal, detected.length])

  const handlePickJavaFile = async () => {
    const picked = await window.electronAPI?.pickJavaFile()
    if (picked) {
      updateBuild(build.id, { javaPath: picked })
      setShowJavaModal(false)
    }
  }

  const selectedLabel = isAuto
    ? "Автоматически (как в лаунчере)"
    : detected.find(j => j.path === build.javaPath)?.label || build.javaPath?.split(/[\\/]/).pop() || build.javaPath

  const { maxMb, snapPoints } = useMemoryOptions()

  return (
    <div className="rounded-3xl border border-border bg-card/40 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconSettings className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            Java и память
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Свои настройки запуска для этой сборки. Если выключено — используются общие настройки лаунчера.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateBuild(build.id, { javaOverride: !override })}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
            override ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <span className={cn("w-2 h-2 rounded-full", override ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
          {override ? "Свои настройки включены" : "Использовать настройки лаунчера"}
        </button>
      </div>

      {override && (
        <div className="mt-6 grid gap-6">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Память</label>
            <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-2.5">
              <label className="block text-sm font-medium text-foreground">Выделено памяти</label>
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
              <p className="text-xs text-muted-foreground">Максимум оперативной памяти, выделяемой Minecraft.</p>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Java (путь к java.exe)</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowJavaModal(true)}
                className={cn(
                  "flex-1 h-11 rounded-2xl border px-4 text-left text-sm transition-all duration-200 flex items-center justify-between",
                  isAuto ? "border-border bg-muted/40 text-muted-foreground hover:border-primary/50 hover:bg-muted/50" : "border-primary/50 bg-primary/5 text-foreground hover:bg-primary/10"
                )}
              >
                <span className="truncate">{selectedLabel}</span>
              </button>
              <button
                type="button"
                onClick={handlePickJavaFile}
                className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <IconFolderPlus className="h-4 w-4" strokeWidth={1.75} />
                Выбрать файл...
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Доп. аргументы JVM</label>
            <textarea
              value={build.javaArgs ?? ""}
              onChange={e => updateBuild(build.id, { javaArgs: e.target.value })}
              rows={3}
              placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
              className="w-full resize-none rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Разделяй аргументы пробелами. Можно использовать кавычки для значений с пробелами.
            </p>
          </div>
        </div>
      )}

      {showJavaModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground">Java (путь к java.exe)</h3>
              <button
                onClick={() => setShowJavaModal(false)}
                className="w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <button
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
                <div className="flex items-center justify-between">
                  <div className="font-medium text-foreground">Автоматически (как в лаунчере)</div>
                  <span className={cn(
                    "text-xs px-2 py-1 rounded-md font-medium",
                    isAuto ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                  )}>
                    {isAuto ? "Выбрано" : "Выбрать"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Использовать Java из общих настроек лаунчера</div>
              </button>

              {loadingDetect ? (
                <div className="w-full p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-center gap-2">
                  <IconLoader2 className="w-4 h-4 animate-spin text-primary" strokeWidth={1.5} />
                  <span className="text-sm text-muted-foreground">Поиск Java...</span>
                </div>
              ) : detected.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground px-1">Обнаруженные</div>
                  <div className="max-h-[304px] space-y-2 overflow-y-auto pr-1">
                    {detected.map((java, index) => (
                      <button
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
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-foreground text-sm">{java.label}</div>
                          <span className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-md font-medium",
                            build.javaPath === java.path ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
                          )}>
                            {build.javaPath === java.path ? "Выбрано" : "Выбрать"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">{java.path}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                onClick={handlePickJavaFile}
                className="w-full p-4 rounded-xl border border-dashed border-border bg-muted/20 hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between px-4 text-muted-foreground hover:text-accent"
              >
                <div className="flex items-center gap-2">
                  <IconFolderPlus className="w-5 h-5" strokeWidth={1.5} />
                  <span className="text-sm">Выбрать файл...</span>
                </div>
                <span className="text-xs px-2 py-1 rounded-md bg-muted/50 font-medium">Выбрать</span>
              </button>
            </div>

            <button
              onClick={() => setShowJavaModal(false)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm transition-colors"
            >
              <IconX className="w-4 h-4" strokeWidth={1.75} />
              Отмена
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
