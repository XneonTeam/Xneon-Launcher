import type { ShareProgress } from "@xnlc/types"

/** Событие содержит только текущий файл; список сохраняем локально до завершения. */
export function mergePublishProgress(previous: ShareProgress, next: ShareProgress): ShareProgress {
  const files = new Map(previous.files?.map(file => [file.path, file]))
  for (const file of next.files ?? []) files.set(file.path, file)
  return { ...next, files: [...files.values()],
    done: previous.stage === next.stage ? Math.max(previous.done, next.done) : next.done }
}

export function publishProgressPercent(progress: ShareProgress): number | undefined {
  if (progress.stage === "commit") return 100
  if (progress.stage === "start" || progress.total <= 0) return undefined
  return Math.max(0, Math.min(100, progress.done / progress.total * 100))
}
