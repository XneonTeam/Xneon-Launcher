// ============================================================
// XNLC — Retry / Backoff utilities
// Shared network retry helpers used across XNLC packages and
// Electron main process. Author: MAINER4IK
// ============================================================

export interface RetryOptions {
  retries?: number
  delayMs?: number
  backoff?: "fixed" | "exponential"
  retryIf?: (err: unknown) => boolean
  onRetry?: (err: unknown, attempt: number) => void
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false
  if (err instanceof TypeError) return true
  return false
}

const defaultRetryIf = (err: unknown) => isRetryableError(err)

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, delayMs = 500, backoff = "exponential", retryIf = defaultRetryIf, onRetry } = options
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt >= retries || !retryIf(err)) break
      onRetry?.(err, attempt + 1)
      const delay = backoff === "fixed" ? delayMs : delayMs * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}

export function fetchWithRetry(input: string | URL, init?: RequestInit, options: RetryOptions = {}): Promise<Response> {
  return withRetry(async () => fetch(input, init), options)
}