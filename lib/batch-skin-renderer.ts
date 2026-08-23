import { SkinViewer, IdleAnimation } from "skinview3d"

interface RenderJob {
  id: string
  url: string
  slim: boolean
}

const PREVIEW_W = 300
const PREVIEW_H = 400

let _canvas: HTMLCanvasElement | null = null
let _viewer: SkinViewer | null = null

function getViewer(): SkinViewer {
  if (_viewer) return _viewer
  _canvas = document.createElement("canvas")
  _canvas.width = PREVIEW_W
  _canvas.height = PREVIEW_H
  _viewer = new SkinViewer({ canvas: _canvas, width: PREVIEW_W, height: PREVIEW_H })
  _viewer.animation = new IdleAnimation()
  _viewer.zoom = 0.72
  _viewer.autoRotate = false
  _viewer.camera.rotation.set(-0.1, 0.2, 0)
  return _viewer
}

async function renderOne(job: RenderJob): Promise<string> {
  const viewer = getViewer()
  const model = job.slim ? "slim" : "default"
  await viewer.loadSkin(job.url, { model })

  // Wait 2 frames for the scene to fully render
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

  return new Promise<string>(resolve => {
    _canvas!.toBlob(
      blob => {
        if (!blob) { resolve(""); return }
        resolve(URL.createObjectURL(blob))
      },
      "image/webp",
      0.9,
    )
  })
}

export async function batchRenderSkins(
  jobs: RenderJob[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  for (let i = 0; i < jobs.length; i++) {
    const blobUrl = await renderOne(jobs[i])
    if (blobUrl) results.set(jobs[i].id, blobUrl)
    onProgress?.(i + 1, jobs.length)
  }
  return results
}

export function disposeBatchRenderer() {
  _viewer?.dispose()
  _viewer = null
  _canvas = null
}
