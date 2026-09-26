// ============================================================
// @xnlc/skins — HTTP-клиент Laby
// ============================================================
//
// Единственное место, где каталог ходит в сеть. Запросы повторяются только
// там, где это осмысленно: Laby отдаёт `429` при превышении лимита (300 на
// поиск, 100 на теги) и `5xx` при сбое, а `4xx` повторять бессмысленно.
//
// Ошибка всегда приходит в виде `LabyRequestError` с полем `api` — UI получает
// готовое состояние ошибки, а не текст исключения.

import { fetchWithRetry } from "@xnlc/core/retry"
import type { LabyApiError } from "@xnlc/types"

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const ATTEMPTS = 3
const RETRY_DELAY_MS = 800

/** Ошибка запроса к Laby вместе с её машиночитаемым описанием. */
export class LabyRequestError extends Error {
  readonly api: LabyApiError

  constructor(api: LabyApiError) {
    super(api.message)
    this.name = "LabyRequestError"
    this.api = api
  }
}

/** Код ответа (или сеть) в модель ошибки, которую показывает UI. */
export function describeLabyError(error: unknown, status?: number): LabyApiError {
  if (status === 429) return { code: "rate_limited", message: "Laby ограничил частоту запросов", retryable: true }
  if (status === 404) return { code: "not_found", message: "Скин не найден в Laby", retryable: false }
  if (status === 400) return { code: "bad_request", message: "Laby отклонил запрос", retryable: false }
  if (status === 401 || status === 403) return { code: "forbidden", message: "Laby закрыл доступ", retryable: false }
  if (status && status >= 500) return { code: "server_error", message: "Laby временно недоступен", retryable: true }
  if (status) return { code: `http_${status}`, message: `Laby ответил кодом ${status}`, retryable: status >= 500 }
  const message = error instanceof Error ? error.message : String(error)
  if (/abort/i.test(message)) return { code: "aborted", message: "Запрос отменён", retryable: true }
  return { code: "network", message: "Нет связи с Laby", retryable: true }
}

/** Ошибку любого вида приводит к модели `LabyApiError`. */
export function toLabyApiError(error: unknown): LabyApiError {
  if (error instanceof LabyRequestError) return error.api
  return describeLabyError(error)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class LabyClient {
  /** GET JSON. Бросает `LabyRequestError`. */
  async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    let lastStatus: number | undefined
    let lastError: unknown

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        const res = await fetchWithRetry(
          url,
          { headers: { Accept: "application/json", "User-Agent": BROWSER_UA }, signal },
          { retries: 1 },
        )
        if (res.ok) return (await res.json()) as T
        lastStatus = res.status
        // Повторяем только перегрузку и сбои сервера: остальное не изменится.
        if (res.status !== 429 && res.status < 500) break
      } catch (error) {
        if (signal?.aborted) throw new LabyRequestError(describeLabyError(error))
        lastError = error
        lastStatus = undefined
        if (attempt === ATTEMPTS - 1) throw new LabyRequestError(describeLabyError(error))
      }
      if (attempt < ATTEMPTS - 1) await sleep(RETRY_DELAY_MS * (attempt + 1))
    }

    if (lastError && lastStatus === undefined) throw new LabyRequestError(describeLabyError(lastError))
    throw new LabyRequestError(describeLabyError(undefined, lastStatus))
  }

  /** Скачивание текстуры: без повторов, результат проверяет вызывающая сторона. */
  async texture(url: string): Promise<Uint8Array | null> {
    try {
      const res = await fetchWithRetry(url, { headers: { Accept: "image/png", "User-Agent": BROWSER_UA } }, { retries: 2 })
      if (!res.ok) return null
      return new Uint8Array(await res.arrayBuffer())
    } catch {
      return null
    }
  }
}