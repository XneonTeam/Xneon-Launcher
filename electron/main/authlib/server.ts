// ============================================================
// XNLC — Authlib-Injector: server resolve & metadata
// Нативная реализация locateServer + fetchMetadata для Xneon:
//   1. нормализация URL (https по умолчанию);
//   2. GET исходного URL;
//   3. header x-authlib-injector-api-location → реальный API root
//      (относительный путь разрешается относительно ответа);
//   4. нормализация завершающего слэша;
//   5. GET метаданных + проверка JSON;
//   6. объект AuthlibInjectorServer со стабильным id.
// ============================================================

import crypto from "node:crypto"
import type {
  AuthlibInjectorMetadata,
  AuthlibInjectorServer,
} from "@xnlc/types" with { "resolution-mode": "import" }
import {
  AuthlibError,
  AuthServerInvalidMetadataError,
  AuthServerInvalidUrlError,
  AuthServerNotFoundError,
  AuthServerUnsupportedError,
  toAuthlibError,
} from "./errors"

/** Header, которым authlib-совместимый сервер сообщает свой API root. */
export const AUTHLIB_API_LOCATION_HEADER = "x-authlib-injector-api-location"

/** Таймаут всех сетевых операций resolve/metadata, мс. */
const REQUEST_TIMEOUT_MS = 15_000

/** Сколько раз повторять запрос при временной сетевой ошибке (1 retry). */
const MAX_ATTEMPTS = 2

/**
 * Нормализует введённый пользователем URL:
 * - пустой → ошибка;
 * - без протокола → https://;
 * - пробелы по краям убираются;
 * - завершающий слэш добавляется (API root Yggdrasil — «папка»).
 */
export function normalizeServerUrl(input: string): string {
  let url = (input ?? "").trim()
  if (!url) throw new AuthServerInvalidUrlError("URL is empty")

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = `https://${url}`
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AuthServerInvalidUrlError(`Cannot parse URL: ${url}`)
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AuthServerUnsupportedError(`Unsupported protocol: ${parsed.protocol}`)
  }
  if (!parsed.hostname) {
    throw new AuthServerInvalidUrlError("URL has no host")
  }
  // userinfo (https://user:pass@host/) недопустим: такой URL попал бы в БД,
  // в логи и в аргумент -javaagent:...=<url>, то есть логин/пароль были бы
  // видны в командной строке запущенного процесса.
  if (parsed.username || parsed.password) {
    throw new AuthServerInvalidUrlError("URL must not contain credentials")
  }

  // Убираем мусор вида ?query#hash — для API root они не имеют смысла.
  parsed.search = ""
  parsed.hash = ""
  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname += "/"
  }
  return parsed.toString()
}

/** Стабильный id сервера: sha256 от нормализованного URL (16 hex — достаточно для уникальности). */
export function makeServerId(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl, "utf8").digest("hex").slice(0, 16)
}

/** Имя сервера по умолчанию — хост (без www). */
function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname
    return host.startsWith("www.") ? host.slice(4) : host
  } catch {
    return url
  }
}

/** Ссылки, которые мы разрешаем показывать/открывать из meta.links. */
const ALLOWED_LINK_KEYS = ["homepage", "register", "login", "support"] as const

function extractLinks(metadata: AuthlibInjectorMetadata): Record<string, string> {
  const raw = metadata?.meta?.links
  if (!raw || typeof raw !== "object") return {}
  const result: Record<string, string> = {}
  for (const key of ALLOWED_LINK_KEYS) {
    const value = raw[key]
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
      result[key] = value.trim()
    }
  }
  return result
}

/**
 * Проверяет, что тело ответа — валидные метаданные Yggdrasil-сервера.
 * Минимальное требование спецификации — JSON-объект; по возможности проверяем
 * наличие характерных ключей, чтобы отловить «попал не туда» HTML/JSON.
 */
export function parseMetadata(body: string): AuthlibInjectorMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new AuthServerInvalidMetadataError("Server response is not valid JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthServerInvalidMetadataError("Server metadata is not a JSON object")
  }
  const obj = parsed as AuthlibInjectorMetadata
  // authlib-injector ожидает корень с demoName/meta/links либо Yggdrasil-демку.
  const looksLikeYggdrasil =
    (obj.meta && typeof obj.meta === "object") ||
    "links" in obj ||
    "serverName" in obj ||
    "demoName" in obj ||
    "implementation" in obj
  if (!looksLikeYggdrasil) {
    throw new AuthServerInvalidMetadataError("Response does not look like Yggdrasil server metadata")
  }
  return obj
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort()

  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true })
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abortFromCaller)
  }
}

