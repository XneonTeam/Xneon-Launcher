// ============================================================
// XNLC — Yggdrasil client
// HTTP-клиент Yggdrasil API для произвольного Authlib-Injector
// сервера. Endpoints строятся от API root (см. server.ts):
//   POST authserver/authenticate | refresh | validate | invalidate
//   GET  sessionserver/session/minecraft/profile/{uuid}
//   PUT  api/user/profile/{uuid}/skin
// Не привязан ни к одному конкретному серверу в коде.
// ============================================================

import type {
  AuthlibInjectorMetadata,
  YggdrasilAuthenticationResponse,
  YggdrasilGameProfile,
  YggdrasilProfileWithTextures,
  YggdrasilTextures,
} from "@xnlc/types" with { "resolution-mode": "import" }
import {
  AuthServerTimeoutError,
  YggdrasilInvalidCredentialsError,
  YggdrasilInvalidTokenError,
  YggdrasilRateLimitedError,
  YggdrasilTwoFactorRequiredError,
  YggdrasilResponseError,
  toAuthlibError,
} from "./errors"
import { fetchMetadata, profileUrl } from "./server"

const REQUEST_TIMEOUT_MS = 15_000

export interface YggdrasilEndpoints {
  authenticate: string
  refresh: string
  validate: string
  invalidate: string
  signout: string
  profile: (uuid: string) => string
  skin: (uuid: string) => string
  cape: (uuid: string) => string
}

