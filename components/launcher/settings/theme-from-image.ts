import type { ThemeColorKey } from "./types"

/**
 * Палитра из картинки.
 *
 * Пользователь выбирает обои, а мы собираем из них полноценную тему: фон —
 * самый тёмный доминирующий оттенок, акценты — самые насыщенные кластеры.
 * Схема получается аналоговой (акцент = соседний оттенок фона), поэтому цвета
 * не спорят друг с другом, как случилось бы при случайной паре.
 *
 * Байты картинки приходят из main (`theme:read-media`): из http-ссылки canvas
 * не отдал бы пиксели из-за CORS, а local file:// недоступен в окне лаунчера.
 */

type Rgb = { r: number; g: number; b: number }
type Hsl = { h: number; s: number; l: number }

const SAMPLE_SIZE = 48
const MAX_SOURCE_BYTES = 16 * 1024 * 1024

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function rgbToHex({ r, g, b }: Rgb): string {
  const hex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

function hslToHex({ h, s, l }: Hsl): string {
  const hn = ((h % 360) + 360) % 360
  const sn = clamp(s, 0, 1)
  const ln = clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2
  let rgb: [number, number, number]
  if (hn < 60) rgb = [c, x, 0]
  else if (hn < 120) rgb = [x, c, 0]
  else if (hn < 180) rgb = [0, c, x]
  else if (hn < 240) rgb = [0, x, c]
  else if (hn < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgbToHex({ r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 })
}

function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** Загружает картинку (или кадр видео) в canvas и отдаёт пиксели. */
async function loadPixels(dataUrl: string, kind: "image" | "video"): Promise<Rgb[] | null> {
  const canvas = document.createElement("canvas")
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null

  const draw = (source: CanvasImageSource, width: number, height: number) => {
    // Вписываем по короткой стороне, чтобы не растянуть пропорции.
    const scale = Math.max(SAMPLE_SIZE / Math.max(1, width), SAMPLE_SIZE / Math.max(1, height))
    const drawWidth = width * scale
    const drawHeight = height * scale
    context.drawImage(source, (SAMPLE_SIZE - drawWidth) / 2, (SAMPLE_SIZE - drawHeight) / 2, drawWidth, drawHeight)
  }

  if (kind === "video") {
    const video = document.createElement("video")
    // Picked theme videos use the `xnl-theme:` origin. Set CORS mode before
    // assigning src so the sampled frame remains readable by canvas.
    video.crossOrigin = "anonymous"
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    const readyPromise = new Promise<boolean>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const done = (value: boolean) => {
        if (timeout !== undefined) clearTimeout(timeout)
        video.onloadeddata = null
        video.onseeked = null
        video.onerror = null
        resolve(value)
      }
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(1, (video.duration || 1) / 3)
        } catch {
          done(true)
        }
      }
      video.onseeked = () => done(true)
      video.onerror = () => done(false)
      timeout = setTimeout(() => done(video.videoWidth > 0), 8000)
      video.src = dataUrl
    })
    const ready = await readyPromise
    if (!ready || !video.videoWidth) return null
    draw(video, video.videoWidth, video.videoHeight)
  } else {
    const image = document.createElement("img")
    image.crossOrigin = "anonymous"
    image.src = dataUrl
    const ready = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      setTimeout(() => resolve(false), 8000)
    })
    if (!ready || !image.naturalWidth) return null
    draw(image, image.naturalWidth, image.naturalHeight)
  }

  let data: Uint8ClampedArray
  try {
    data = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } catch {
    return null
  }

  const pixels: Rgb[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] })
  }
  return pixels.length ? pixels : null
}

