// ============================================================
// XNLC — иконка элитры
// ============================================================
//
// Точная копия официальной текстуры предмета: пиксели и цвета взяты из
// открытого набора minecraft-items-react (MIT), где иконка элитры собрана
// попиксельно по текстуре игры (16×16, 8 цветов).
//
// В компоненте соседние пиксели одного цвета объединены в горизонтальные
// полосы (path на цвет), поэтому иконка весит ~2 КБ и не тянет внешних файлов.
// Прежний набросок формы заменён: он лишь отдалённо напоминал элитру, здесь
// силуэт и затенение такие же, как в игре.

import { cn } from "@/lib/utils"

/** Полосы по цветам: один path на цвет. */
const ELYTRA_PATHS: Array<{ color: string; opacity?: number; d: string }> = [
  { color: "rgb(75,75,75)", d: "M4 2h3v1h-3zM9 2h3v1h-3zM2 3h2v1h-2zM6 3h4v1h-4zM12 3h2v1h-2zM1 4h1v1h-1zM9 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM9 5h1v1h-1zM1 6h1v1h-1zM9 6h1v1h-1zM1 7h1v1h-1zM9 7h1v1h-1zM1 8h1v1h-1zM9 8h1v1h-1zM1 9h1v1h-1zM9 9h1v1h-1zM13 9h1v1h-1zM2 10h1v1h-1z" },
  { color: "rgb(53,53,53)", d: "M7 2h2v1h-2zM6 4h1v1h-1zM6 5h1v1h-1zM14 5h1v1h-1zM6 6h1v1h-1zM14 6h1v1h-1zM6 7h1v1h-1zM14 7h1v1h-1zM6 8h1v1h-1zM14 8h1v1h-1zM6 9h1v1h-1zM14 9h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM13 10h1v1h-1zM2 11h1v1h-1zM6 11h1v1h-1zM9 11h1v1h-1zM13 11h1v1h-1zM3 12h1v1h-1zM5 12h1v1h-1zM10 12h1v1h-1zM12 12h1v1h-1zM3 13h2v1h-2zM11 13h2v1h-2z" },
  { color: "rgb(127,127,152)", d: "M5 3h1v1h-1zM10 3h1v1h-1zM3 4h1v1h-1zM12 4h1v1h-1zM2 5h1v1h-1zM13 5h1v1h-1zM4 6h2v1h-2zM10 6h2v1h-2zM3 7h2v1h-2zM11 7h2v1h-2zM2 8h1v1h-1zM13 8h1v1h-1z" },
  { color: "rgb(115,115,115)", d: "M4 3h1v1h-1zM11 3h1v1h-1zM2 4h1v1h-1zM13 4h1v1h-1zM2 7h1v1h-1zM13 7h1v1h-1zM3 8h2v1h-2zM11 8h2v1h-2zM3 9h1v1h-1zM12 9h1v1h-1zM5 10h1v1h-1zM10 10h1v1h-1z" },
  { color: "rgb(112,110,141)", d: "M5 7h1v1h-1zM10 7h1v1h-1zM5 8h1v1h-1zM10 8h1v1h-1zM4 9h2v1h-2zM10 9h2v1h-2zM4 10h1v1h-1zM11 10h1v1h-1zM4 11h1v1h-1zM11 11h1v1h-1z" },
  { color: "rgb(105,105,105)", d: "M2 9h1v1h-1zM3 10h1v1h-1zM12 10h1v1h-1zM3 11h1v1h-1zM5 11h1v1h-1zM10 11h1v1h-1zM12 11h1v1h-1zM4 12h1v1h-1zM11 12h1v1h-1z" },
  { color: "rgb(140,140,140)", d: "M3 5h2v1h-2zM11 5h2v1h-2zM2 6h2v1h-2zM12 6h2v1h-2z" },
  { color: "rgb(143,143,179)", d: "M4 4h2v1h-2zM10 4h2v1h-2zM5 5h1v1h-1zM10 5h1v1h-1z" },
]

interface ElytraIconProps {
  className?: string
}

export function ElytraIcon({ className }: ElytraIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      // Пиксельный арт: без сглаживания, иначе пиксели «плывут».
      shapeRendering="crispEdges"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {ELYTRA_PATHS.map((path, index) => (
        <path key={index} fill={path.color} fillOpacity={path.opacity} d={path.d} />
      ))}
    </svg>
  )
}
