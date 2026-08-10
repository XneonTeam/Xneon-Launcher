import { cn } from "@/lib/utils"

interface MemorySliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  snapPoints?: number[]
  snapRange?: number
  unit?: string
}

export function MemorySlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 10,
  snapPoints = [],
  snapRange = 100,
  unit = "",
}: MemorySliderProps) {
  const clamped = Math.max(min, Math.min(value, max))

  const applyValue = (raw: number) => {
    let next = Number.isFinite(raw) && raw ? raw : min
    next -= next % step
    next = Math.max(min, Math.min(next, max))
    onChange(next)
  }

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let parsed = Number.parseInt(e.target.value, 10)
    for (const point of snapPoints) {
      if (Math.abs(point - parsed) < snapRange) parsed = point
    }
    applyValue(parsed)
  }

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    applyValue(Number.parseInt(e.target.value, 10))
  }

  const fillPercent = ((clamped - min) / (max - min)) * 100
  const visibleSnapPoints = snapPoints.filter((point) => point >= min && point <= max)

  return (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1">
        <div className="absolute top-0 h-1/2 w-full">
          <div className="relative inline-block align-middle w-[calc(100%-0.75rem)] h-3 left-[calc(0.75rem/2)]">
            {visibleSnapPoints.map((point) => (
              <div
                key={point}
                className="absolute inline-block w-1 h-full rounded-sm -translate-x-1/2"
                style={{
                  left: `${((point - min) / (max - min)) * 100}%`,
                  backgroundColor: point <= clamped ? "var(--primary)" : "var(--border)",
                }}
              />
            ))}
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          onChange={handleRangeChange}
          className="launcher-range relative rounded-sm h-1 w-full p-0 min-h-0 shadow-none outline-none align-middle appearance-none"
          style={{
            "--current-value": clamped,
            "--min-value": min,
            "--max-value": max,
          } as React.CSSProperties}
        />
        <div className="flex flex-row justify-between text-xs m-0">
          <span>{min} {unit}</span>
          <span>{max} {unit}</span>
        </div>
      </div>
      <div className={cn("flex items-center rounded-xl border border-border bg-input/60 px-2 h-10 w-24 shrink-0")}>
        <input
          type="number"
          value={clamped}
          min={min}
          max={max}
          step={step}
          onChange={handleNumberChange}
          className="w-full bg-transparent text-foreground text-sm outline-none"
        />
        {unit && <span className="text-xs text-muted-foreground ml-1 shrink-0">{unit}</span>}
      </div>
    </div>
  )
}