/** GET с одним повтором при обрыве сети. Ошибки нормализуются в typed AuthlibError. */
async function getWithRetry(url: string, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchWithTimeout(
        url,
        { method: "GET", headers: { Accept: "application/json" } },
        REQUEST_TIMEOUT_MS,
        signal,
      )
    } catch (error) {
      lastError = error
      // Таймаут/аборт не повторяем — пользователь уже ждал достаточно.
      const err = error as { name?: string }
      if (err?.name === "AbortError" || err?.name === "TimeoutError") break
    }
  }
  throw toAuthlibError(lastError)
}

/**
 * Полный resolve: URL → (возможно, через header) API root → метаданные → сервер.
 * Ничего не сохраняет — это чистая проверка перед добавлением.
 */
export async function resolveAuthlibInjectorServer(inputUrl: string): Promise<AuthlibInjectorServer> {
  const normalized = normalizeServerUrl(inputUrl)

  const rootResponse = await getWithRetry(normalized)
  if (rootResponse.status === 404) {
    throw new AuthServerNotFoundError()
  }
  if (!rootResponse.ok && rootResponse.status !== 401 && rootResponse.status !== 403) {
    // 401/403 допустимы: некоторые серверы закрывают корень, но отдают API.
    throw new AuthlibHttpError(rootResponse.status)
  }

  // 1) Header сообщает реальный API root (возможно, относительный путь).
  let apiBase = normalized
  const apiLocation = rootResponse.headers.get(AUTHLIB_API_LOCATION_HEADER)
  if (apiLocation && apiLocation.trim()) {
    try {
      apiBase = new URL(apiLocation.trim(), rootResponse.url || normalized).toString()
    } catch {
      throw new AuthServerInvalidMetadataError(`Invalid ${AUTHLIB_API_LOCATION_HEADER} header value`)
    }
    if (!apiBase.endsWith("/")) apiBase += "/"
    // Повторная нормализация протокола: header мог вернуть что угодно.
    apiBase = normalizeServerUrl(apiBase)
  }

  // 2) Метаданные: если header был — качаем их с API root; если нет —
  // тело первого ответа уже и есть metadata (сервер отдал её на корень).
  let metadataBody: string
  let htmlHint: string | undefined
  if (apiLocation && apiLocation.trim()) {
    try {
      htmlHint = await rootResponse.text()
    } catch {}
    const metaResponse = await getWithRetry(apiBase)
    if (metaResponse.status === 404) throw new AuthServerNotFoundError()
    if (!metaResponse.ok) throw new AuthlibHttpError(metaResponse.status)
    metadataBody = await metaResponse.text()
  } else {
    metadataBody = await rootResponse.text()
  }

  const metadata = parseMetadata(metadataBody)
  const server = buildServer(apiBase, metadata)

  // 3) Поиск и загрузка фавикона (ошибки не блокируют добавление сервера)
  try {
    const favicon = await resolveFavicon(apiBase, server.links.homepage, htmlHint)
    if (favicon) {
      server.favicon = favicon
    }
  } catch {}

  return server
}

function extractIconUrlFromHtml(html: string, baseUrl: string): string | undefined {
  const match =
    html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i) ||
    html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)
  if (!match || !match[1]) return undefined
  try {
    return new URL(match[1], baseUrl).toString()
  } catch {
    return undefined
  }
}

async function downloadFaviconDataUrl(url: string): Promise<string | undefined> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "image/*, */*" } }, 4000)
  if (!res.ok) return undefined
  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)
  if (buf.length === 0 || buf.length > 256 * 1024) return undefined

  let mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
  if (!mime || mime === "application/octet-stream" || mime === "text/plain") {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      mime = "image/png"
    } else if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
      mime = "image/x-icon"
    } else if (buf[0] === 0xff && buf[1] === 0xd8) {
      mime = "image/jpeg"
    } else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      mime = "image/gif"
    } else if (buf.slice(0, 100).toString("utf8").includes("<svg")) {
      mime = "image/svg+xml"
    } else {
      mime = "image/x-icon"
    }
  }
  return `data:${mime};base64,${buf.toString("base64")}`
}

/**
 * Ищет и скачивает фавикон сервера (data URL).
 * Проверяет <link rel="icon"> в HTML, стандартный /favicon.ico на источнике API
 * и на домашней странице из links.homepage.
 */
