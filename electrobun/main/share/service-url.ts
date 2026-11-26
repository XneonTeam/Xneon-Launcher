import { SERVICE_URLS } from "@xnlc/urls"

/**
 * Канонический адрес Share API. Он же умолчание для сборок и установок,
 * где XNLC_SHARE_URL не задан: share.xneon.org обслуживает `/v1`.
 */
export const DEFAULT_SHARE_URL = SERVICE_URLS.share

/** Адрес из окружения важнее умолчания; пустое значение означает «по умолчанию». */
export function resolveShareUrl(override: string | undefined): string {
  const value = (override ?? "").trim()
  return (value || DEFAULT_SHARE_URL).replace(/\/+$/, "")
}

/** Сравнимый вид адреса: без пробелов и хвостовых слэшей. */
function shareUrlKey(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "")
}

/**
 * Сохранённые credentials принадлежат конкретному адресу: токен, выданный
 * старым dev-воркером, нельзя отправлять на share.xneon.org. При смене адреса
 * запись игнорируется, и Share получает новый токен.
 */
export function credentialsForShareUrl<T extends { url?: string }>(stored: T | undefined, url: string): T | undefined {
  return stored && shareUrlKey(stored.url) === url ? stored : undefined
}
