import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"

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
  const options = [
    { label: "Snapshot", description: "Снапшоты и экспериментальные сборки (snapshot)", value: showSnapshot, set: setShowSnapshot },
    { label: "Old Beta", description: "Старые бета-версии Minecraft (old_beta)", value: showBeta, set: setShowBeta },
    { label: "Old Alpha", description: "Старые альфа-версии Minecraft (old_alpha)", value: showAlpha, set: setShowAlpha },
  ]

  return (
    <div className="space-y-3">
      {options.map(opt => (
        <label key={opt.label} className={cn(
          "flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all",
          opt.value ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
        )}>
          <div>
            <p className="text-sm font-medium text-foreground">{opt.label}</p>
            <p className="text-xs text-muted-foreground">{opt.description}</p>
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
