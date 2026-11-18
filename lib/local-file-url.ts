type LocalFileUrl = { users: number; url?: string; pending: Promise<string> }
const blobUrlCache = new Map<string, LocalFileUrl>()

/**
 * Читает PNG текстуры из каталога скинов лаунчера и отдаёт blob-URL для
 * `<img>` и WebGL-вьюера.
 *
 * Параллельные владельцы разделяют чтение и URL. Каждому вызову соответствует
 * releaseLocalFileUrl в cleanup, даже если IPC ещё не завершился.
 */
export function localFileToBlobUrl(filePath: string): Promise<string> {
  const cached = blobUrlCache.get(filePath)
  if (cached) { cached.users++; return cached.pending }

  const entry: LocalFileUrl = { users: 1, pending: Promise.resolve("") }
  blobUrlCache.set(filePath, entry)
  entry.pending = read(filePath, entry)
  return entry.pending
}

async function read(filePath: string, entry: LocalFileUrl): Promise<string> {
  try {
    const base64 = await window.electrobunAPI?.readLocalFile(filePath)
    if (!base64 || entry.users === 0) return ""

    const byteString = atob(base64)
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i)
    }
    const blob = new Blob([ab], { type: "image/png" })
    const url = URL.createObjectURL(blob)
    entry.url = url
    return url
  } catch {
    return ""
  }
}

/** Последний владелец освобождает Blob, а не только строку в JS-куче. */
export function releaseLocalFileUrl(filePath: string): void {
  const entry = blobUrlCache.get(filePath)
  if (!entry || --entry.users > 0) return
  blobUrlCache.delete(filePath)
  if (entry.url) URL.revokeObjectURL(entry.url)
}
