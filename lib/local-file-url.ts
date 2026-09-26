const blobUrlCache = new Map<string, string>()

/**
 * Читает PNG текстуры из каталога скинов лаунчера и отдаёт blob-URL для
 * `<img>` и WebGL-вьюера.
 *
 * Кэш по пути файла: чтение идёт через IPC (`read-local-file`), и без него
 * каждая перерисовка вкладки читала бы файлы заново. Отзывать URL не нужно:
 * лаунчер живёт сессиями, а файл по неизменному пути (id записи) не меняется.
 */
export async function localFileToBlobUrl(filePath: string): Promise<string> {
  const cached = blobUrlCache.get(filePath)
  if (cached) return cached

  try {
    const base64 = await window.electronAPI?.readLocalFile(filePath)
    if (!base64) return ""

    const byteString = atob(base64)
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i)
    }
    const blob = new Blob([ab], { type: "image/png" })
    const url = URL.createObjectURL(blob)
    blobUrlCache.set(filePath, url)
    return url
  } catch {
    return ""
  }
}