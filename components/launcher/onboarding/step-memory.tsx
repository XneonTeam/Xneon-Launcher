import { cn } from "@/lib/utils"
import type { OnboardingCopy } from "./translations"

type StepMemoryProps = {
  copy: OnboardingCopy
  memoryMin: string
  memoryMax: string
  onChange: (min: string, max: string) => void
  onError: (msg: string) => void
}

export function StepMemory({ copy, memoryMin, memoryMax, onChange, onError }: StepMemoryProps) {
  const memoryPresets = [
    { id: "balanced", min: "4G", max: "6G" },
    { id: "heavy", min: "6G", max: "8G" },
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2">
        {memoryPresets.map((preset) => {
          const isActive = memoryMin === preset.min && memoryMax === preset.max
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onChange(preset.min, preset.max)
                onError("")
              }}
              className={cn(
                "rounded-2xl border p-4 text-left transition-all duration-200",
                isActive
                  ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <div className="text-sm uppercase tracking-[0.18em] text-muted-foreground">{preset.id}</div>
              <div className="mt-2 text-xl font-semibold text-foreground">{preset.min} / {preset.max}</div>
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-2xl border border-border bg-card p-5 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">{copy.memoryMin}</span>
              <div className="flex h-12 items-center rounded-2xl border border-border bg-background/70 px-4">
                <input
                  value={memoryMin.replace(/G$/i, "")}
                  onChange={(event) => onChange(`${event.target.value.replace(/[^\d]/g, "")}G`, memoryMax)}
                  inputMode="numeric"
                  className="w-full bg-transparent text-foreground outline-none"
                />
                <span className="text-sm text-muted-foreground">GB</span>
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">{copy.memoryMax}</span>
              <div className="flex h-12 items-center rounded-2xl border border-border bg-background/70 px-4">
                <input
                  value={memoryMax.replace(/G$/i, "")}
                  onChange={(event) => onChange(memoryMin, `${event.target.value.replace(/[^\d]/g, "")}G`)}
                  inputMode="numeric"
                  className="w-full bg-transparent text-foreground outline-none"
                />
                <span className="text-sm text-muted-foreground">GB</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
        {copy.memoryHint}
      </div>
    </div>
  )
}
