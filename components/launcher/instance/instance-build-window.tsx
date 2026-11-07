import { SettingsResolution } from "@/components/launcher/settings/settings-resolution"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { IconDeviceDesktop } from "@tabler/icons-react"
import { presetResolutions } from "@/components/launcher/settings/data"
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

  return (
    <div data-ui="instance-instance-build-window-div-1" data-component="instance-build-window" className="launcher-settings-panel">
      <div data-ui="instance-instance-build-window-div-2" className="flex items-start justify-between gap-4">
        <div data-ui="instance-instance-build-window-div-3">
          <div data-ui="instance-instance-build-window-div-4" className="launcher-settings-heading flex items-center gap-2 font-semibold text-foreground">
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
          role="switch"
          aria-checked={override}
          aria-label={t("build.window.overrideOn")}
          title={override ? t("build.window.overrideOn") : t("build.java.useLauncher")}
          className="settings-switch"
        >
          <span className="settings-switch-thumb" />
        </button>
      </div>

      {override && (
        <div className="mt-4">
          <SettingsResolution
            selectedResolution={matchedPreset?.label ?? ""}
            setSelectedResolution={label => {
              const preset = presetResolutions.find(item => item.label === label)
              if (preset) updateBuild(build.id, { windowWidth: preset.width, windowHeight: preset.height })
            }}
            useCustomResolution={useCustom}
            setUseCustomResolution={setUseCustom}
            customWidth={String(width ?? "")}
            customHeight={String(height ?? "")}
            setCustomWidth={value => updateBuild(build.id, { windowWidth: normalizeNumber(value) })}
            setCustomHeight={value => updateBuild(build.id, { windowHeight: normalizeNumber(value) })}
          />
        </div>
      )}
    </div>
  )
}