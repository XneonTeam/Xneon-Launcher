import type { ImportProgress } from "@xnlc/types"

/** Снимок списка приходит один раз, дальнейшие события содержат изменения одного файла. */
export function mergeImportProgress(previous: ImportProgress | null, incoming: ImportProgress): ImportProgress {
  const files = incoming.files ?? previous?.files ?? []
  const nextFiles = incoming.file
    ? files.some(file => file.id === incoming.file!.id)
      ? files.map(file => file.id === incoming.file!.id ? { ...file, ...incoming.file } : file)
      : [...files, incoming.file]
    : files
  return { ...previous, ...incoming, files: nextFiles }
}

export function getImportOperation(progress: ImportProgress): NonNullable<ImportProgress["operation"]> {
  return progress.operation ?? (progress.source === "local" ? "archive" : "modpack")
}


/** Подтверждённый успешный импорт остаётся доступен для просмотра, независимо от его длительности. */
export function completeImportProgress(progress: ImportProgress): ImportProgress {
  return { ...progress, phase: "complete", current: 100, total: 100, completedFiles: progress.fileCount ?? progress.files?.length ?? progress.completedFiles, files: progress.files?.map(file => ({ ...file, status: "complete" })) }
}
