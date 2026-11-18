import { PNG } from "pngjs"
import { probeImage } from "@xnlc/parser"

/** Список показывает 40px: 128px хватает и для экрана с высоким DPI. */
export const CONTENT_ICON_SIZE = 128

/** Уменьшаем только копию встроенной PNG; исходный JAR остаётся нетронутым. */
export function normalizeContentIcon(icon: string): string {
  if (!icon.startsWith("data:image/png;base64,")) return icon
  try {
    const bytes = Buffer.from(icon.slice("data:image/png;base64,".length), "base64")
    // Проверяем бюджет пикселей до декодирования; PNG/APNG и прочие форматы
    // вне поддерживаемой нормализации остаются на прежнем пути отображения.
    const info = probeImage(bytes)
    if (info.width <= CONTENT_ICON_SIZE && info.height <= CONTENT_ICON_SIZE) return icon
    const source = PNG.sync.read(bytes)
    const scale = Math.min(CONTENT_ICON_SIZE / source.width, CONTENT_ICON_SIZE / source.height)
    const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
    const target = new PNG({ width, height })
    // Box filter без нового native-модуля; цвет усредняется с учётом альфы,
    // чтобы прозрачные пиксели не давали чёрную кайму на миниатюре.
    for (let y = 0; y < height; y++) {
      const top = Math.floor(y * source.height / height), bottom = Math.floor((y + 1) * source.height / height)
      for (let x = 0; x < width; x++) {
        const left = Math.floor(x * source.width / width), right = Math.floor((x + 1) * source.width / width)
        let red = 0, green = 0, blue = 0, alpha = 0
        for (let sy = top; sy < bottom; sy++) for (let sx = left; sx < right; sx++) {
          const i = (sy * source.width + sx) * 4, a = source.data[i + 3]
          red += source.data[i] * a; green += source.data[i + 1] * a; blue += source.data[i + 2] * a; alpha += a
        }
        const i = (y * width + x) * 4
        target.data[i] = alpha ? Math.round(red / alpha) : 0
        target.data[i + 1] = alpha ? Math.round(green / alpha) : 0
        target.data[i + 2] = alpha ? Math.round(blue / alpha) : 0
        target.data[i + 3] = Math.round(alpha / ((bottom - top) * (right - left)))
      }
    }
    const result = `data:image/png;base64,${PNG.sync.write(target).toString("base64")}`
    return result
  } catch {
    // Ошибка превью не должна скрывать мод или ломать существующий формат иконки.
    return icon
  }
}

// Готовые изображения принадлежат дисковому content-icon-assets. Не держим
// параллельный base64-кеш поверх scanner/resources.
export function getContentIconCacheStats() { return { entries: 0, estimatedBytes: 0 } }

/** Старый снимок сборки читается раньше скана: не показываем оригиналы даже на один кадр. */
export function normalizeBuildContentIcons<T extends { mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[] }>(content: T | null): T | null {
  if (!content) return content
  let next = content
  for (const key of ["mods", "resourcepacks", "shaders"] as const) {
    if (!Array.isArray(content[key])) continue
    let changed = false
    const items = content[key].map(item => {
      if (!item || typeof item !== "object" || !("icon_url" in item) || typeof item.icon_url !== "string") return item
      const icon = normalizeContentIcon(item.icon_url)
      if (icon === item.icon_url) return item
      changed = true
      return { ...item, icon_url: icon }
    })
    if (changed) next = { ...next, [key]: items }
  }
  return next
}
