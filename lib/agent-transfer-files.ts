/** Файлы берём до завершения paste/drop: после события DataTransfer очищается. */
export function filesFromTransfer(transfer: Pick<DataTransfer, "files" | "items">): File[] {
  const files = Array.from(transfer.files ?? [])
  if (files.length) return files
  return Array.from(transfer.items ?? []).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => file !== null)
}

export function attachmentImageType(file: Pick<File, "name" | "type">): string | null {
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return file.type
  const extension = /\.(png|jpe?g|webp|gif)$/i.exec(file.name)?.[1]?.toLowerCase()
  return extension ? `image/${extension === "jpg" ? "jpeg" : extension}` : null
}
