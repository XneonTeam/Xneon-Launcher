import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconCheck } from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import { presetResolutions } from "./data"
import type { Resolution } from "./types"

interface SettingsResolutionProps {
  selectedResolution: string
  setSelectedResolution: (v: string) => void
  useCustomResolution: boolean
  setUseCustomResolution: (v: boolean) => void
  customWidth: string
  setCustomWidth: (v: string) => void
  customHeight: string
  setCustomHeight: (v: string) => void
}

export function SettingsResolution({
  selectedResolution,
  setSelectedResolution,
  useCustomResolution,
  setUseCustomResolution,
  customWidth,
  setCustomWidth,
  customHeight,
  setCustomHeight,
}: SettingsResolutionProps) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-3">
      {presetResolutions.map((res: Resolution) => (
        <button
          key={res.label}
          onClick={() => { setSelectedResolution(res.label); setUseCustomResolution(false) }}
          className={cn(
            "p-3 rounded-xl border transition-all duration-200 text-left",
            selectedResolution === res.label && !useCustomResolution
              ? "border-primary bg-primary/10 text-foreground shadow-[0_0_10px_var(--glow-primary)]"
              : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <span className="font-medium">{res.label}</span>
        </button>
      ))}
      <div className="col-span-2 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox
            checked={useCustomResolution}
            onCheckedChange={(v) => setUseCustomResolution(!!v)}
          />
          <span className="text-foreground">{t("settings.customResolution")}</span>
        </label>
        {useCustomResolution && (
          <div className="flex gap-3 items-center animate-in fade-in-0 slide-in-from-top-2">
            <input
              type="number"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              placeholder={t("settings.width")}
              className="w-28 px-3 py-2 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            />
            <span className="text-muted-foreground">x</span>
            <input
              type="number"
              value={customHeight}
              onChange={(e) => setCustomHeight(e.target.value)}
              placeholder={t("settings.height")}
              className="w-28 px-3 py-2 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
        )}
      </div>
    </div>
  )
}
