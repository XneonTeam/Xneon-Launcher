import { useRef, useEffect } from "react"
import * as THREE from "three"
import { cn } from "@/lib/utils"

interface CapePreview3DProps {
  capeUrl: string
  width?: number
  height?: number
  className?: string
}

export function CapePreview3D({ capeUrl, width = 60, height = 96, className }: CapePreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = width * 2
    const h = height * 2

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
    renderer.setSize(w, h)
    renderer.setPixelRatio(1)
    renderer.setClearColor(0x000000, 0)

    container.innerHTML = ""
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(18, w / h, 0.1, 100)
    camera.position.set(0, 0.3, 10)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 1.2))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(2, 4, 5)
    scene.add(dirLight)

    const capeRatio = 10 / 16
    const planeH = 6.5
    const planeW = planeH * capeRatio
    const segments = 16

    const geometry = new THREE.PlaneGeometry(planeW, planeH, segments, segments)

    let mesh: THREE.Mesh | null = null
    const textureLoader = new THREE.TextureLoader()
    textureLoader.crossOrigin = "anonymous"
    textureLoader.load(capeUrl, (texture) => {
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter

      const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute
      for (let i = 0; i < uvAttr.count; i++) {
        const u = uvAttr.getX(i)
        const v = uvAttr.getY(i)
        uvAttr.setXY(i, (1 / 64) + u * (10 / 64), (1 / 32) + v * (16 / 32))
      }
      uvAttr.needsUpdate = true

      const material = new THREE.MeshPhongMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
      })

      mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -0.1
      scene.add(mesh)
    })

    let t = 0
    function animate() {
      frameRef.current = requestAnimationFrame(animate)
      t += 0.018

      if (mesh) {
        const pos = geometry.getAttribute("position") as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i)
          const normY = (y + planeH / 2) / planeH
          const wave = Math.sin(t + normY * 3.5) * 0.15 * normY
          pos.setZ(i, wave)
        }
        pos.needsUpdate = true
        mesh.rotation.y = Math.sin(t * 0.4) * 0.15
      }

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameRef.current)
      renderer.dispose()
      geometry.dispose()
      container.innerHTML = ""
    }
  }, [capeUrl, width, height])

  return (
    <div
      ref={containerRef}
      className={cn("rounded-lg overflow-hidden", className)}
      style={{ width, height }}
    />
  )
}
