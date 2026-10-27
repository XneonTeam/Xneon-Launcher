import { useRef, useEffect } from "react"
import { SkinViewer, IdleAnimation } from "skinview3d"
import { cn } from "@/lib/utils"

interface SkinViewer3DProps {
  skinUrl: string
  capeUrl?: string
  slim?: boolean
  /**
   * Чем показывать «спинную» экипировку: плащом или элитрой. В Minecraft элитра
   * рендерится из той же текстуры, что и плащ, поэтому отдельная загрузка не
   * нужна — skinview3d переиспользует её (BackEquipment).
   */
  backEquipment?: "cape" | "elytra"
  /**
   * Развернуть модель спиной к камере. Плащ и элитра находятся за спиной, и в
   * положении анфас их не видно вообще — при включении элитры вьюер
   * автоматически показывает персонажа со спины.
   */
  faceBack?: boolean
  width?: number
  height?: number
  className?: string
}

export function SkinViewer3D({ skinUrl, capeUrl, slim, backEquipment = "cape", faceBack = false, width = 300, height = 400, className }: SkinViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const viewer = new SkinViewer({ canvas: canvasRef.current, width, height })
    viewer.animation = new IdleAnimation()
    viewerRef.current = viewer
    const defaults = { zoom: viewer.zoom, fov: viewer.fov, global: viewer.globalLight.intensity, camera: viewer.cameraLight.intensity }
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
    // CSS управляет параметрами сцены через явный мост, без доступа к объектам WebGL.
    const applyAppearance = () => {
      if (!canvasRef.current) return
      const styles = getComputedStyle(canvasRef.current)
      const number = (key: string, fallback: number, min: number, max: number) => {
        const raw = styles.getPropertyValue(key).trim(), value = Number(raw)
        return raw && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
      }
      viewer.zoom = number("--skin-zoom", defaults.zoom, 0.2, 3)
      viewer.fov = number("--skin-fov", defaults.fov, 20, 110)
      viewer.globalLight.intensity = number("--skin-global-light", defaults.global, 0, 3)
      viewer.cameraLight.intensity = number("--skin-camera-light", defaults.camera, 0, 3)
      if (viewer.animation) viewer.animation.speed = reducedMotion.matches ? 0 : number("--skin-animation-speed", 1, 0, 3)
    }
    applyAppearance()
    window.addEventListener("theme:applied", applyAppearance)
    window.addEventListener("resize", applyAppearance)
    reducedMotion.addEventListener("change", applyAppearance)
    return () => {
      window.removeEventListener("theme:applied", applyAppearance)
      window.removeEventListener("resize", applyAppearance)
      reducedMotion.removeEventListener("change", applyAppearance)
      viewer.dispose(); viewerRef.current = null
    }
  }, [])

  // Resize the existing renderer instead of disposing and recreating it.
  // Recreating on every window resize cleared the model, while the skin-load
  // effect did not rerun because skinUrl and slim had not changed.
  useEffect(() => {
    viewerRef.current?.setSize(width, height)
  }, [width, height])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !skinUrl) return
    viewer.loadSkin(skinUrl, { model: slim === undefined ? "auto-detect" : slim ? "slim" : "default" })
  }, [skinUrl, slim])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (capeUrl) {
      // backEquipment переключает плащ/элитру на уже загруженной текстуре,
      // поэтому эффект зависит и от него: иначе переключение не применится.
      void viewer.loadCape(capeUrl, { backEquipment })
    } else {
      viewer.resetCape()
    }
  }, [capeUrl, backEquipment])

  /**
   * Разворот спиной: плащ и элитра висят за спиной, анфас их не видно.
   * Крутим `playerWrapper` (саму модель), а не камеру: у OrbitControls этой
   * версии three нет setAzimuthalAngle, а поворот модели не ломает управление
   * мышью — пользователь по-прежнему может вращать вьюер сам.
   */
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.playerWrapper.rotation.y = faceBack ? Math.PI : 0
  }, [faceBack])

  return <canvas data-ui="ui-skin-viewer-3d-canvas-1" ref={canvasRef} className={cn("rounded-xl", className)} />
}
