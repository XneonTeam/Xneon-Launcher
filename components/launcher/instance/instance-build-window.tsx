import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { IconCheck, IconDeviceDesktop } from "@tabler/icons-react"
import { presetResolutions } from "@/components/launcher/settings/data"
import { Checkbox } from "@/components/ui/checkbox"
import type { Build } from "./types"

interface InstanceBuildWindowProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

function normalizeNumber(value: string): number | undefined {
  const parsed = parseInt(value.replace(/[^\d]/g, ""), 10)
  if (Number.isNaN(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, 8192)
}

export function InstanceBuildWindow({ build, updateBuild }: InstanceBuildWindowProps) {
  const [useCustom, setUseCustom] = useState(false)

  const override = build.windowOverride === true
  const width = build.windowWidth
  const height = build.windowHeight

  const matchedPreset = useMemo(() => {
    if (!width || !height) return null
    return presetResolutions.find(p => p.width === width && p.height === height) ?? null
  }, [width, height])

  const applyPreset = (res: { width: number; height: number }) => {
    updateBuild(build.id, { windowWidth: res.width, windowHeight: res.height })
    setUseCustom(false)
  }

  const toggleCustom = (checked: boolean) => {
    setUseCustom(checked)
    if (checked && !width && !height) {
      updateBuild(build.id, { windowWidth: 1920, windowHeight: 1080 })
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card/40 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconDeviceDesktop className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            Размер окна
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Свой размер окна запуска для этой сборки. Если выключено — используется размер окна из общих настроек лаунчера.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateBuild(build.id, { windowOverride: !override })}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
            override ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <span className={cn("w-2 h-2 rounded-full", override ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
          {override ? "Свой размер включён" : "Использовать настройки лаунчера"}
        </button>
      </div>

      {override && (
        <div className="mt-6 grid gap-5">
          <div className="grid gap-2 sm:grid-cols-2">
            {presetResolutions.map(res => (
              <button
                key={res.label}
                type="button"
                onClick={() => applyPreset(res)}
                className={cn(
                  "rounded-2xl border p-3 text-left transition-colors",
                  !useCustom && matchedPreset?.label === res.label
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted/30 hover:border-primary/40"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{res.label}</span>
                  {!useCustom && matchedPreset?.label === res.label && (
                    <IconCheck className="h-4 w-4 text-primary" strokeWidth={2} />
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{res.width}×{res.height}</div>
              </button>
            ))}
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={useCustom} onCheckedChange={(v) => toggleCustom(!!v)} />
              <span className="text-sm font-medium text-foreground">Своё разрешение</span>
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Ширина</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={width ?? ""}
                    onChange={e => updateBuild(build.id, { windowWidth: normalizeNumber(e.target.value) })}
                    placeholder="1920"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  <span className="text-sm font-medium text-muted-foreground">px</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Высота</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={height ?? ""}
                    onChange={e => updateBuild(build.id, { windowHeight: normalizeNumber(e.target.value) })}
                    placeholder="1080"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  <span className="text-sm font-medium text-muted-foreground">px</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}