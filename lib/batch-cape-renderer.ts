function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${url}`))
    img.src = url
  })
}

const OUT_W = 144
const OUT_H = 224

async function renderCape(capeUrl: string): Promise<string> {
  try {
    const img = await loadImage(capeUrl)
    const canvas = document.createElement("canvas")
    canvas.width = OUT_W
    canvas.height = OUT_H
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""

    ctx.imageSmoothingEnabled = false

    const texW = img.naturalWidth
    const texH = img.naturalHeight

    // Cape front panel: pixels (1,1) size (10,16) on a 64×32 texture
    const srcX = 1
    const srcY = 1
    const srcW = 10
    const srcH = 16

    const scale = Math.min(OUT_W / srcW, OUT_H / srcH)
    const drawW = srcW * scale
    const drawH = srcH * scale
    const offsetX = (OUT_W - drawW) / 2
    const offsetY = (OUT_H - drawH) / 2

    ctx.drawImage(img, srcX, srcY, srcW, srcH, offsetX, offsetY, drawW, drawH)

    return canvas.toDataURL("image/png")
  } catch {
    return ""
  }
}

export async function batchRenderCapes(
  capes: Array<{ id: string; url: string }>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  for (const cape of capes) {
    if (!cape.url) continue
    const dataUrl = await renderCape(cape.url)
    if (dataUrl) results.set(cape.id, dataUrl)
  }
  return results
}
