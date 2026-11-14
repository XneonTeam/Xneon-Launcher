export type ArchiveErrorCode =
  | "INVALID_ARCHIVE"
  | "UNSUPPORTED_METHOD"
  | "UNSAFE_ENTRY"
  | "LIMIT_EXCEEDED"
  | "ABORTED"
  | "IO_ERROR"

/** Ошибка архива с машинным кодом: вызывающий код различает отмену, лимиты и порчу данных. */
export class ArchiveError extends Error {
  constructor(
    public readonly code: ArchiveErrorCode,
    message: string,
    public readonly entry?: string,
  ) {
    super(message)
    this.name = "ArchiveError"
  }
}

export function isArchiveAbort(error: unknown): boolean {
  return error instanceof ArchiveError && error.code === "ABORTED"
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ArchiveError("ABORTED", "Archive operation cancelled")
}

/** Приводит произвольный сбой файловой системы к ArchiveError, сохраняя причину. */
export function toArchiveIoError(error: unknown, entry?: string): ArchiveError {
  if (error instanceof ArchiveError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ArchiveError("IO_ERROR", message, entry)
}
