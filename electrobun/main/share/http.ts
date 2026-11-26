import { ShareError, unreadableShareResponse } from "@xnlc/share"
import { APP_USER_AGENT } from "../../../lib/app-meta"

/**
 * Заголовки запросов Share. User-Agent обязателен: Cloudflare перед
 * share.xneon.org пропускает клиент лаунчера только с его подписью,
 * а запросы без неё (UA Bun/curl) получают 403 Cf-Mitigated: challenge.
 */
export function shareHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Accept: "application/json", "User-Agent": APP_USER_AGENT, ...extra }
}

/**
 * Разбирает ответ Share API. HTML вместо JSON — это не ошибка формата,
 * а Cloudflare challenge или чужой шлюз; такой ответ превращается в
 * ShareError, чтобы UI показал причину, а не SyntaxError.
 */
export async function readShareJson(response: Response): Promise<any> {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    throw unreadableShareResponse(response.status, response.headers.get("cf-mitigated"), text)
  }
}

/** Сетевой сбой (DNS, TLS, таймаут) — это недоступность сервиса, а не неизвестная ошибка. */
export async function shareFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error && typeof error === "object" && (error as { name?: string }).name === "AbortError") throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new ShareError("SERVICE_UNAVAILABLE", `Share API is unreachable: ${reason}`)
  }
}

export function shareHttpError(data: unknown, fallback: string): ShareError {
  const error = (data as { error?: { code?: string; message?: string } } | undefined)?.error
  return new ShareError(error?.code ?? "HTTP", error?.message ?? fallback)
}
