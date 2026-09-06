export function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function opFailure(e: unknown): { success: false; error: string } {
  return { success: false, error: toErrorMessage(e) }
}