import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslation } from "react-i18next"
import { IconFlask, IconHistory, IconArchive } from "@tabler/icons-react"

interface SettingsVersionsProps {
  showAlpha: boolean
  setShowAlpha: (v: boolean) => void
  showBeta: boolean
  setShowBeta: (v: boolean) => void
  showSnapshot: boolean
  setShowSnapshot: (v: boolean) => void
}

export function SettingsVersions({
  showAlpha,
  setShowAlpha,
  showBeta,
  setShowBeta,
  showSnapshot,
  setShowSnapshot,
}: SettingsVersionsProps) {
  const { t } = useTranslation()
  const options = [
    { label: "Snapshot", icon: IconFlask, description: t("settings.versions.snapshotDesc"), value: showSnapshot, set: setShowSnapshot },
    { label: "Old Beta", icon: IconHistory, description: t("settings.versions.oldBetaDesc"), value: showBeta, set: setShowBeta },
    { label: "Old Alpha", icon: IconArchive, description: t("settings.versions.oldAlphaDesc"), value: showAlpha, set: setShowAlpha },
  ]

  return (
    <div data-ui="settings-settings-versions-div-1" data-component="settings-versions" className="space-y-3">
      {options.map(({ icon: Icon, ...opt }) => (
        <label data-ui="settings-settings-versions-label-1" key={opt.label} data-active={opt.value} className={cn(
          "flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all",
          opt.value ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
        )}>
          <div className="flex min-w-0 items-center gap-3">
            <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
            <div data-ui="settings-settings-versions-div-2">
            <p data-ui="settings-settings-versions-p-1" className="text-sm font-medium text-foreground">{opt.label}</p>
            <p data-ui="settings-settings-versions-p-2" className="text-xs text-muted-foreground">{opt.description}</p>
            </div>
          </div>
          <Checkbox
            checked={opt.value}
            onCheckedChange={v => opt.set(!!v)}
          />
        </label>
      ))}
    </div>
  )
}
