const blobUrlCache = new Map<string, string>()

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

export function revokeLocalFileBlobUrl(filePath: string) {
  const url = blobUrlCache.get(filePath)
  if (url) {
    URL.revokeObjectURL(url)
    blobUrlCache.delete(filePath)
  }
}