/** Строит endpoint-ы от API root с завершающим слэшем. */
export function buildEndpoints(apiBase: string): YggdrasilEndpoints {
  const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`
  return {
    authenticate: `${base}authserver/authenticate`,
    refresh: `${base}authserver/refresh`,
    validate: `${base}authserver/validate`,
    invalidate: `${base}authserver/invalidate`,
    signout: `${base}authserver/signout`,
    profile: (uuid: string) => profileUrl(base, uuid),
    skin: (uuid: string) => `${base}api/user/profile/${uuid.replace(/-/g, "")}/skin`,
    cape: (uuid: string) => `${base}api/user/profile/${uuid.replace(/-/g, "")}/cape`,
  }
}

export type MinecraftAgent = { name: "Minecraft"; version: 1 }

export interface AuthenticateParams {
  username: string
  password: string
  clientToken: string
  /** Явный выбор профиля, если он уже известен */
  selectedProfile?: YggdrasilGameProfile
}

/** Ответ ошибки Yggdrasil-сервера: { error, errorMessage, cause }. */
type YggdrasilErrorBody = {
  error?: string
  errorMessage?: string
  cause?: string
}

function isYggdrasilErrorBody(value: unknown): value is YggdrasilErrorBody {
  return !!value && typeof value === "object" && typeof (value as YggdrasilErrorBody).error === "string"
}

/**
 * Маппит ошибку Yggdrasil (ForbiddenOperationException и пр.) в typed-ошибку.
 * Ключи: "Invalid credentials" → invalid_credentials, "Forbidden"/token →
 * invalid_token, прочее → server_error с безопасным сообщением.
 */
function mapYggdrasilError(
  status: number,
  body: unknown,
  endpointHint?: "authenticate" | "refresh" | "other",
): Error {
  const parsed = isYggdrasilErrorBody(body) ? body : null
  const serverError = (parsed?.error ?? "").toLowerCase()
  const cause = (parsed?.cause ?? "").toLowerCase()
  const rawMessage = (parsed?.errorMessage ?? "").toLowerCase()
  const message = parsed?.errorMessage || parsed?.error || `HTTP ${status}`

  // 1. Проверка 2FA (Two Factor Authentication / 2FA / TOTP)
  if (
    rawMessage.includes("two factor") ||
    rawMessage.includes("two-factor") ||
    rawMessage.includes("2fa") ||
    rawMessage.includes("totp") ||
    serverError.includes("two_factor") ||
    cause.includes("two_factor")
  ) {
    return new YggdrasilTwoFactorRequiredError(safeServerMessage(message))
  }

  // 2. Истечение или невалидность токена
  if (rawMessage.includes("invalid token") || serverError.includes("token")) {
    return new YggdrasilInvalidTokenError(safeServerMessage(message))
  }

  // 3. Неверные логин или пароль
  if (
    rawMessage.includes("invalid credentials") ||
    rawMessage.includes("invalid username or password") ||
    rawMessage.includes("bad credentials") ||
    cause.includes("invalid credentials") ||
    serverError.includes("credentials")
  ) {
    return new YggdrasilInvalidCredentialsError(safeServerMessage(message))
  }

  // 4. Ошибка обновления токена при refresh
  if (endpointHint === "refresh" || (status === 403 && !parsed?.errorMessage)) {
    return new YggdrasilInvalidTokenError(safeServerMessage(message))
  }

  // 5. Ограничение частоты запросов
  if (status === 429) {
    return new YggdrasilRateLimitedError("Too many requests — try again later")
  }

  // 6. Если сервер вернул понятное сообщение (например "Account is banned", "Please verify email" и т.п.)
  if (parsed?.errorMessage) {
    return new YggdrasilResponseError(safeServerMessage(parsed.errorMessage))
  }

  // 7. Общий отказ при входе без детального текста
  if (endpointHint === "authenticate") {
    return new YggdrasilInvalidCredentialsError(safeServerMessage(message))
  }

  return new YggdrasilResponseError(safeServerMessage(message))
}

/** Обрезает server message до разумной длины и убирает переводы строк. */
function safeServerMessage(message: string): string {
  return message.replace(/[\r\n]+/g, " ").slice(0, 300)
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE"
  url: string
  body?: unknown
  headers?: Record<string, string>
  /** Внешняя отмена: общий дедлайн логина или отмена подготовки запуска. */
  signal?: AbortSignal
}

/**
 * Выполняет запрос. НЕ бросает на HTTP-статусах сам по себе —
 * возвращает Response; разбор — на вызывающей стороне.
 * Объекты сериализуются в JSON; Buffer уходит как есть (multipart).
 */
async function request(options: RequestOptions): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const abortFromCaller = () => controller.abort()

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort()
    } else {
      options.signal.addEventListener("abort", abortFromCaller, { once: true })
    }
  }

  try {
    const isBuffer = Buffer.isBuffer(options.body)
    const init: RequestInit = {
      method: options.method,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined && !isBuffer ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    }
    if (options.body !== undefined) {
      init.body = (isBuffer ? new Uint8Array(options.body as Buffer) : JSON.stringify(options.body)) as BodyInit
    }
    return await fetch(options.url, init)
  } catch (error) {
    const err = error as { name?: string }
    // Отмена вызывающим кодом тоже приходит как AbortError: для UI это
    // «сервер не ответил вовремя», реальную причину решает вызывающий.
    if (err?.name === "AbortError") throw new AuthServerTimeoutError()
    throw toAuthlibError(error)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------- Session ----------

export interface YggdrasilSession {
  accessToken: string
  clientToken: string
  selectedProfile?: YggdrasilGameProfile
  availableProfiles: YggdrasilGameProfile[]
  user?: Record<string, unknown>
}

function normalizeAuthResponse(raw: unknown): YggdrasilSession {
  if (!raw || typeof raw !== "object") {
    throw new YggdrasilResponseError()
  }
  const obj = raw as Partial<YggdrasilAuthenticationResponse>
  if (typeof obj.accessToken !== "string" || !obj.accessToken) {
    throw new YggdrasilResponseError("Server response has no access token")
  }
  if (typeof obj.clientToken !== "string" || !obj.clientToken) {
    throw new YggdrasilResponseError("Server response has no client token")
  }
  const selected = obj.selectedProfile
  if (selected !== undefined && (typeof selected.id !== "string" || typeof selected.name !== "string")) {
    throw new YggdrasilResponseError("Server returned malformed selected profile")
  }
  const available = Array.isArray(obj.availableProfiles)
    ? obj.availableProfiles.filter((p): p is YggdrasilGameProfile =>
        !!p && typeof p.id === "string" && typeof p.name === "string")
    : []
  return {
    accessToken: obj.accessToken,
    clientToken: obj.clientToken,
    selectedProfile: selected,
    availableProfiles: available,
    user: obj.user,
  }
}

/**
 * POST /authserver/authenticate.
 * Пароль уходит на сервер и больше нигде не сохраняется/не логируется.
 */
export async function authenticate(
  apiBase: string,
  params: AuthenticateParams,
  signal?: AbortSignal,
): Promise<YggdrasilSession> {
  const endpoints = buildEndpoints(apiBase)
  const response = await request({
    method: "POST",
    url: endpoints.authenticate,
    signal,
    body: {
      agent: { name: "Minecraft", version: 1 } satisfies MinecraftAgent,
      username: params.username,
      password: params.password,
      clientToken: params.clientToken,
      requestUser: true,
      ...(params.selectedProfile ? { selectedProfile: params.selectedProfile } : {}),
    },
  })

  const body = await readJson(response)
  if (!response.ok) throw mapYggdrasilError(response.status, body, "authenticate")
  return normalizeAuthResponse(body)
}

/**
 * POST /authserver/refresh. Если известен selectedProfile — передаём его,
 * как требует спецификация; после ответа ПРОВЕРЯЕМ, что сервер вернул
 * профиль (иначе запуск ушёл бы с чужим/отсутствующим персонажем).
 */
export async function refresh(
  apiBase: string,
  params: { accessToken: string; clientToken?: string; selectedProfile?: YggdrasilGameProfile },
  signal?: AbortSignal,
): Promise<YggdrasilSession> {
  const endpoints = buildEndpoints(apiBase)
  const body: Record<string, unknown> = {
    accessToken: params.accessToken,
    requestUser: true,
  }
  if (params.clientToken) {
    body.clientToken = params.clientToken
  }
  if (params.selectedProfile) {
    body.selectedProfile = params.selectedProfile
  }
  const response = await request({
    method: "POST",
    url: endpoints.refresh,
    body,
    signal,
  })

  const resBody = await readJson(response)
  if (!response.ok) throw mapYggdrasilError(response.status, resBody, "refresh")
  const session = normalizeAuthResponse(resBody)

  if (params.selectedProfile) {
    const returned = session.selectedProfile
    if (!returned || returned.id.replace(/-/g, "").toLowerCase() !== params.selectedProfile.id.replace(/-/g, "").toLowerCase()) {
      throw new YggdrasilResponseError("Server did not return the selected profile")
    }
  }
  return session
}

/**
 * POST /authserver/validate. 204/пустой ответ = валиден.
 * ForbiddenOperationException (403) = токен невалиден.
 * Возвращает true/false; сетевые ошибки — throw.
 */
export async function validate(
  apiBase: string,
  params: { accessToken: string; clientToken?: string },
  signal?: AbortSignal,
): Promise<boolean> {
  const endpoints = buildEndpoints(apiBase)
  const body: Record<string, unknown> = {
    accessToken: params.accessToken,
  }
  if (params.clientToken) {
    body.clientToken = params.clientToken
  }
  const response = await request({
    method: "POST",
    url: endpoints.validate,
    body,
    signal,
  })
  if (response.ok) return true
  if (response.status === 403 || response.status === 401) return false
  const resBody = await readJson(response)
  throw mapYggdrasilError(response.status, resBody)
}

/** POST /authserver/invalidate — однократная «забыть токен». */
export async function invalidate(
  apiBase: string,
  params: { accessToken: string; clientToken?: string },
  signal?: AbortSignal,
): Promise<void> {
  const endpoints = buildEndpoints(apiBase)
  const body: Record<string, unknown> = {
    accessToken: params.accessToken,
  }
  if (params.clientToken) {
    body.clientToken = params.clientToken
  }
  const response = await request({
    method: "POST",
    url: endpoints.invalidate,
    body,
    signal,
  })
  if (!response.ok && response.status !== 403 && response.status !== 404) {
    const resBody = await readJson(response)
    throw mapYggdrasilError(response.status, resBody)
  }
}

/** POST /authserver/signout — полный выход (отзывает все токены пользователя). */
export async function signout(
  apiBase: string,
  params: { username: string; password: string },
): Promise<void> {
  const endpoints = buildEndpoints(apiBase)
  const response = await request({
    method: "POST",
    url: endpoints.signout,
    body: {
      username: params.username,
      password: params.password,
    },
  })
  if (!response.ok && response.status !== 403 && response.status !== 404) {
    const resBody = await readJson(response)
    throw mapYggdrasilError(response.status, resBody)
  }
}

// ---------- Profile & textures ----------

export interface RawProfile {
  id: string
  name: string
  properties?: Array<{ name: string; value: string }>
}

/** Декодирует Base64-значение свойства textures → SKIN/CAPE. */
export function decodeTexturesProperty(base64Value: string): YggdrasilTextures | null {
  try {
    const json = Buffer.from(base64Value, "base64").toString("utf8")
    const parsed = JSON.parse(json) as {
      textures?: {
        SKIN?: { url?: string; metadata?: { model?: string } }
        CAPE?: { url?: string }
      }
    }
    const textures: YggdrasilTextures = {}
    if (parsed.textures?.SKIN?.url) {
      textures.skin = {
        url: parsed.textures.SKIN.url,
        ...(parsed.textures.SKIN.metadata?.model ? { model: parsed.textures.SKIN.metadata.model } : {}),
      }
    }
    if (parsed.textures?.CAPE?.url) {
      textures.cape = { url: parsed.textures.CAPE.url }
    }
    return textures.skin || textures.cape ? textures : null
  } catch {
    return null
  }
}

/** GET профиля + декодирование текстур. null → профиль не найден. */
export async function fetchProfile(
  apiBase: string,
  uuid: string,
  signal?: AbortSignal,
): Promise<YggdrasilProfileWithTextures | null> {
  const endpoints = buildEndpoints(apiBase)
  const response = await request({ method: "GET", url: endpoints.profile(uuid), signal })
  if (response.status === 404) return null
  const body = await readJson(response)
  if (!response.ok) throw mapYggdrasilError(response.status, body)
  if (!body || typeof body !== "object") return null

  const profile = body as RawProfile
  if (typeof profile.id !== "string" || typeof profile.name !== "string") return null

  let textures: YggdrasilTextures | undefined
  for (const property of profile.properties ?? []) {
    if (property?.name === "textures" && typeof property.value === "string") {
      const decoded = decodeTexturesProperty(property.value)
      if (decoded) textures = decoded
    }
  }

  return { id: profile.id, name: profile.name, ...(textures ? { textures } : {}) }
}

// ---------- Skin upload ----------

export interface SkinUploadParams {
  uuid: string
  accessToken: string
  /** Путь к локальному PNG-файлу скина */
  filePath: string
  /** "slim" или "" (classic) */
  model?: "slim" | ""
}

/**
 * PUT /api/user/profile/{uuid}/skin — multipart/form-data.
 * Ошибки «сервер не поддерживает» не должны ломать аккаунт:
 * вызывающий код обязан гасить исключение и сообщать пользователю.
 */
export async function uploadSkin(apiBase: string, params: SkinUploadParams): Promise<void> {
  const fs = await import("node:fs/promises")
  const endpoints = buildEndpoints(apiBase)

  let fileBuffer: Buffer
  try {
    fileBuffer = await fs.readFile(params.filePath)
  } catch {
    throw new YggdrasilResponseError("Skin file not found")
  }

  const boundary = `----xneonauthlib${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `${params.model === "slim" ? "slim" : ""}\r\n`,
  ))
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="skin.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`,
  ))
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const response = await request({
    method: "PUT",
    url: endpoints.skin(params.uuid),
    body: Buffer.concat(parts),
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${params.accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404 && response.status !== 501) {
    const body = await readJson(response)
    throw mapYggdrasilError(response.status, body)
  }
  if (response.status === 404 || response.status === 501) {
    // Сервер не реализовал upload — это не фатально для аккаунта.
    throw new YggdrasilResponseError("This server does not support skin upload")
  }
}

/**
 * DELETE /api/user/profile/{uuid}/skin
 * Сброс скина на сервере Yggdrasil.
 */
export async function deleteSkin(
  apiBase: string,
  params: { uuid: string; accessToken: string },
): Promise<void> {
  const endpoints = buildEndpoints(apiBase)
  const response = await request({
    method: "DELETE",
    url: endpoints.skin(params.uuid),
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404 && response.status !== 501) {
    const body = await readJson(response)
    throw mapYggdrasilError(response.status, body)
  }
  if (response.status === 404 || response.status === 501) {
    throw new YggdrasilResponseError("This server does not support skin reset")
  }
}

export interface CapeUploadParams {
  uuid: string
  accessToken: string
  /** Путь к локальному PNG-файлу плаща */
  filePath: string
}

/**
 * PUT /api/user/profile/{uuid}/cape — multipart/form-data.
 */
export async function uploadCape(apiBase: string, params: CapeUploadParams): Promise<void> {
  const fs = await import("node:fs/promises")
  const endpoints = buildEndpoints(apiBase)

  let fileBuffer: Buffer
  try {
    fileBuffer = await fs.readFile(params.filePath)
  } catch {
    throw new YggdrasilResponseError("Cape file not found")
  }

  const boundary = `----xneonauthlib${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="cape.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`,
  ))
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const response = await request({
    method: "PUT",
    url: endpoints.cape(params.uuid),
    body: Buffer.concat(parts),
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${params.accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404 && response.status !== 501) {
    const body = await readJson(response)
    throw mapYggdrasilError(response.status, body)
  }
  if (response.status === 404 || response.status === 501) {
    throw new YggdrasilResponseError("This server does not support cape upload")
  }
}

/**
 * DELETE /api/user/profile/{uuid}/cape
 * Сброс плаща на сервере Yggdrasil.
 */
export async function deleteCape(
  apiBase: string,
  params: { uuid: string; accessToken: string },
): Promise<void> {
  const endpoints = buildEndpoints(apiBase)
  const response = await request({
    method: "DELETE",
    url: endpoints.cape(params.uuid),
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404 && response.status !== 501) {
    const body = await readJson(response)
    throw mapYggdrasilError(response.status, body)
  }
  if (response.status === 404 || response.status === 501) {
    throw new YggdrasilResponseError("This server does not support cape reset")
  }
}

// ---------- Клиент-обёртка ----------

/**
 * Тонкая обёртка: держит API root одного сервера и метаданные.
 * Аккаунт всегда работает через СВОЙ экземпляр (serverId привязан).
 */
export class YggdrasilClient {
  readonly apiBase: string
  private metadata: AuthlibInjectorMetadata | null
  /** Внешняя отмена/дедлайн, общий для всех запросов этого клиента. */
  private readonly signal?: AbortSignal

  constructor(apiBase: string, metadata?: AuthlibInjectorMetadata | null, signal?: AbortSignal) {
    this.apiBase = apiBase.endsWith("/") ? apiBase : `${apiBase}/`
    this.metadata = metadata ?? null
    this.signal = signal
  }

  get endpoints(): YggdrasilEndpoints {
    return buildEndpoints(this.apiBase)
  }

  /** Свежие метаданные (для prefetched-аргумента); null → сеть недоступна. */
  async loadMetadata(): Promise<AuthlibInjectorMetadata | null> {
    const fresh = await fetchMetadata(this.apiBase)
    if (fresh) this.metadata = fresh
    return this.metadata
  }

  getCachedMetadata(): AuthlibInjectorMetadata | null {
    return this.metadata
  }

  authenticate(params: AuthenticateParams): Promise<YggdrasilSession> {
    return authenticate(this.apiBase, params, this.signal)
  }

  refresh(params: { accessToken: string; clientToken?: string; selectedProfile?: YggdrasilGameProfile }): Promise<YggdrasilSession> {
    return refresh(this.apiBase, params, this.signal)
  }

  validate(params: { accessToken: string; clientToken?: string }): Promise<boolean> {
    return validate(this.apiBase, params, this.signal)
  }

  invalidate(params: { accessToken: string; clientToken?: string }): Promise<void> {
    return invalidate(this.apiBase, params, this.signal)
  }

  signout(params: { username: string; password: string }): Promise<void> {
    return signout(this.apiBase, params)
  }

  fetchProfile(uuid: string): Promise<YggdrasilProfileWithTextures | null> {
    return fetchProfile(this.apiBase, uuid, this.signal)
  }

  uploadSkin(params: SkinUploadParams): Promise<void> {
    return uploadSkin(this.apiBase, params)
  }

  deleteSkin(params: { uuid: string; accessToken: string }): Promise<void> {
    return deleteSkin(this.apiBase, params)
  }

  uploadCape(params: CapeUploadParams): Promise<void> {
    return uploadCape(this.apiBase, params)
  }

  deleteCape(params: { uuid: string; accessToken: string }): Promise<void> {
    return deleteCape(this.apiBase, params)
  }
}
