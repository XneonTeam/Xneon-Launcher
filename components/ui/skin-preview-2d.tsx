import { useRef, useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface SkinPreview2DProps {
  textureUrl: string
  width?: number
  height?: number
  className?: string
  slim?: boolean
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load skin image: ${url}`))
    img.src = url
  })
}

/**
 * 2D front-facing preview of a Minecraft skin texture.
 *
 * UV coordinates for the classic (Steve) model, 64×64 texture:
 *
 *   Head front:   (8,  8,  8, 8)
 *   Body front:   (20, 20, 8, 12)
 *   R arm front:  (4,  20, 4, 12)
 *   L arm front:  (44, 20, 4, 12)
 *   R leg front:  (4,  20, 4, 12) — shares UV with R arm in64×32
 *   L leg front:  (44, 20, 4, 12) — shares UV with L arm in64×32
 *
 * Rendered grid (in texture-pixel units, 16 wide × 32 tall):
 *
 *        [HEAD 8×8]
 *   [RA 4×12][BODY 8×12][LA 4×12]
 *        [RL 4×12][LL 4×12]
 */
export function SkinPreview2D({
  textureUrl,
  width = 128,
  height = 256,
  className,
  slim,
}: SkinPreview2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  const draw = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !textureUrl) return

    setStatus("loading")

    try {
      const img = await loadImage(textureUrl)

      const ctx = canvas.getContext("2d")
      if (!ctx) return

      canvas.width = width
      canvas.height = height

      ctx.imageSmoothingEnabled = false

      const texW = img.naturalWidth
      const texH = img.naturalHeight

      // Grid: 16 texture-pixels wide, 32 tall
      const gridW = slim ? 15 : 16
      const gridH = 32
      const scale = Math.min(width / gridW, height / gridH)
      const offsetX = (width - gridW * scale) / 2
      const offsetY = (height - gridH * scale) / 2

      ctx.clearRect(0, 0, width, height)

      // ── Head ──────────────────────────────────────────────
      // Front face: (8, 8, 8, 8) → grid (4, 0)
      ctx.drawImage(img, 8, 8, 8, 8,
        offsetX + 4 * scale, offsetY,
        8 * scale, 8 * scale)

      // ── Body ──────────────────────────────────────────────
      // Front face: (20, 20, 8, 12) → grid (4, 8)
      ctx.drawImage(img, 20, 20, 8, 12,
        offsetX + 4 * scale, offsetY + 8 * scale,
        8 * scale, 12 * scale)

      // ── Arms ──────────────────────────────────────────────
      if (slim) {
        // Slim (Alex) model — 3-pixel-wide arms
        // Right arm front: (44, 20, 3, 12) → grid (0, 8)
        ctx.drawImage(img, 44, 20, 3, 12,
          offsetX, offsetY + 8 * scale,
          3 * scale, 12 * scale)
        // Left arm front: (36, 20, 3, 12) → grid (12, 8)
        ctx.drawImage(img, 36, 20, 3, 12,
          offsetX + 12 * scale, offsetY + 8 * scale,
          3 * scale, 12 * scale)
      } else {
        // Classic (Steve) model — 4-pixel-wide arms
        // Right arm front: (4, 20, 4, 12) → grid (0, 8)
        ctx.drawImage(img, 4, 20, 4, 12,
          offsetX, offsetY + 8 * scale,
          4 * scale, 12 * scale)
        // Left arm front: (44, 20, 4, 12) → grid (12, 8)
        ctx.drawImage(img, 44, 20, 4, 12,
          offsetX + 12 * scale, offsetY + 8 * scale,
          4 * scale, 12 * scale)
      }

      // ── Legs ──────────────────────────────────────────────
      // In 64×32 / 64×64 base-layer, legs share UV with arms.
      // Right leg front: (4, 20, 4, 12) → grid (4, 20)
      // Left  leg front: (44, 20, 4, 12) → grid (8, 20)
      if (slim) {
        ctx.drawImage(img, 4, 20, 4, 12,
          offsetX + 4 * scale, offsetY + 20 * scale,
          4 * scale, 12 * scale)
        ctx.drawImage(img, 44, 20, 4, 12,
          offsetX + 8 * scale, offsetY + 20 * scale,
          4 * scale, 12 * scale)
      } else {
        ctx.drawImage(img, 4, 20, 4, 12,
          offsetX + 4 * scale, offsetY + 20 * scale,
          4 * scale, 12 * scale)
        ctx.drawImage(img, 44, 20, 4, 12,
          offsetX + 8 * scale, offsetY + 20 * scale,
          4 * scale, 12 * scale)
      }

      // ── Overlay (64×64 second layer) ──────────────────────
      if (texH >= 64) {
        ctx.globalAlpha = 1

        // Head overlay: (8, 40, 8, 8)
        ctx.drawImage(img, 8, 40, 8, 8,
          offsetX + 4 * scale, offsetY,
          8 * scale, 8 * scale)

        // Body overlay: (20, 52, 8, 12)
        ctx.drawImage(img, 20, 52, 8, 12,
          offsetX + 4 * scale, offsetY + 8 * scale,
          8 * scale, 12 * scale)

        if (slim) {
          ctx.drawImage(img, 44, 52, 3, 12,
            offsetX, offsetY + 8 * scale,
            3 * scale, 12 * scale)
          ctx.drawImage(img, 36, 52, 3, 12,
            offsetX + 12 * scale, offsetY + 8 * scale,
            3 * scale, 12 * scale)
        } else {
          ctx.drawImage(img, 4, 52, 4, 12,
            offsetX, offsetY + 8 * scale,
            4 * scale, 12 * scale)
          ctx.drawImage(img, 44, 52, 4, 12,
            offsetX + 12 * scale, offsetY + 8 * scale,
            4 * scale, 12 * scale)
        }

        // Leg overlays: (4, 52, 4, 12) and (44, 52, 4, 12)
        ctx.drawImage(img, 4, 52, 4, 12,
          offsetX + 4 * scale, offsetY + 20 * scale,
          4 * scale, 12 * scale)
        ctx.drawImage(img, 44, 52, 4, 12,
          offsetX + 8 * scale, offsetY + 20 * scale,
          4 * scale, 12 * scale)
      }

      setStatus("ready")
    } catch {
      setStatus("error")
    }
  }, [textureUrl, width, height, slim])

  useEffect(() => {
    let cancelled = false
    void draw().then(() => {})
    return () => { cancelled = true }
  }, [draw])

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="block h-full w-full"
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/50 text-xs text-neutral-400">
          Loading…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/50 text-xs text-red-400">
          Failed to load
        </div>
      )}
    </div>
  )
}
