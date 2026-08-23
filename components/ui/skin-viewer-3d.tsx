import { useRef, useEffect } from "react"
import { SkinViewer, IdleAnimation } from "skinview3d"
import { cn } from "@/lib/utils"

interface SkinViewer3DProps {
  skinUrl: string
  capeUrl?: string
  slim?: boolean
  width?: number
  height?: number
  className?: string
}

export function SkinViewer3D({ skinUrl, capeUrl, slim, width = 300, height = 400, className }: SkinViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const viewer = new SkinViewer({ canvas: canvasRef.current, width, height })
    viewer.animation = new IdleAnimation()
    viewerRef.current = viewer
    return () => { viewer.dispose(); viewerRef.current = null }
  }, [width, height])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !skinUrl) return
    viewer.loadSkin(skinUrl, { model: slim === undefined ? "auto-detect" : slim ? "slim" : "default" })
  }, [skinUrl, slim])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (capeUrl) viewer.loadCape(capeUrl)
    else viewer.resetCape()
  }, [capeUrl])

  return <canvas ref={canvasRef} className={cn("rounded-xl", className)} />
}
