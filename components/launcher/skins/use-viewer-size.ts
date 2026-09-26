import { useEffect, useRef, useState } from "react"

/**
 * Размер 3D-вьюера под контейнер.
 *
 * Canvas у skinview3d создаётся с явными width/height, поэтому фиксированные
 * 300×400 в оконном режиме (1280×800) обрезались: колонке по высоте остаётся
 * меньше. Меряем контейнер ResizeObserver'ом.
 *
 * Раньше это был один и тот же хук, скопированный в панель «Избранного» и в
 * панель каталога.
 */
export function useViewerSize(fallback = { width: 248, height: 280 }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(fallback)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const width = Math.max(140, Math.round(rect.width))
      const height = Math.max(160, Math.round(rect.height))
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}