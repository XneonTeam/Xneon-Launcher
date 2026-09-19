import { RamAllocation } from "@/components/launcher/ram-allocation"
import type { OnboardingCopy } from "./translations"

type StepMemoryProps = {
  copy: OnboardingCopy
  memoryMin: string
  memoryMax: string
  onChange: (min: string, max: string) => void
  onError: (msg: string) => void
}

export function StepMemory({ copy, memoryMax, onChange }: StepMemoryProps) {
  return (
    <div className="space-y-5">
      {/* Тот же блок, что в «Настройках»: со значком, без второго комплекта строк */}
      <RamAllocation
        memoryMax={memoryMax}
        onChange={(value) => onChange("512M", value)}
        variant="onboarding"
      />

      <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
        {copy.memoryHint}
      </div>
    </div>
  )
}
