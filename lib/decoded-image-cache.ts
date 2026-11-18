type DecodedEntry = { image: HTMLImageElement; bytes: number }
const decodedImages = new Map<string, DecodedEntry>()
const MAX_ENTRIES = 64
const MAX_BYTES = 8 * 1024 * 1024
let totalBytes = 0

/**
 * Закрепляет ресурс картинки между mount, чтобы браузер мог переиспользовать
 * декодированное изображение. Не удерживает настоящий DOM-узел и его React fiber.
 * Кэш ограничен и числом записей, и оценкой RGBA-памяти, включая строку src.
 */
export function retainDecodedImage(loaded: Pick<HTMLImageElement, "currentSrc" | "naturalWidth" | "naturalHeight">): void {
  const src = loaded.currentSrc
  if (!src || typeof Image === "undefined") return
  const cached = decodedImages.get(src)
  if (cached) {
    decodedImages.delete(src)
    decodedImages.set(src, cached)
    return
  }
  const pixels = loaded.naturalWidth * loaded.naturalHeight
  const bytes = pixels * 4 + src.length * 2
  if (!Number.isFinite(bytes) || pixels <= 0 || bytes > MAX_BYTES) return
  while (decodedImages.size >= MAX_ENTRIES || totalBytes + bytes > MAX_BYTES) {
    const key = decodedImages.keys().next().value!
    totalBytes -= decodedImages.get(key)!.bytes
    decodedImages.delete(key)
  }
  const image = new Image()
  image.decoding = "async"
  image.src = src
  decodedImages.set(src, { image, bytes })
  totalBytes += bytes
  // Отсоединённый Image не рисуется: явно просим декодирование, иначе браузер
  // вправе оставить только сжатые байты до следующего появления картинки.
  void image.decode?.().catch(() => {
    if (decodedImages.get(src)?.image !== image) return
    decodedImages.delete(src)
    totalBytes -= bytes
  })
}

export function getDecodedImageCacheStats() {
  return { entries: decodedImages.size, estimatedBytes: totalBytes }
}
