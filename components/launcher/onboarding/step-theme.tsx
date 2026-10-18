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
      <div className="grid grid-cols-2 gap-3">
        {presetThemes.map((theme) => {
          const selected = selectedTheme === theme.id
          return (
            <button
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
              {/* Та же миниатюра окна, что и в настройках: тема меняет акцент, а не фон. */}
              <div className="mb-3 flex h-12 w-full overflow-hidden rounded-xl border border-border/60 bg-[#18181b]">
                <div className="h-full w-3.5 shrink-0" style={{ backgroundColor: theme.primary }} />
                <div className="flex flex-1 flex-col gap-1.5 p-2">
                  <div className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: theme.primary }} />
                  <div className="h-1.5 w-2/5 rounded-full bg-white/10" />
                  <div className="mt-auto h-2.5 w-1/3 rounded-md" style={{ backgroundColor: theme.accent }} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{theme.name}</span>
                {selected && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
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