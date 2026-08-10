import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { memoryToMb, mbToMemory } from "@/lib/memory"
import type { OnboardingCopy } from "./translations"

type StepMemoryProps = {
  copy: OnboardingCopy
  memoryMin: string
  memoryMax: string
  onChange: (min: string, max: string) => void
  onError: (msg: string) => void
}

export function StepMemory({ copy, memoryMax, onChange }: StepMemoryProps) {
  const { maxMb, snapPoints } = useMemoryOptions()

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-2.5">
        <span className="text-sm font-medium text-foreground">Memory allocated</span>
        <MemorySlider
          value={memoryToMb(memoryMax)}
          min={512}
          max={maxMb}
          step={64}
          snapPoints={snapPoints}
          snapRange={512}
          unit="MB"
          onChange={(v) => onChange("512M", mbToMemory(v))}
        />
        <p className="text-xs text-muted-foreground">Maximum memory available to Minecraft.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
        {copy.memoryHint}
      </div>
    </div>
  )
}
