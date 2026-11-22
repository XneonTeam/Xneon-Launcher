/** Технические подробности остаются в main log; UI получает устойчивую категорию отказа. */
export function unixUpdateErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === "ENOSPC") return "update-insufficient-space"
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "update-no-permission"
  if (code === "ERR_ASSERTION") return "update-verification-failed"
  if (code === "ENOENT") return "update-not-prepared"
  return error instanceof Error ? error.message : "Unknown error"
}
