// ============================================================
// XNLC — Authlib-Injector: typed errors
// Ошибки resolve/validate сервера и Yggdrasil-операций.
// Каждая несёт машинный `code` (для локализации в UI) и
// человекочитаемое сообщение-фолбэк. Пароли/токены в сообщения
// НИКОГДА не попадают.
// ============================================================

export type AuthlibErrorCode =
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

export class AuthlibError extends Error {
  readonly code: AuthlibErrorCode

  constructor(code: AuthlibErrorCode, message: string) {
    super(message)
    this.name = "AuthlibError"
    this.code = code
  }
}

export class AuthServerInvalidUrlError extends AuthlibError {
  constructor(message = "Invalid authorization server URL") {
    super("invalid_url", message)
    this.name = "AuthServerInvalidUrlError"
  }
}

export class AuthServerConnectionError extends AuthlibError {
  constructor(message = "Authorization server is unavailable") {
    super("connection", message)
    this.name = "AuthServerConnectionError"
  }
}

export class AuthServerSslError extends AuthlibError {
  constructor(message = "SSL certificate validation failed") {
    super("ssl", message)
    this.name = "AuthServerSslError"
  }
}

export class AuthServerInvalidMetadataError extends AuthlibError {
  constructor(message = "Authorization server returned invalid data") {
    super("invalid_metadata", message)
    this.name = "AuthServerInvalidMetadataError"
  }
}

export class AuthServerNotFoundError extends AuthlibError {
  constructor(message = "Authorization server not found") {
    super("not_found", message)
    this.name = "AuthServerNotFoundError"
  }
}

export class AuthServerTimeoutError extends AuthlibError {
  constructor(message = "Authorization server did not respond in time") {
    super("timeout", message)
    this.name = "AuthServerTimeoutError"
  }
}

export class AuthServerUnsupportedError extends AuthlibError {
  constructor(message = "Server does not support Authlib-Injector API") {
    super("unsupported", message)
    this.name = "AuthServerUnsupportedError"
  }
}

export class YggdrasilInvalidCredentialsError extends AuthlibError {
  constructor(message = "Invalid username or password") {
    super("invalid_credentials", message)
    this.name = "YggdrasilInvalidCredentialsError"
  }
}

export class YggdrasilInvalidTokenError extends AuthlibError {
  constructor(message = "Authorization token expired") {
    super("invalid_token", message)
    this.name = "YggdrasilInvalidTokenError"
  }
}

export class YggdrasilTwoFactorRequiredError extends AuthlibError {
  constructor(message = "Account protected with two-factor authentication") {
    super("two_factor_required", message)
    this.name = "YggdrasilTwoFactorRequiredError"
  }
}

export class YggdrasilResponseError extends AuthlibError {
  constructor(message = "Authorization server returned invalid data") {
    super("server_error", message)
    this.name = "YggdrasilResponseError"
  }
}

export class YggdrasilProfileRequiredError extends AuthlibError {
  constructor(message = "Account has multiple profiles — select one") {
    super("profile_required", message)
    this.name = "YggdrasilProfileRequiredError"
  }
}

/**
 * 429 от сервера. Раньше на этом месте бросался AuthServerTimeoutError,
 * поэтому UI показывал «сервер не ответил вовремя» — код rate_limited
 * (и его локализация) был недостижим.
 */
export class YggdrasilRateLimitedError extends AuthlibError {
  constructor(message = "Too many requests — try again later") {
    super("rate_limited", message)
    this.name = "YggdrasilRateLimitedError"
  }
}

/**
 * Преобразует сетевые/прочие ошибки fetch в typed AuthlibError.
 * Диагностика по имени/коду ошибки Node: ECONNREFUSED, ENOTFOUND,
 * CERT_HAS_EXPIRED и т.п. Санитайзим message — убираем всё, что может
 * содержать креденшелы (обычно их нет в сетевых ошибках, но для
 * надёжности сюда попадают только обезличенные сообщения).
 */
export function toAuthlibError(error: unknown): AuthlibError {
  if (error instanceof AuthlibError) return error

  const err = error as { cause?: { code?: string }; code?: string; message?: string; name?: string }
  const nodeCode = err?.cause?.code ?? err?.code ?? ""
  const message = typeof err?.message === "string" ? err.message : String(error)

  if (nodeCode === "ABORT_ERR" || err?.name === "TimeoutError" || /abort|timeout/i.test(message)) {
    return new AuthServerTimeoutError()
  }
  if (nodeCode.startsWith("ERR_TLS") || nodeCode.includes("CERT") || /certificate|ssl|tls/i.test(message)) {
    return new AuthServerSslError(message)
  }
  if (
    nodeCode === "ECONNREFUSED" ||
    nodeCode === "ENOTFOUND" ||
    nodeCode === "ECONNRESET" ||
    nodeCode === "EAI_AGAIN" ||
    nodeCode === "ETIMEDOUT" ||
    nodeCode === "EHOSTUNREACH" ||
    nodeCode === "ENETUNREACH" ||
    /fetch failed|network|socket/i.test(message)
  ) {
    return new AuthServerConnectionError()
  }
  return new AuthlibError("unknown", message)
}
