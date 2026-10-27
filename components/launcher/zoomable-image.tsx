import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconZoomIn, IconZoomOut, IconZoomReset } from "@tabler/icons-react"

/** Масштаб относительно вписанного изображения; перетаскивание доступно при увеличении. */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }) }
  const changeZoom = (factor: number) => {
    setZoom(value => Math.min(5, Math.max(0.5, value * factor)))
    setOffset({ x: 0, y: 0 })
  }
  const buttonClass = "flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-muted disabled:opacity-30"

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <div className="flex h-full w-full touch-none items-center justify-center overflow-hidden"
        style={{ cursor: zoom > 1 ? "grab" : "default" }}
        onWheel={event => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15) }}
        onDoubleClick={reset}
        onPointerDown={event => {
          if (zoom <= 1 || event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y }
        }}
        onPointerMove={event => {
          if (drag.current) setOffset({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}>
        <img src={src} alt={alt} draggable={false}
          className="max-h-full max-w-full select-none rounded-xl object-contain shadow-2xl"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />
      </div>
      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-lg">
        <button type="button" className={buttonClass} disabled={zoom <= 0.5} onClick={() => changeZoom(1 / 1.25)} title={t("screenshots.zoomOut")} aria-label={t("screenshots.zoomOut")}><IconZoomOut className="size-5" /></button>
        <span className="w-14 text-center text-xs tabular-nums text-foreground" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className={buttonClass} disabled={zoom >= 5} onClick={() => changeZoom(1.25)} title={t("screenshots.zoomIn")} aria-label={t("screenshots.zoomIn")}><IconZoomIn className="size-5" /></button>
        <button type="button" className={buttonClass} onClick={reset} title={t("screenshots.resetZoom")} aria-label={t("screenshots.resetZoom")}><IconZoomReset className="size-5" /></button>
      </div>
    </div>
  )
}
