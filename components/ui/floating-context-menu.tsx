import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** Общее меню по координатам курсора, независимое от прокрутки и transform родителей. */
export function FloatingContextMenu({ position, onClose, children, minWidth = 180 }: {
  position: { x: number; y: number }
  onClose: () => void
  children: ReactNode
  minWidth?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [point, setPoint] = useState(position)
  useLayoutEffect(() => {
    const place = () => {
      if (!ref.current) return
      setPoint({
        x: Math.max(8, Math.min(position.x, window.innerWidth - ref.current.offsetWidth - 8)),
        y: Math.max(8, Math.min(position.y, window.innerHeight - ref.current.offsetHeight - 8)),
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener("resize", place)
    return () => { observer.disconnect(); window.removeEventListener("resize", place) }
  }, [position.x, position.y])

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    document.addEventListener("mousedown", outside)
    document.addEventListener("contextmenu", outside)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("mousedown", outside)
      document.removeEventListener("contextmenu", outside)
      document.removeEventListener("keydown", key)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} data-slot="floating-context-menu"
      className="fixed z-50 max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
      style={{ left: point.x, top: point.y, minWidth }}
      onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
      {children}
    </div>, document.body,
  )
}
