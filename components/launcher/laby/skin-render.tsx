import { useState } from "react"
import { cn } from "@/lib/utils"
import { IconUser } from "@tabler/icons-react"
import type { LabySkin } from "@xnlc/types"

/**
 * Превью скина с CDN Laby.
 *
 * `renderUrl` отдаёт готовый PNG 256×256, поэтому карточки каталога не
 * занимают WebGL-контексты (их в лаунчере ограниченное число) и не тянут
 * текстуры через IPC. Рендер кросс-доменный, но это обычный `<img>` —
 * CORS для показа не нужен.
 */
export function SkinRender({
  skin,
  alt = "",
  className,
}: {
  skin: Pick<LabySkin, "renderUrl" | "name">
  alt?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!skin.renderUrl || failed) {
    return (
      <div className={cn("grid h-full w-full place-items-center", className)}>
        <IconUser className="h-1/3 max-h-10 w-1/3 max-w-10 text-muted-foreground/20" strokeWidth={1} />
      </div>
    )
  }

  return (
    <img
      src={skin.renderUrl}
      alt={alt || skin.name}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("h-full w-full object-contain", className)}
    />
  )
}