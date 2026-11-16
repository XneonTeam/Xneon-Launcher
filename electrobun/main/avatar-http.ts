import { APP_USER_AGENT } from "../../lib/app-meta"
import { fetchWithRetry } from "@xnlc/core/retry"

/** HTTP-статус отличается от сетевой ошибки/отмены; Axios-совместимый объект не нужен. */
export class AvatarHttpError extends Error {
  constructor(readonly status: number, readonly url: string, statusText: string) {
    super(`Avatar HTTP ${status}${statusText ? ` ${statusText}` : ""}`)
    this.name = "AvatarHttpError"
  }
}

// Только прежняя общая конфигурация avatar: UA, 5 секунд, 2xx и без повторов.
// Сигнал живёт и после получения заголовков, поэтому ограничивает чтение тела.
async function avatarResponse(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has("User-Agent")) headers.set("User-Agent", APP_USER_AGENT)
  if (!headers.has("Accept")) headers.set("Accept", "application/json, text/plain, */*")
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  const response = await fetchWithRetry(url, { ...init, headers, signal }, { retries: 0 })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new AvatarHttpError(response.status, response.url || url, response.statusText)
  }
  return response
}

export async function avatarJson<T>(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<T> {
  const response = await avatarResponse(url, init, timeoutMs)
  const text = await response.text()
  // Axios по умолчанию молча оставлял не-JSON текст и пустые 204 как строку.
  // Сохраняем поведение: проверки полей/фолбэки остаются в avatar.ts.
  try { return JSON.parse(text) as T } catch { return text as T }
}

export async function avatarBuffer(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Buffer> {
  const response = await avatarResponse(url, init, timeoutMs)
  // Buffer разделяет память с ArrayBuffer: без второй копии картинки.
  return Buffer.from(await response.arrayBuffer())
}
