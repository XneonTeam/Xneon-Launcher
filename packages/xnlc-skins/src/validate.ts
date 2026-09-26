// ============================================================
// @xnlc/skins — валидация текстур, имён и моделей
// ============================================================
//
// Одна проверка на все пути: и импорт из каталога, и файл с диска, и текстура
// записи «Избранного». Раньше проверки были размазаны по main: в каталоге —
// свои, в библиотеке — никаких.

/** Верхняя граница принимаемой текстуры: PNG 64×64 весит единицы килобайт. */
export const MAX_TEXTURE_BYTES = 1024 * 1024

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

/** PNG ли это и разумного ли размера. */
export function isValidTexture(data: unknown): data is Uint8Array {
  if (!(data instanceof Uint8Array)) return false
  if (data.byteLength < 8 || data.byteLength > MAX_TEXTURE_BYTES) return false
  return PNG_MAGIC.every((byte, index) => data[index] === byte)
}

export type SkinVariant = "classic" | "slim"

/** Что угодно в модель скина: всё, кроме явного `slim`, — классика. */
export function normalizeVariant(value: unknown): SkinVariant {
  return value === "slim" ? "slim" : "classic"
}

/** Подпись скина: обрезаем и подставляем запасную, если имени нет. */
export function sanitizeSkinName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim()
  return (name || fallback).slice(0, 64)
}

/** Подпись скина каталога, у которого нет имени: «Skin #abcdef». */
export function labySkinFallbackName(hash: string): string {
  return hash ? `Skin #${hash.slice(0, 6)}` : "Skin"
}