/** Доминирующие цвета: квантование по 4 бита на канал, затем топ по частоте. */
function dominantColors(pixels: Rgb[], limit: number): Rgb[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  for (const pixel of pixels) {
    const key = ((pixel.r >> 4) << 8) | ((pixel.g >> 4) << 4) | (pixel.b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.r += pixel.r
      bucket.g += pixel.g
      bucket.b += pixel.b
    } else {
      buckets.set(key, { count: 1, r: pixel.r, g: pixel.g, b: pixel.b })
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((bucket) => ({
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
    }))
}

/** Насыщенность с поправкой на яркость: тёмные цвета визуально «глуше». */
function vividness(color: Hsl): number {
  return color.s * (0.35 + 0.65 * Math.min(1, color.l * 1.6))
}

/**
 * Собирает палитру темы из картинки.
 * `null` — картинку не удалось прочитать (битый файл, ссылка без CORS, видео без кадра).
 */
export async function themePaletteFromImage(
  source: string,
  options?: { kind?: "image" | "video" },
): Promise<Partial<Record<ThemeColorKey, string>> | null> {
  const target = typeof source === "string" ? source.trim() : ""
  if (!target) return null
  const kind = options?.kind === "video" ? "video" : "image"

  let dataUrl: string | null = null
  if (target.startsWith("data:") || target.startsWith("xnl-theme:")) {
    dataUrl = target
  } else {
    dataUrl = (await window.electronAPI?.readThemeMedia(target, MAX_SOURCE_BYTES)) ?? null
  }
  if (!dataUrl) return null

  const pixels = await loadPixels(dataUrl, kind)
  if (!pixels) return null

  const clusters = dominantColors(pixels, 10)
  if (!clusters.length) return null

  const withHsl = clusters.map((rgb) => ({ rgb, hsl: rgbToHsl(rgb), lum: luminance(rgb) }))
  // Фон — из тёмной части палитры картинки; если она вся светлая, берём самый тёмный кластер.
  const darkest = [...withHsl].sort((a, b) => a.lum - b.lum)[0]
  const baseHue = darkest.hsl.h
  const baseSat = clamp(darkest.hsl.s * 0.55, 0.08, 0.3)

  const accents = [...withHsl]
    .filter((entry) => entry.lum > 0.02 && entry.lum < 0.85)
    .sort((a, b) => vividness(b.hsl) - vividness(a.hsl))

  const primarySource = accents[0] ?? darkest
  const primaryHue = primarySource.hsl.h
  // Акцент — соседний оттенок: аналоговая схема выглядит цельно.
  const accentSource =
    accents.find((entry) => Math.abs(entry.hsl.h - primaryHue) > 25) ?? accents[1] ?? primarySource
  const accentHue = accentSource.hsl.h

  const surface = (lightness: number, saturation = baseSat): string =>
    hslToHex({ h: baseHue, s: saturation, l: lightness })

  const palette: Partial<Record<ThemeColorKey, string>> = {
    background: surface(0.07),
    foreground: hslToHex({ h: baseHue, s: 0.12, l: 0.96 }),
    card: surface(0.1),
    cardForeground: hslToHex({ h: baseHue, s: 0.12, l: 0.96 }),
    muted: surface(0.13),
    mutedForeground: hslToHex({ h: baseHue, s: 0.12, l: 0.64 }),
    border: surface(0.2),
    input: surface(0.11),
    primary: hslToHex({ h: primaryHue, s: clamp(primarySource.hsl.s, 0.45, 0.9), l: 0.63 }),
    primaryForeground: hslToHex({ h: primaryHue, s: 0.35, l: 0.12 }),
    accent: hslToHex({ h: accentHue, s: clamp(accentSource.hsl.s, 0.4, 0.9), l: 0.66 }),
    accentForeground: hslToHex({ h: accentHue, s: 0.35, l: 0.12 }),
    ring: hslToHex({ h: primaryHue, s: clamp(primarySource.hsl.s, 0.45, 0.9), l: 0.63 }),
    sidebar: surface(0.04),
    sidebarForeground: hslToHex({ h: baseHue, s: 0.12, l: 0.86 }),
    sidebarPrimary: hslToHex({ h: primaryHue, s: clamp(primarySource.hsl.s, 0.45, 0.9), l: 0.63 }),
    sidebarPrimaryForeground: hslToHex({ h: primaryHue, s: 0.35, l: 0.12 }),
    sidebarAccent: hslToHex({ h: accentHue, s: clamp(accentSource.hsl.s, 0.4, 0.9), l: 0.66 }),
    sidebarAccentForeground: hslToHex({ h: accentHue, s: 0.35, l: 0.12 }),
    sidebarBorder: surface(0.14),
  }

  return palette
}
