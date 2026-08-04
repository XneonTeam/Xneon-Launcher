import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { IconCheck, IconFolderPlus, IconLoader2, IconSettings } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { JavaInstallation } from "@/components/launcher/settings/types"
import type { Build } from "./types"

interface InstanceBuildJavaProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

const MEMORY_PRESETS = [
  { id: "light", label: "2 ГБ", min: "2G", max: "2G", desc: "Для слабых ПК" },
  { id: "balanced", label: "4 ГБ", min: "2G", max: "4G", desc: "Оптимально" },
  { id: "heavy", label: "8 ГБ", min: "4G", max: "8G", desc: "Для тяжёлых сборок" },
] as const

function normalizeMemoryInput(value: string): string {
  const digits = value.replace(/[^\d]/g, "").slice(0, 3)
  if (!digits) return ""
  return `${digits}G`
}

export function InstanceBuildJava({ build, updateBuild }: InstanceBuildJavaProps) {
  const [detected, setDetected] = useState<JavaInstallation[]>([])
  const [loadingDetect, setLoadingDetect] = useState(false)

  const override = build.javaOverride === true

  useEffect(() => {
    if (!override || detected.length > 0 || loadingDetect) return
    let cancelled = false
    setLoadingDetect(true)
    window.electronAPI?.detectJavaInstallations().then(list => {
      if (!cancelled) setDetected(list ?? [])
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoadingDetect(false)
    })
    return () => { cancelled = true }
  }, [override, detected.length, loadingDetect])

  const memoryPresetId = useMemo(() => {
    const min = build.memoryMin ?? ""
    const max = build.memoryMax ?? ""
    const preset = MEMORY_PRESETS.find(p => p.min === min && p.max === max)
    return preset ? preset.id : "custom"
  }, [build.memoryMin, build.memoryMax])

  const applyPreset = (id: string) => {
    const preset = MEMORY_PRESETS.find(p => p.id === id)
    if (!preset) return
    updateBuild(build.id, { memoryMin: preset.min, memoryMax: preset.max, memoryPreset: preset.id })
  }

  const handlePickJavaFile = async () => {
    const picked = await window.electronAPI?.pickJavaFile()
    if (picked) updateBuild(build.id, { javaPath: picked })
  }

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
          {/* Memory */}
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Память</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {MEMORY_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={cn(
                    "rounded-2xl border p-3 text-left transition-colors",
                    memoryPresetId === preset.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-muted/30 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{preset.label}</span>
                    {memoryPresetId === preset.id && <IconCheck className="h-4 w-4 text-primary" strokeWidth={2} />}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{preset.desc}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Мин. память (-Xms)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={(build.memoryMin ?? "").replace(/G$/i, "")}
                    onChange={e => updateBuild(build.id, { memoryMin: normalizeMemoryInput(e.target.value), memoryPreset: "custom" })}
                    placeholder="2"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  <span className="text-sm font-medium text-muted-foreground">ГБ</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Макс. память (-Xmx)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={(build.memoryMax ?? "").replace(/G$/i, "")}
                    onChange={e => updateBuild(build.id, { memoryMax: normalizeMemoryInput(e.target.value), memoryPreset: "custom" })}
                    placeholder="4"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  <span className="text-sm font-medium text-muted-foreground">ГБ</span>
                </div>
              </div>
            </div>
          </div>

          {/* Java path */}
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Java (путь к java.exe)</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={build.javaPath ?? "auto"}
                onValueChange={(value) => updateBuild(build.id, { javaPath: value === "auto" ? "" : value })}
              >
                <SelectTrigger className="h-11 flex-1 rounded-2xl border-border bg-muted/40 text-foreground">
                  <SelectValue placeholder="Автоматически (как в лаунчере)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Автоматически (как в лаунчере)</SelectItem>
                  {loadingDetect ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <IconLoader2 className="h-4 w-4 animate-spin" /> Поиск Java...
                    </div>
                  ) : detected.length > 0 ? (
                    detected.map((java, index) => (
                      <SelectItem key={`${java.path}-${index}`} value={java.path}>
                        {java.label} — {java.path}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Установленные Java не найдены</div>
                  )}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={handlePickJavaFile}
                className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <IconFolderPlus className="h-4 w-4" strokeWidth={1.75} />
                Выбрать файл...
              </button>
            </div>
            {build.javaPath && (
              <p className="mt-2 truncate text-xs text-muted-foreground">Выбрано: {build.javaPath}</p>
            )}
          </div>

          {/* JVM args */}
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
    </div>
  )
}
