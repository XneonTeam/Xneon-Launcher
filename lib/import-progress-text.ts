import type { ImportProgress } from "@xnlc/types"

export function localizeImportProgress(progress: ImportProgress, translate: (key: string, params?: Record<string, string | number>) => string): ImportProgress {
  return progress.messageKey ? { ...progress, message: translate(progress.messageKey, progress.messageParams) } : progress
}
