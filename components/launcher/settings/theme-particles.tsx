import { useEffect, useRef } from "react"

export function ThemeParticles({ color, style, paused }: { color: string; style: "stars" | "snow" | "network"; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!element || !context) return
    let width = innerWidth, height = innerHeight, frame = 0, last = 0
    const pointer = { x: -1000, y: -1000 }
    const particles = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), speed: 0.01 + Math.random() * 0.02, size: 0.6 + Math.random() * 1.8 }))
    const resize = () => {
      width = innerWidth; height = innerHeight
      const ratio = Math.min(devicePixelRatio || 1, 2)
      element.width = width * ratio; element.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const move = (event: PointerEvent) => { pointer.x = event.clientX; pointer.y = event.clientY }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const render = (now: number) => {
      const delta = Math.min((now - (last || now)) / 1000, 0.05); last = now
      context.clearRect(0, 0, width, height)
      context.fillStyle = color; context.strokeStyle = color
      for (const particle of particles) {
        if (!paused && !reduced.matches) particle.y = (particle.y + delta * particle.speed) % 1
        const x = particle.x * width, y = particle.y * height
        context.globalAlpha = style === "snow" ? 0.65 : 0.4
        context.beginPath(); context.arc(x, y, particle.size, 0, Math.PI * 2); context.fill()
        if (style === "network" && Math.hypot(x - pointer.x, y - pointer.y) < 160) {
          context.globalAlpha = 0.2; context.beginPath(); context.moveTo(x, y); context.lineTo(pointer.x, pointer.y); context.stroke()
        }
      }
      if (!paused && !reduced.matches) frame = requestAnimationFrame(render)
    }
    resize(); render(0)
    window.addEventListener("resize", resize); window.addEventListener("pointermove", move)
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); window.removeEventListener("pointermove", move) }
  }, [color, style, paused])
  return <canvas data-ui="theme-particles" data-component="theme-particles" ref={canvas} className="h-full w-full" />
}
