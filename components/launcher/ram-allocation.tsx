import { useTranslation } from "react-i18next"
import { IconCpu } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { MemorySlider } from "@/components/ui/memory-slider"
import { useMemoryOptions } from "@/src/hooks/use-memory-options"
import { memoryToMb, mbToMemory } from "@/lib/memory"

interface RamAllocationProps {
  /** Текущий максимум памяти («4G»). */
  memoryMax: string
  onChange: (memoryMax: string) => void
  /**
   * settings   — как блок в «Настройках»: приглушённый фон, скругление поменьше;
   * onboarding — как блоки в первоначальной настройке: карточка.
   */
  variant?: "settings" | "onboarding" | "settings-panel"
  /** Заголовок «Оперативная память» со значком процессора. */
  withHeader?: boolean
  className?: string
}

/**
 * Выделение оперативной памяти: один блок на «Настройки» и на первоначальную
 * настройку, чтобы ползунок, подписи и поведение не разъезжались между ними.
 */
export function RamAllocation({
  memoryMax,
  onChange,
  variant = "settings",
  withHeader = true,
  className,
}: RamAllocationProps) {
  const { t } = useTranslation()
  const { maxMb, snapPoints } = useMemoryOptions()

  const block = (
    <div data-ui="ram-allocation-div-1"
      className={cn(
        "space-y-2.5",
        variant === "settings-panel" ? "border-0 bg-transparent p-0" : "border border-border p-5",
        variant === "settings" ? "rounded-xl bg-muted/30" : variant === "onboarding" ? "rounded-2xl bg-card" : "",
      )}
    >
      <label data-ui="ram-allocation-label-1" className="block text-sm font-medium text-foreground">{t("settings.ram.allocated")}</label>
      <MemorySlider
        value={memoryToMb(memoryMax)}
        min={512}
        max={maxMb}
        step={64}
        snapPoints={snapPoints}
        snapRange={512}
        unit="MB"
        onChange={(value) => onChange(mbToMemory(value))}
      />
      <p data-ui="ram-allocation-p-1" className="text-xs text-muted-foreground">{t("settings.ram.desc")}</p>
    </div>
  )

  if (!withHeader) return <div data-ui="ram-allocation-div-2" data-component="ram-allocation" className={className}>{block}</div>

  return (
    <section data-ui="ram-allocation-section-1" data-component="ram-allocation" className={cn("space-y-4", variant === "settings-panel" && "rounded-xl border border-border bg-card p-[18px]", className)}>
      <h3 data-ui="ram-allocation-h3-1" className={cn("font-medium text-foreground flex items-center gap-2", variant === "settings-panel" ? "text-[13px] font-semibold leading-[1.5]" : "text-lg")}>
        <IconCpu className={cn("text-primary", variant === "settings-panel" ? "w-4 h-4" : "w-5 h-5")} strokeWidth={1.75} />
        {t("settings.ram")}
      </h3>
      {block}
    </section>
  )
}
