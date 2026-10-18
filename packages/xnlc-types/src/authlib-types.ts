// ============================================================
// @xnlc/types — Authlib-Injector (Yggdrasil) Types
// Контракты третьего типа аккаунта: аккаунты на совместимых
// с Authlib-Injector Yggdrasil-серверах (Ely.by, LittleSkin,
// собственные сервера и т.д.). Только типы — вся логика живёт
// в main-процессе лаунчера (electron/main/authlib).
// ============================================================

/**
 * Метаданные Yggdrasil-сервера — JSON, который сервер отдаёт на своём
 * API root (то, что authlib-injector получает по `x-authlib-injector-api-location`).
 */
export interface AuthlibInjectorMetadata {
  meta?: {
    serverName?: string
    links?: Record<string, string>
    "feature.non_email_login"?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Сохранённый authorization server. `id` — стабильный хеш от
 * нормализованного URL (см. main: authlib/server.ts), а не сам URL:
 * один и тот же сервер никогда не задублируется из-за регистра
 * или лишнего слэша.
 */
export interface AuthlibInjectorServer {
  id: string
  /** API root с завершающим слэшем, например `https://example.com/api/yggdrasil/` */
  url: string
  /** Отображаемое имя: meta.serverName либо хост, если сервер ими не сообщил */
  name: string
  nonEmailLogin: boolean
  /** Разрешённые ссылки из meta.links (пока homepage/register) */
  links: Record<string, string>
  /** Фавикон сервера в виде Base64 data URL или абсолютной ссылки */
  favicon?: string
  /** Timestamp последнего успешного обновления метаданных */
  metadataTimestamp?: number
}

/** Краткая форма сервера для списка выбора в UI (без метаданных). */
export interface AuthlibInjectorServerSummary {
  id: string
  url: string
  name: string
  nonEmailLogin: boolean
  links: Record<string, string>
  favicon?: string
}

/** Игровой профиль Yggdrasil-аккаунта. */
export interface YggdrasilGameProfile {
  /** UUID без дефисов (как возвращает Yggdrasil API) */
  id: string
  name: string
}

/** Текстуры, декодированные из Base64-свойства `textures` профиля. */
export interface YggdrasilTextures {
  skin?: { url: string; model?: string }
  cape?: { url: string }
}

/** Профиль с уже декодированными текстурами — то, что показывает UI выбора персонажей. */
export interface YggdrasilProfileWithTextures extends YggdrasilGameProfile {
  textures?: YggdrasilTextures
}

/** Полный ответ `POST /authserver/authenticate` (нормализованный вид). */
export interface YggdrasilAuthenticationResponse {
  accessToken: string
  clientToken: string
  selectedProfile?: YggdrasilGameProfile
  availableProfiles: YggdrasilGameProfile[]
  /** `requestUser: true` — сервер вернул объект пользователя */
  user?: Record<string, unknown>
}

/** Аккаунт Authlib-Injector, сохраняемый в БД (аналог DbAccount для type="authlib-injector"). */
export interface AuthlibInjectorAccountData {
  type: "authlib-injector"
  id: string
  username: string
  uuid: string
  accessToken?: string
  clientToken?: string
  /** id сервера из authlib_servers — аккаунт жёстко привязан к своему серверу */
  serverId: string
  serverUrl: string
  serverName?: string
  selectedProfile?: YggdrasilGameProfile
  /**
   * Зарезервировано: сейчас не заполняется. Фактический аккаунт в БД —
   * DbAccount (там срок жизни токена не хранится), а Yggdrasil-сессия
   * проверяется запросом validate/refresh перед запуском.
   */
  expiresAt?: number
  /**
   * Зарезервировано: сейчас не заполняется. Свойства пользователя из
   * authenticate (`user.properties`) приходят в AuthlibInjectorLoginResult,
   * но в БД не сохраняются.
   */
  userProperties?: string
}

/** Результат IPC `authlib:login` — аккаунт готов к сохранению. */
export interface AuthlibInjectorLoginResult {
  type: "authlib-injector"
  /** Пустой, пока requiresProfileSelection === true (аккаунт ещё не выбран) */
  id: string
  username: string
  uuid: string
  accessToken: string
  clientToken: string
  serverId: string
  serverUrl: string
  serverName?: string
  /** Заполнен после выбора профиля; undefined — ждём выбора */
  selectedProfile?: YggdrasilGameProfile
  availableProfiles: YggdrasilProfileWithTextures[]
  /** Много профилей и конкретный ещё не выбран — UI должен показать выбор */
  requiresProfileSelection: boolean
  /** Скин выбранного профиля (из декодированных текстур) — для аватарки */
  skinUrl?: string
  userProperties?: Record<string, unknown>
}

/** Ошибка Authlib/Yggdrasil-слоя, приходящая в renderer. */
export interface AuthlibInjectorErrorPayload {
  /** Машинный код для локализации в UI */
  code:
    | "invalid_url"
    | "connection"
    | "ssl"
    | "timeout"
    | "not_found"
    | "invalid_metadata"
    | "unsupported"
    | "invalid_credentials"
    | "invalid_token"
    | "two_factor_required"
    | "rate_limited"
    | "server_error"
    | "profile_required"
    | "server_not_found"
    | "unknown"
  /** Готовое человекочитаемое сообщение (EN) — fallback, если код не локализован */
  message: string
}

/** Результат IPC `authlib:remove-server`. */
export interface AuthlibRemoveServerResult {
  removedAccounts: number
}

/**
 * Ошибки через IPC нельзя передать custom-полями Error (structured clone
 * их теряет), поэтому fallible-каналы возвращают union с AuthlibInjectorErrorPayload.
 */
export interface AuthlibInjectorErrorOutcome {
  ok: false
  error: AuthlibInjectorErrorPayload
}

/** Результат probe/resolve сервера (валидация перед добавлением). */
export type AuthlibProbeOutcome =
  | { ok: true; server: AuthlibInjectorServer }
  | AuthlibInjectorErrorOutcome

/**
 * Результат сохранения сервера (`authlib:add-server`).
 *
 * Раньше канал возвращал голый summary и при ошибке resolve отклонял промис:
 * renderer получал служебный текст исключения и оставался на шаге
 * подтверждения без внятного сообщения. Теперь это такой же union, как probe.
 */
export type AuthlibAddServerOutcome =
  | { ok: true; server: AuthlibInjectorServerSummary }
  | AuthlibInjectorErrorOutcome

/** Результат логина. */
export type AuthlibLoginOutcome =
  | { ok: true; result: AuthlibInjectorLoginResult }
  | AuthlibInjectorErrorOutcome

/** Фаза логина — UI показывает, на каком шаге сейчас запрос. */
export type AuthlibLoginPhase =
  /** Проверка сервера/метаданных */
  | "metadata"
  /** Вход (authenticate) */
  | "authenticate"
  /** Загрузка профилей и текстур */
  | "profiles"

/** Полезная нагрузка события `authlib:login-progress`. */
export interface AuthlibLoginProgress {
  phase: AuthlibLoginPhase
}

/** Статус ensure-session перед запуском. */
export type AuthlibSessionStatus =
  /** Токен валиден */
  | "valid"
  /** Токен обновлён (новый accessToken уже сохранён в БД) */
  | "refreshed"
  /** Токен мёртв — нужен повторный вход (аккаунт НЕ удаляется) */
  | "expired"
  /** Сервер недоступен — оставляем как есть, лаунчер не падает */
  | "unreachable"
  /** Аккаунт не найден / не authlib-типа */
  | "not_found"

export interface AuthlibSessionOutcome {
  status: AuthlibSessionStatus
  /** Человекочитаемая причина (для UI), если есть */
  message?: string
}
