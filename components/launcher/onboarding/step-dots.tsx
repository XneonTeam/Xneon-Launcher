import { cn } from "@/lib/utils"
import { IconCheck } from "@tabler/icons-react"
import { IconLanguage, IconPalette, IconDownload, IconUser, IconCpu, IconShieldCheck, IconRocket } from "@tabler/icons-react"
import type { OnboardingCopy } from "./translations"

const STEP_ICONS = [IconLanguage, IconPalette, IconDownload, IconUser, IconCpu, IconShieldCheck]

function getStepState(index: number, currentIndex: number) {
  if (index < currentIndex) return "done"
  if (index === currentIndex) return "current"
  return "upcoming"
}

type StepDotsProps = {
  steps: OnboardingCopy["steps"]
  stepIndex: number
  onSelectStep: (index: number) => void
}

export function StepDots({ steps, stepIndex, onSelectStep }: StepDotsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {steps.map((step, index) => {
        const StepIcon = STEP_ICONS[index] ?? IconRocket
        const state = getStepState(index, stepIndex)

        return (
          <button
            key={step.title}
            type="button"
            onClick={() => onSelectStep(index)}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200",
              state === "current"
                ? "border-primary bg-primary/10 shadow-[0_0_16px_var(--glow-primary)]"
                : state === "done"
                  ? "border-border bg-muted/30 hover:border-primary/35"
                  : "border-border bg-card hover:border-primary/35 hover:bg-muted/20"
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                state === "current"
                  ? "border-primary/30 bg-primary/15 text-primary"
                  : state === "done"
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-background text-muted-foreground"
              )}
            >
              {state === "done" ? <IconCheck className="h-4 w-4" strokeWidth={2.2} /> : <StepIcon className="h-4 w-4" strokeWidth={1.9} />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{step.title}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
