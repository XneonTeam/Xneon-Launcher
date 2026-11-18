// Идентичность — по пикселям, а не по упаковке PNG или адресу CDN.
// Разделение серверного профиля и локальной библиотеки следует модели Modrinth App:
// https://github.com/modrinth/code/blob/main/packages/app-lib/src/api/minecraft_skins.rs
// Реализация своя; Rust/Tauri-код и интерфейс Modrinth не копируются.
import { PNG } from "pngjs"
import { createHash } from "node:crypto"

export const MAX_TEXTURE_BYTES = 1024 * 1024
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function decodeSkinTexture(data: unknown): PNG | null {
  if (!(data instanceof Uint8Array) || data.length < 33 || data.length > MAX_TEXTURE_BYTES) return null
  if (!SIGNATURE.every((byte, i) => data[i] === byte)) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // Проверяем размеры до распаковки, а не после выделения памяти PNG-декодером.
  if (view.getUint32(16) !== 64 || ![32, 64].includes(view.getUint32(20))) return null
  try {
    return PNG.sync.read(Buffer.from(data))
  } catch {
    return null
  }
}

export function skinTextureKey(data: Uint8Array): string | null {
  const png = decodeSkinTexture(data)
  if (!png) return null
  const pixels = normalizedPixels(png)
  // Сравниваем только используемые грани развёртки: служебные/неиспользуемые
  // пиксели и PNG-метаданные Minecraft может менять при загрузке на сервер.
  const visible = Buffer.alloc(pixels.length)
  const faces = [
    [8, 0, 24, 8], [0, 8, 32, 16], [40, 0, 56, 8], [32, 8, 64, 16],
    [4, 16, 12, 20], [0, 20, 16, 32], [20, 16, 36, 20], [16, 20, 40, 32],
    [44, 16, 52, 20], [40, 20, 56, 32], [4, 32, 12, 36], [0, 36, 16, 48],
    [20, 32, 36, 36], [16, 36, 40, 48], [44, 32, 52, 36], [40, 36, 56, 48],
    [4, 48, 12, 52], [0, 52, 16, 64], [20, 48, 28, 52], [16, 52, 32, 64],
    [36, 48, 44, 52], [32, 52, 48, 64], [52, 48, 60, 52], [48, 52, 64, 64],
  ]
  for (const [x1, y1, x2, y2] of faces) {
    for (let y = y1; y < y2; y++) pixels.copy(visible, (y * 64 + x1) * 4, (y * 64 + x1) * 4, (y * 64 + x2) * 4)
  }
  // Цвет невидимого пикселя не меняет текстуру.
  for (let i = 0; i < visible.length; i += 4) {
    if (visible[i + 3] === 0) visible.fill(0, i, i + 3)
  }
  return createHash("sha256").update(visible).digest("hex")
}

/** Развёртка старых 64×32 и прозрачность базового слоя по правилам Minecraft. */
function normalizedPixels(png: PNG): Buffer {
  const pixels = Buffer.alloc(64 * 64 * 4)
  png.data.copy(pixels)
  if (png.height === 32) {
    const mirrors = [
      [4, 16, 20, 48, 4, 4], [8, 16, 24, 48, 4, 4],
      [0, 20, 24, 52, 4, 12], [4, 20, 20, 52, 4, 12],
      [8, 20, 16, 52, 4, 12], [12, 20, 28, 52, 4, 12],
      [44, 16, 36, 48, 4, 4], [48, 16, 40, 48, 4, 4],
      [40, 20, 40, 52, 4, 12], [44, 20, 36, 52, 4, 12],
      [48, 20, 32, 52, 4, 12], [52, 20, 44, 52, 4, 12],
    ]
    for (const [sx, sy, dx, dy, w, h] of mirrors) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const source = ((sy + y) * 64 + sx + w - x - 1) * 4
        pixels.set(pixels.subarray(source, source + 4), ((dy + y) * 64 + dx + x) * 4)
      }
    }
    // Старые скины без alpha заполняли фон шляпы непрозрачным цветом.
    let opaqueOverlay = true
    for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) {
      if (pixels[(y * 64 + x) * 4 + 3] < 128) opaqueOverlay = false
    }
    if (opaqueOverlay) for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) pixels[(y * 64 + x) * 4 + 3] = 0
  }
  for (const [x1, y1, x2, y2] of [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]]) {
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) pixels[(y * 64 + x) * 4 + 3] = 255
  }
  return pixels
}

export function detectSkinVariant(data: Uint8Array): "classic" | "slim" {
  const png = decodeSkinTexture(data)
  if (!png || png.height === 32) return "classic"
  for (let y = 20; y < 32; y++) {
    for (let x = 54; x < 56; x++) {
      if (png.data[(y * 64 + x) * 4 + 3] !== 0) return "classic"
    }
  }
  return "slim"
}