export async function resolveFavicon(
  apiBase: string,
  homepageUrl?: string,
  htmlHint?: string,
): Promise<string | undefined> {
  const candidates: string[] = []

  if (htmlHint && (htmlHint.includes("<link") || htmlHint.includes("<html"))) {
    const iconUrl = extractIconUrlFromHtml(htmlHint, apiBase)
    if (iconUrl) candidates.push(iconUrl)
  }

  try {
    const origin = new URL(apiBase).origin
    const defaultIco = `${origin}/favicon.ico`
    if (!candidates.includes(defaultIco)) candidates.push(defaultIco)
  } catch {}

  if (homepageUrl && /^https?:\/\//i.test(homepageUrl)) {
    try {
      const homeOrigin = new URL(homepageUrl).origin
      const homeIco = `${homeOrigin}/favicon.ico`
      if (!candidates.includes(homeIco)) candidates.push(homeIco)
    } catch {}
  }

  for (const candidate of candidates) {
    try {
      const dataUrl = await downloadFaviconDataUrl(candidate)
      if (dataUrl) return dataUrl
    } catch {}
  }

  if (homepageUrl && /^https?:\/\//i.test(homepageUrl)) {
    try {
      const res = await fetchWithTimeout(homepageUrl, { headers: { Accept: "text/html" } }, 3000)
      if (res.ok) {
        const text = await res.text()
        const iconUrl = extractIconUrlFromHtml(text, res.url || homepageUrl)
        if (iconUrl && !candidates.includes(iconUrl)) {
          const dataUrl = await downloadFaviconDataUrl(iconUrl)
          if (dataUrl) return dataUrl
        }
      }
    } catch {}
  }

  return undefined
}

/** Собирает объект сервера из проверенных метаданных. */
export function buildServer(
  apiBase: string,
  metadata: AuthlibInjectorMetadata,
  favicon?: string,
): AuthlibInjectorServer {
  const url = apiBase.endsWith("/") ? apiBase : `${apiBase}/`
  const nameFromMeta = typeof metadata?.meta?.serverName === "string" && metadata.meta.serverName.trim()
    ? metadata.meta.serverName.trim()
    : typeof metadata?.serverName === "string" && metadata.serverName.trim()
      ? metadata.serverName.trim()
      : ""

  return {
    id: makeServerId(url),
    url,
    name: nameFromMeta || hostLabel(url),
    nonEmailLogin: metadata?.meta?.["feature.non_email_login"] === true,
    links: extractLinks(metadata),
    favicon,
    metadataTimestamp: Date.now(),
  }
}

/** Ошибка HTTP-статуса при resolve. */
class AuthlibHttpError extends AuthlibError {
  constructor(status: number) {
    super("server_error", `Authorization server returned HTTP ${status}`)
    this.name = "AuthlibHttpError"
  }
}

// ---------- Кэш метаданных (in-memory, TTL) ----------

type MetadataCacheEntry = { metadata: AuthlibInjectorMetadata; fetchedAt: number }
const metadataCache = new Map<string, MetadataCacheEntry>()

/** TTL кэша метаданных, мс. Перед логином всё равно добываем свежие. */
export const METADATA_TTL_MS = 30 * 60 * 1000

export function getCachedMetadata(apiBase: string): AuthlibInjectorMetadata | null {
  const entry = metadataCache.get(apiBase)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > METADATA_TTL_MS) return null
  return entry.metadata
}

export function setCachedMetadata(apiBase: string, metadata: AuthlibInjectorMetadata): void {
  metadataCache.set(apiBase, { metadata, fetchedAt: Date.now() })
}

/**
 * Свежие метаданные сервера: сеть → кэш → null.
 * Для запуска игры fallback на кэш допустим (authlib-injector сам
 * подтянет метадату), для логина — нет.
 */
export async function fetchMetadata(
  apiBase: string,
  options?: { allowCached?: boolean; signal?: AbortSignal },
): Promise<AuthlibInjectorMetadata | null> {
  const url = apiBase.endsWith("/") ? apiBase : `${apiBase}/`
  try {
    const response = await getWithRetry(url, options?.signal)
    if (!response.ok) {
      if (options?.allowCached) return getCachedMetadata(url)
      return null
    }
    const metadata = parseMetadata(await response.text())
    setCachedMetadata(url, metadata)
    return metadata
  } catch {
    return options?.allowCached ? getCachedMetadata(url) : null
  }
}

// ---------- Session server API (профили/текстуры) ----------

/** URL профиля в sessionserver: GET /sessionserver/session/minecraft/profile/{uuid} */
export function profileUrl(apiBase: string, uuid: string): string {
  const clean = uuid.replace(/-/g, "")
  if (!/^[0-9a-fA-F]{32}$/.test(clean)) {
    throw new AuthServerInvalidUrlError("Invalid profile UUID")
  }
  const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`
  return `${base}sessionserver/session/minecraft/profile/${clean}`
}

/** Обновление метаданных сохранённого сервера; null → сервер недоступен. */
export async function refreshServer(server: AuthlibInjectorServer): Promise<AuthlibInjectorServer | null> {
  const metadata = await fetchMetadata(server.url)
  if (!metadata) return null
  let favicon = server.favicon
  if (!favicon) {
    try {
      favicon = await resolveFavicon(server.url, server.links?.homepage)
    } catch {}
  }
  const updated = buildServer(server.url, metadata, favicon)
  return { ...updated, id: server.id }
}
