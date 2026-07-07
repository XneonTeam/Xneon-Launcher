import { cn } from "@/lib/utils"
import { IconCheck } from "@tabler/icons-react"
import type { InjectorMode, OnboardingCopy } from "./translations"

type StepInjectorProps = {
  copy: OnboardingCopy
  injectorMode: InjectorMode
  onChange: (mode: InjectorMode) => void
  onError: (msg: string) => void
}

export function StepInjector({ copy, injectorMode, onChange, onError }: StepInjectorProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        {copy.injectorModes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => {
              onChange(mode.id)
              onError("")
            }}
            className={cn(
              "rounded-2xl border p-5 text-left transition-all duration-200",
              injectorMode === mode.id
                ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                : "border-border bg-card hover:border-primary/40"
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-foreground">{mode.title}</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{mode.description}</div>
              </div>
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                  injectorMode === mode.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-transparent"
                )}
              >
                <IconCheck className="h-4 w-4" strokeWidth={2.4} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
