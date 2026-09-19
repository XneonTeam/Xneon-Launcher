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
  variant?: "settings" | "onboarding"
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
    <div
      className={cn(
        "border border-border p-5 space-y-2.5",
        variant === "settings" ? "rounded-xl bg-muted/30" : "rounded-2xl bg-card",
      )}
    >
      <label className="block text-sm font-medium text-foreground">{t("settings.ram.allocated")}</label>
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
      <p className="text-xs text-muted-foreground">{t("settings.ram.desc")}</p>
    </div>
  )

  if (!withHeader) return <div className={className}>{block}</div>

  return (
    <section className={cn("space-y-4", className)}>
      <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
        <IconCpu className="w-5 h-5 text-primary" strokeWidth={1.75} />
        {t("settings.ram")}
      </h3>
      {block}
    </section>
  )
}
