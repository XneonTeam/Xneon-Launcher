import { cn } from "@/lib/utils"
import { IconCheck } from "@tabler/icons-react"
import type { Theme } from "../settings/types"
import { ThemeCompactPreview } from "../settings/theme-preview"

type StepThemeProps = {
  /** Пресеты вместе со своими темами: список приходит из реестра тем. */
  themes: Theme[]
  selectedTheme: string
  onSelect: (themeId: string) => void
}

export function StepTheme({ themes, selectedTheme, onSelect }: StepThemeProps) {
  return (
    <div data-ui="onboarding-step-theme-div-1" data-component="step-theme" className="space-y-5">
      <div data-ui="onboarding-step-theme-div-2" className="grid grid-cols-2 gap-3">
        {themes.map((theme) => {
          const selected = selectedTheme === theme.id
          return (
            <button data-ui="onboarding-step-theme-button-1"
              key={theme.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(theme.id)}
              className={cn(
                "rounded-2xl border p-3.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                selected
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/30"
              )}
            >
              {/* Компактная миниатюра окна как в оригинальном дизайне */}
              <ThemeCompactPreview theme={theme} className="mb-3" />

              <div data-ui="onboarding-step-theme-div-3" className="flex items-center justify-between gap-2">
                <span data-ui="onboarding-step-theme-span-1" className="text-sm font-medium text-foreground">{theme.name}</span>
                {selected && (
                  <span data-ui="onboarding-step-theme-span-2" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                    <IconCheck className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.5} />
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}