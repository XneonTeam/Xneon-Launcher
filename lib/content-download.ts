/** IPC сохраняет сообщение ошибки, но не её пользовательские поля. */
export function isContentDownloadCancelled(error: unknown): boolean {
  return error instanceof Error && error.message.includes("CONTENT_DOWNLOAD_CANCELLED")
}
