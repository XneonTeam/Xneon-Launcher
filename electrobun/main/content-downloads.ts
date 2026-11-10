import { randomUUID } from "node:crypto"

const downloads = new Map<string, { owner: number; controller: AbortController }>()

/** Отмена затрагивает только запрос, запущенный из этого окна. */
export function cancelContentDownload(owner: number, id: string): boolean {
  const entry = downloads.get(id)
  if (!entry || entry.owner !== owner) return false
  entry.controller.abort(new Error("CONTENT_DOWNLOAD_CANCELLED"))
  return true
}

export async function runContentDownload<T>(owner: number, work: (signal: AbortSignal, id: string) => Promise<T>): Promise<T> {
  const id = randomUUID(), controller = new AbortController()
  downloads.set(id, { owner, controller })
  try {
    return await work(controller.signal, id)
  } catch (error) {
    if (controller.signal.aborted) throw new Error("CONTENT_DOWNLOAD_CANCELLED")
    throw error
  } finally { downloads.delete(id) }
}

export function hasActiveContentDownloads(): boolean { return downloads.size > 0 }
