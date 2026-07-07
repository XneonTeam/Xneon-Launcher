import { cn } from "@/lib/utils"
import { IconCheck } from "@tabler/icons-react"
import { presetThemes } from "../settings/data"

type StepThemeProps = {
  selectedTheme: string
  onSelect: (themeId: string) => void
}

export function StepTheme({ selectedTheme, onSelect }: StepThemeProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {presetThemes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            className={cn(
              "relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-200",
              selectedTheme === theme.id
                ? "border-primary shadow-[0_0_15px_var(--glow-primary)]"
                : "border-border hover:border-primary/50"
            )}
            style={{ backgroundColor: theme.background }}
          >
            <div className="mb-3 flex gap-2">
              <div className="h-8 w-8 rounded-lg shadow-inner" style={{ backgroundColor: theme.primary }} />
              <div className="h-8 w-8 rounded-lg shadow-inner" style={{ backgroundColor: theme.accent }} />
              <div className="h-8 w-8 rounded-lg border border-white/20 shadow-inner" style={{ backgroundColor: theme.background }} />
            </div>
            <span className="font-medium text-white">{theme.name}</span>
            {selectedTheme === theme.id && (
              <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                <IconCheck className="h-4 w-4 text-primary-foreground" strokeWidth={2} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
