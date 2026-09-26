// ============================================================
// XNLC — хранилище токенов облачных провайдеров
// ============================================================
//
// Каждый провайдер писал свою пару `readToken`/`writeToken` поверх
// `dbHelpers.getCloudConfig`: шесть почти одинаковых функций с одним и тем же
// JSON.parse/JSON.stringify и глушением ошибок. Здесь это одна обобщённая пара,
// плюс `clearToken` для logout — раньше каждый провайдер вызывал
// `removeCloudConfig` вручную.
//
// Тип токена задаёт провайдер (он знает свои поля), хранилище работает с ним
// как с обычным объектом.

import { dbHelpers } from "../../db"

/** Читает сохранённый токен. Возвращает null, если записи нет или JSON битый. */
export async function readCloudToken<T>(providerId: string): Promise<T | null> {
  try {
    const raw = await dbHelpers.getCloudConfig(providerId)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    // Повреждённая запись не должна ломать провайдер: считаем, что токена нет.
    return null
  }
}

/** Сохраняет токен провайдера. */
export async function writeCloudToken<T>(providerId: string, token: T): Promise<void> {
  await dbHelpers.setCloudConfig(providerId, JSON.stringify(token))
}

/** Удаляет токен (logout). Ошибки глушим: выход должен работать всегда. */
export async function clearCloudToken(providerId: string): Promise<void> {
  try {
    await dbHelpers.removeCloudConfig(providerId)
  } catch {
    /* noop */
  }
}

/**
 * Отдаёт актуальный access token, обновляя его по refresh_token, если срок
 * истёк. Провайдеры отличаются только запросом обмена, поэтому общий каркас
 * (проверка срока → refresh → запись) живёт здесь.
 *
 * Результат обновления сохраняется здесь же: провайдерские `refresh` тоже
 * пишут токен, но полагаться на это нельзя — забытая запись означала бы
 * повторный refresh на каждое обращение.
 */
export async function getValidCloudToken<T extends { access_token?: string; refresh_token?: string; expires_at?: number }>(
  providerId: string,
  refresh: (token: T) => Promise<T>,
  /** Запас времени до истечения, при котором токен уже обновляем (по умолчанию минута). */
  skewMs = 60_000,
): Promise<T | null> {
  const token = await readCloudToken<T>(providerId)
  if (!token) return null

  const expired = typeof token.expires_at === "number" && Date.now() > token.expires_at - skewMs
  if (expired && token.refresh_token) {
    try {
      const refreshed = await refresh(token)
      await writeCloudToken(providerId, refreshed)
      return refreshed
    } catch {
      // Обновить не удалось — отдаём прежний токен: возможно, он ещё жив, а
      // провайдер сам обработает 401.
      return token
    }
  }
  return token
}