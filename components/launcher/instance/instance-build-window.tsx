import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { IconCheck, IconDeviceDesktop } from "@tabler/icons-react"
import { presetResolutions } from "@/components/launcher/settings/data"
import { Checkbox } from "@/components/ui/checkbox"
import type { Build } from "./types"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
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
    <div data-ui="instance-instance-build-window-div-1" data-component="instance-build-window" className="rounded-3xl border border-border bg-card/40 p-6">
      <div data-ui="instance-instance-build-window-div-2" className="flex items-start justify-between gap-4">
        <div data-ui="instance-instance-build-window-div-3">
          <div data-ui="instance-instance-build-window-div-4" className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconDeviceDesktop className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {t("build.window.title")}
          </div>
          <p data-ui="instance-instance-build-window-p-1" className="mt-1 text-sm text-muted-foreground">
            {t("build.window.desc")}
          </p>
        </div>
        <button data-ui="instance-instance-build-window-button-1"
          type="button"
          onClick={() => updateBuild(build.id, { windowOverride: !override })}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
            override ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <span data-ui="instance-instance-build-window-span-1" className={cn("w-2 h-2 rounded-full", override ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
          {override ? t("build.window.overrideOn") : t("build.java.useLauncher")}
        </button>
      </div>

      {override && (
        <div data-ui="instance-instance-build-window-div-5" className="mt-6 grid gap-5">
          <div data-ui="instance-instance-build-window-div-6" className="grid gap-2 sm:grid-cols-2">
            {presetResolutions.map(res => (
              <button data-ui="instance-instance-build-window-button-2"
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
                <div data-ui="instance-instance-build-window-div-7" className="flex items-center justify-between">
                  <span data-ui="instance-instance-build-window-span-2" className="text-sm font-semibold text-foreground">{res.label}</span>
                  {!useCustom && matchedPreset?.label === res.label && (
                    <IconCheck className="h-4 w-4 text-primary" strokeWidth={2} />
                  )}
                </div>
                <div data-ui="instance-instance-build-window-div-8" className="mt-0.5 text-xs text-muted-foreground">{res.width}×{res.height}</div>
              </button>
            ))}
          </div>

          <div data-ui="instance-instance-build-window-div-9">
            <label data-ui="instance-instance-build-window-label-1" className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={useCustom} onCheckedChange={(v) => toggleCustom(!!v)} />
              <span data-ui="instance-instance-build-window-span-3" className="text-sm font-medium text-foreground">{t("build.window.customResolution")}</span>
            </label>

            <div data-ui="instance-instance-build-window-div-10" className="mt-3 grid grid-cols-2 gap-3">
              <div data-ui="instance-instance-build-window-div-11">
                <label data-ui="instance-instance-build-window-label-2" className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("build.window.width")}</label>
                <div data-ui="instance-instance-build-window-div-12" className="flex items-center gap-2">
                  <input data-ui="instance-instance-build-window-input-1"
                    type="number"
                    value={width ?? ""}
                    onChange={e => updateBuild(build.id, { windowWidth: normalizeNumber(e.target.value) })}
                    placeholder="1920"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  <span data-ui="instance-instance-build-window-span-4" className="text-sm font-medium text-muted-foreground">px</span>
                </div>
              </div>
              <div data-ui="instance-instance-build-window-div-13">
                <label data-ui="instance-instance-build-window-label-3" className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("build.window.height")}</label>
                <div data-ui="instance-instance-build-window-div-14" className="flex items-center gap-2">
                  <input data-ui="instance-instance-build-window-input-2"
                    type="number"
                    value={height ?? ""}
                    onChange={e => updateBuild(build.id, { windowHeight: normalizeNumber(e.target.value) })}
                    placeholder="1080"
                    className="h-11 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                  />
                  <span data-ui="instance-instance-build-window-span-5" className="text-sm font-medium text-muted-foreground">px</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}