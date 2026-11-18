import fs from "node:fs/promises"
import { fetchWithRetry } from "@xnlc/core/retry"

type DownloadProgress = { current: number; total: number; done?: boolean }

/** Файл принадлежит staging-владельцу: он решает, когда переименовать/удалить его. */
export async function streamDownloadToFile(url: string, destination: string, signal?: AbortSignal, progress?: (value: DownloadProgress) => void): Promise<void> {
  signal?.throwIfAborted()
  progress?.({ current: 0, total: 0 })
  const response = await fetchWithRetry(url, { signal })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${response.status}: ${url}`)
  }
  const totalHeader = Number(response.headers.get("content-length") || 0)
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0
  const reader = response.body?.getReader()
  let file: Awaited<ReturnType<typeof fs.open>> | undefined
  let current = 0, lastProgress = performance.now()
  const abort = () => { void reader?.cancel(signal?.reason).catch(() => {}) }
  signal?.addEventListener("abort", abort, { once: true })
  try {
    signal?.throwIfAborted()
    file = await fs.open(destination, "wx")
    if (reader) for (;;) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      signal?.throwIfAborted()
      if (chunk.done) break
      // Backpressure: следующий сетевой чанк читается только после записи.
      let offset = 0
      while (offset < chunk.value.byteLength) {
        signal?.throwIfAborted()
        const written = await file.write(chunk.value, offset, chunk.value.byteLength - offset)
        if (!written.bytesWritten) throw new Error("Download write made no progress")
        offset += written.bytesWritten
      }
      current += chunk.value.byteLength
      if (performance.now() - lastProgress >= 100) {
        progress?.({ current, total })
        lastProgress = performance.now()
      }
    }
    signal?.throwIfAborted()
  } finally {
    signal?.removeEventListener("abort", abort)
    try { await reader?.cancel().catch(() => {}) } finally {
      reader?.releaseLock()
      try { await file?.close() } finally { progress?.({ current, total, done: true }) }
    }
  }
}
