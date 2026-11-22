// Web-инструменты агента: чтение одной страницы (`web_fetch`) и поиск
// (`web_search`). Модуль не зависит от Electrobun: сетевой слой и разбор
// HTML отделены от регистрации IPC, поэтому проверяются без внешней сети.
import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib"
import type { AgentWebFetchResponse, AgentWebPageLink, AgentWebSearchResponse, AgentWebSearchResult } from "@xnlc/types"

/** Общий потолок операции: DNS, все редиректы и чтение тела. */
const FETCH_TIMEOUT_MS = 12_000
const SEARCH_TIMEOUT_MS = 12_000
/** Сколько байт ответа читаем; тело больше не читается. */
const MAX_RESPONSE_BYTES = 256 * 1024
/** Сколько символов основного текста отдаём модели. */
const MAX_TEXT_LENGTH = 10_000
const MAX_LINKS = 50
/** Суммарный бюджет ссылок, чтобы результат не вытеснял контекст. */
const MAX_LINK_BUDGET = 6_000
const MAX_REDIRECTS = 4
const MAX_URL_LENGTH = 2_048
const MAX_HTML_SCAN = 512 * 1024
const MAX_SEARCH_QUERY = 300
const MAX_SEARCH_RESULTS = 10
const DEFAULT_SEARCH_RESULTS = 5
/** Распаковка ограничена отдельно: защита от «zip-бомбы» в Content-Encoding. */
const MAX_DECODED_BYTES = MAX_RESPONSE_BYTES * 4

const SEARCH_ENDPOINT = "https://api.anysearch.com/v1/search"
const SEARCH_PROVIDER = "anysearch"

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"])
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/markdown"])
const JSON_TYPES = new Set(["application/json", "application/ld+json"])

// ── Проверка адресов ──────────────────────────────────────────
// Fail-closed: всё, что не удалось разобрать как публичный IP, запрещено.
const IPV4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],        // «этот» хост
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // carrier-grade NAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, включая метаданные облака
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // TEST-NET-1
  ["192.88.99.0", 24],   // 6to4 relay anycast
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmark / fake-IP DNS прокси
  ["198.51.100.0", 24],  // TEST-NET-2
  ["203.0.113.0", 24],   // TEST-NET-3
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, включая broadcast
]

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const segment = Number(part)
    if (segment > 255) return null
    value = (value << 8) | segment
  }
  return value >>> 0
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address)
  if (value === null) return false
  for (const [base, prefix] of IPV4_BLOCKED) {
    const network = ipv4ToNumber(base)
    if (network === null) continue
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    if ((value & mask) === (network & mask)) return false
  }
  return true
}

/** Разворачивает IPv6 в 8 hextet'ов; null — адрес не разобран. */
function expandIpv6(address: string): number[] | null {
  if (!address.includes(":") || address.includes("%")) return null
  const halves = address.split("::")
  if (halves.length > 2) return null
  const parse = (value: string): number[] | null => {
    if (!value) return []
    const parts = value.split(":")
    const result: number[] = []
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (part.includes(".")) {
        // IPv4-хвост допустим только последним.
        if (index !== parts.length - 1) return null
        const v4 = ipv4ToNumber(part)
        if (v4 === null) return null
        result.push((v4 >>> 16) & 0xffff, v4 & 0xffff)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
      result.push(Number.parseInt(part, 16))
    }
    return result
  }
  const left = parse(halves[0])
  const right = halves.length === 2 ? parse(halves[1]) : []
  if (!left || !right) return null
  if (halves.length === 1) return left.length === 8 ? left : null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  return [...left, ...new Array<number>(missing).fill(0), ...right]
}

function embeddedIpv4(high: number, low: number): string {
  const value = ((high << 16) | low) >>> 0
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(".")
}

function isPublicIpv6(parts: number[]): boolean {
  const [a, b, c, d, e, f, g, h] = parts
  // ::/96 — неопределённый, loopback и устаревшие IPv4-compatible адреса.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return isPublicIpv4(embeddedIpv4(g, h))
  // ::ffff:a.b.c.d — IPv4-mapped.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPublicIpv4(embeddedIpv4(g, h))
  // ::ffff:0:a.b.c.d — IPv4-translated (SIIT).
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0xffff && f === 0) return isPublicIpv4(embeddedIpv4(g, h))
  // 2002:aabb:ccdd::/48 — 6to4, внутри обычный IPv4.
  if (a === 0x2002) return isPublicIpv4(embeddedIpv4(b, c))
  // 64:ff9b::/96 — NAT64.
  if (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return isPublicIpv4(embeddedIpv4(g, h))
  // 2001:0::/32 — Teredo, внутри обфусцированный IPv4.
  if (a === 0x2001 && b === 0x0000) return false
  // fc00::/7 — unique local.
  if ((a & 0xfe00) === 0xfc00) return false
  // fe80::/10 — link-local.
  if ((a & 0xffc0) === 0xfe80) return false
  // ff00::/8 — multicast.
  if ((a & 0xff00) === 0xff00) return false
  // 2001:db8::/32 — документация.
  if (a === 0x2001 && b === 0x0db8) return false
  // 100::/64 — discard-only.
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return false
  // 2001:10::/28 и 2001:20::/28 — ORCHID.
  if (a === 0x2001 && (b & 0xfff0) === 0x0010) return false
  return true
}

/** Публичный ли адрес; неизвестный формат считается запрещённым. */
export function isPublicAddress(address: string): boolean {
  if (typeof address !== "string" || !address) return false
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) {
    const parts = expandIpv6(address)
    return parts ? isPublicIpv6(parts) : false
  }
  return false
}

// ── Разбор URL ────────────────────────────────────────────────
/** Полный HTTP(S)-адрес без учётных данных и нестандартного порта. */
export function parseWebTarget(input: string): URL {
  if (typeof input !== "string") throw new Error("Enter an HTTP or HTTPS URL")
  const value = input.trim()
  if (!value) throw new Error("Enter an HTTP or HTTPS URL")
  if (value.length > MAX_URL_LENGTH) throw new Error(`URL is too long (maximum ${MAX_URL_LENGTH} characters)`)
  let url: URL
  try { url = new URL(value) } catch { throw new Error("Enter a complete HTTP or HTTPS URL") }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs are supported")
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed")
  if (url.port) throw new Error("Only standard ports are allowed (80 for HTTP, 443 for HTTPS)")
  if (!url.hostname) throw new Error("URL has no host")
  return url
}

function dnsHostname(url: URL): string {
  const host = url.hostname
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
}

/** Разрешает имя и проверяет ВСЕ полученные адреса: смешанный ответ — отказ. */
export async function assertPublicHost(hostname: string, resolve: (hostname: string) => Promise<string[]>): Promise<string> {
  let addresses: string[]
  try {
    addresses = isIP(hostname) ? [hostname] : await resolve(hostname)
  } catch {
    throw new Error(`Cannot resolve host: ${hostname}`)
  }
  if (!Array.isArray(addresses) || !addresses.length) throw new Error(`Cannot resolve host: ${hostname}`)
  for (const address of addresses) {
    if (!isPublicAddress(address)) throw new Error("Private, loopback and reserved network addresses are not allowed")
  }
  return addresses[0]
}

// ── Сетевой слой (заменяемый в тестах) ───────────────────────
export interface WebPageResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array | Buffer>
  destroy: () => void
}

export interface WebFetchDeps {
  resolve?: (hostname: string) => Promise<string[]>
  connect?: (url: URL, address: string, signal: AbortSignal) => Promise<WebPageResponse>
  timeoutMs?: number
  maxBytes?: number
  maxText?: number
  maxLinks?: number
  maxRedirects?: number
}

async function resolvePublicHost(hostname: string): Promise<string[]> {
  const result = await lookup(hostname, { all: true, verbatim: true })
  return result.map(item => item.address)
}

function connectPage(url: URL, address: string, signal: AbortSignal): Promise<WebPageResponse> {
  const secure = url.protocol === "https:"
  return new Promise((resolve, reject) => {
    const request = secure ? httpsRequest : httpRequest
    const req = request({
      // Соединяемся с уже проверенным IP, а имя сайта передаём в Host и SNI.
      hostname: address,
      port: secure ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // Свой agent на запрос: без пула соединений и без прокси из окружения.
      agent: false,
      signal,
      headers: {
        Host: url.host,
        Accept: "text/html, application/xhtml+xml, text/plain, application/json;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": "XneonLauncher-Agent/1.0 (+https://xneon.org)",
      },
      ...(secure ? { servername: dnsHostname(url) } : {}),
    }, response => {
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        destroy: () => response.destroy(),
      })
    })
    req.on("error", reject)
    req.end()
  })
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name]
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

async function readBody(body: AsyncIterable<Uint8Array | Buffer>, limit: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk)
    if (size + bytes.length > limit) {
      chunks.push(bytes.subarray(0, limit - size))
      size = limit
      truncated = true
      break
    }
    chunks.push(bytes)
    size += bytes.length
  }
  return { buffer: Buffer.concat(chunks), truncated }
}

/** Чтение тела с гарантированным закрытием сокета даже при ошибке потока. */
async function readPageBody(response: WebPageResponse, limit: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  try {
    return await readBody(response.body, limit)
  } finally {
    response.destroy()
  }
}

function decodeBody(buffer: Buffer, encoding: string, limit: number): { buffer: Buffer; truncated: boolean } {
  const value = encoding.trim().toLowerCase()
  if (!value || value === "identity") return { buffer, truncated: false }
  let decoded: Buffer
  try {
    if (value === "gzip" || value === "x-gzip") decoded = gunzipSync(buffer, { maxOutputLength: limit })
    else if (value === "deflate") decoded = inflateSync(buffer, { maxOutputLength: limit })
    else if (value === "br") decoded = brotliDecompressSync(buffer, { maxOutputLength: limit })
    else throw new Error(`Unsupported content encoding: ${value}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsupported content encoding")) throw error
    throw new Error("Web page body could not be decoded")
  }
  return { buffer: decoded.subarray(0, limit), truncated: decoded.length > limit }
}

function decodeText(buffer: Buffer, contentType: string): string {
  const match = /charset=([^;]+)/i.exec(contentType)
  const label = match?.[1]?.trim().replace(/^["']|["']$/g, "") || "utf-8"
  try { return new TextDecoder(label).decode(buffer) } catch { return new TextDecoder("utf-8").decode(buffer) }
}

// ── Линейный разбор HTML ──────────────────────────────────────
const RAW_TEXT_TAGS = new Set(["script", "style", "noscript", "template", "svg"])
const BLOCK_TAGS = new Set(["address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul"])
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", deg: "°", middot: "·",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×", rarr: "→", larr: "←",
}

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value
  return value.replace(/&(#x?[0-9a-fA-F]{1,8}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " "
      try { return String.fromCodePoint(code) } catch { return " " }
    }
    return ENTITIES[entity.toLowerCase()] ?? " "
  })
}

/** Конец тега с учётом кавычек в атрибутах; -1 — тег не закрыт. */
function findTagEnd(source: string, from: number): number {
  let quote = ""
  for (let index = from; index < source.length; index++) {
    const char = source[index]
    if (quote) { if (char === quote) quote = "" }
    else if (char === '"' || char === "'") quote = char
    else if (char === ">") return index
  }
  return -1
}

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'=<>\`]+)`, "i")
  const match = pattern.exec(tag)
  if (!match) return null
  const value = match[1]
  return value[0] === '"' || value[0] === "'" ? value.slice(1, -1) : value
}

/** Абсолютный http(s)-адрес без учётных данных; иначе null. */
function resolveLink(href: string, baseUrl: string): string | null {
  const value = decodeEntities(href).trim()
  if (!value || value.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(value, baseUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    url.hash = ""
    return url.href
  } catch { return null }
}

function normalizeText(value: string): string {
  return decodeEntities(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\s\u00a0]+/g, " ")
}

export interface HtmlExtraction {
  title: string
  text: string
  links: AgentWebPageLink[]
  textTruncated: boolean
  linksTruncated: boolean
}

/**
 * Один проход по документу: никаких регулярных выражений по всему HTML,
 * никакой загрузки ресурсов и исполнения скриптов. Закрытые script/style,
 * title и ссылки обрабатываются отдельно, остальные теги только разделяют текст.
 */
export function extractWebPage(html: string, baseUrl: string, options: { maxText?: number; maxLinks?: number } = {}): HtmlExtraction {
  const maxText = options.maxText ?? MAX_TEXT_LENGTH
  const maxLinks = options.maxLinks ?? MAX_LINKS
  const source = html.length > MAX_HTML_SCAN ? html.slice(0, MAX_HTML_SCAN) : html
  const lower = source.toLowerCase()
  const links: AgentWebPageLink[] = []
  const seen = new Set<string>()
  let title = ""
  let text = ""
  let anchorHref: string | null = null
  let anchorText = ""
  let linkBudget = 0
  let linksTruncated = false
  // После исчерпания бюджета текст не растёт, но разбор продолжается:
  // ссылки могут стоять ниже длинного абзаца, а скан ограничен MAX_HTML_SCAN.
  const textBudget = maxText * 4

  const newline = () => { if (text && text.length < textBudget && !text.endsWith("\n")) text += "\n" }
  const pushLink = (href: string, label: string) => {
    if (seen.has(href)) return
    if (links.length >= maxLinks) { linksTruncated = true; return }
    const entry = { url: href.slice(0, 500), text: label.replace(/\s+/g, " ").trim().slice(0, 120) }
    const size = entry.url.length + entry.text.length + 24
    if (linkBudget + size > MAX_LINK_BUDGET) { linksTruncated = true; return }
    seen.add(href)
    links.push(entry)
    linkBudget += size
  }
  const addText = (raw: string) => {
    const clean = normalizeText(raw)
    if (!clean) return
    if (text.length < textBudget) text += clean
    if (anchorHref && anchorText.length < 400) anchorText += clean
  }

  let index = 0
  while (index < source.length) {
    const tagStart = source.indexOf("<", index)
    if (tagStart < 0) { addText(source.slice(index)); break }
    if (tagStart > index) addText(source.slice(index, tagStart))
    if (source.startsWith("<!--", tagStart)) {
      const end = source.indexOf("-->", tagStart + 4)
      index = end < 0 ? source.length : end + 3
      continue
    }
    const next = source[tagStart + 1]
    if (next === "!" || next === "?") {
      const end = source.indexOf(">", tagStart + 1)
      index = end < 0 ? source.length : end + 1
      continue
    }
    const tagEnd = findTagEnd(source, tagStart + 1)
    if (tagEnd < 0) break
    const raw = source.slice(tagStart + 1, tagEnd)
    index = tagEnd + 1
    const closing = raw.startsWith("/")
    const body = closing ? raw.slice(1) : raw
    const match = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(body)
    if (!match) continue
    const name = match[1].toLowerCase()

    if (!closing && (RAW_TEXT_TAGS.has(name) || name === "title" || name === "textarea")) {
      const closeAt = lower.indexOf(`</${name}`, index)
      const content = source.slice(index, closeAt < 0 ? source.length : closeAt)
      if (name === "title" && !title) title = normalizeText(content).trim().slice(0, 300)
      else if (name === "textarea") addText(content)
      if (closeAt < 0) break
      const closeEnd = source.indexOf(">", closeAt)
      index = closeEnd < 0 ? source.length : closeEnd + 1
      continue
    }

    if (name === "a") {
      if (closing) {
        if (anchorHref) pushLink(anchorHref, anchorText)
        anchorHref = null
        anchorText = ""
      } else if (!anchorHref) {
        const href = attribute(raw, "href")
        const resolved = href ? resolveLink(href, baseUrl) : null
        if (resolved) { anchorHref = resolved; anchorText = "" }
      }
      continue
    }
    if (BLOCK_TAGS.has(name)) newline()
  }

  const clean = text
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { title, text: clean.slice(0, maxText), links, textTruncated: clean.length > maxText, linksTruncated }
}

function cleanPlainText(value: string, maxText: number): { text: string; truncated: boolean } {
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { text: clean.slice(0, maxText), truncated: clean.length > maxText }
}

// ── web_fetch ─────────────────────────────────────────────────
/**
 * Загружает одну публичную HTTP(S)-страницу. Редиректы проходятся вручную:
 * каждый новый адрес заново проверяется и резолвится, поэтому ответ DNS
 * нельзя подменить между проверкой и подключением.
 */
export async function fetchAgentWebPage(input: string, deps: WebFetchDeps = {}): Promise<AgentWebFetchResponse> {
  const requested = parseWebTarget(input)
  const resolve = deps.resolve ?? resolvePublicHost
  const connect = deps.connect ?? connectPage
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = deps.maxBytes ?? MAX_RESPONSE_BYTES
  const maxText = deps.maxText ?? MAX_TEXT_LENGTH
  const maxLinks = deps.maxLinks ?? MAX_LINKS
  const maxRedirects = deps.maxRedirects ?? MAX_REDIRECTS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let current = requested
  try {
    for (let redirects = 0; ; redirects++) {
      const address = await assertPublicHost(dnsHostname(current), resolve)
      if (controller.signal.aborted) throw new Error("aborted")
      const response = await connect(current, address, controller.signal)
      const status = response.status
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = headerValue(response.headers, "location")
        response.destroy()
        if (!location) throw new Error(`Web page redirected without a location (HTTP ${status})`)
        if (redirects >= maxRedirects) throw new Error(`Too many web redirects (maximum ${maxRedirects})`)
        let next: URL
        try { next = new URL(location, current) } catch { throw new Error("Web page redirected to an invalid address") }
        current = parseWebTarget(next.href)
        continue
      }
      if (status < 200 || status >= 300) {
        response.destroy()
        throw new Error(`Web page returned HTTP ${status}`)
      }
      const contentType = headerValue(response.headers, "content-type").split(";")[0].trim().toLowerCase()
      if (!HTML_TYPES.has(contentType) && !TEXT_TYPES.has(contentType) && !JSON_TYPES.has(contentType)) {
        response.destroy()
        throw new Error(`Unsupported web content type: ${contentType || "unknown"}. Only HTML, plain text and JSON pages can be read.`)
      }
      const raw = await readPageBody(response, maxBytes)
      const decoded = decodeBody(raw.buffer, headerValue(response.headers, "content-encoding"), MAX_DECODED_BYTES)
      const decodedText = decodeText(decoded.buffer, headerValue(response.headers, "content-type"))
      if (HTML_TYPES.has(contentType)) {
        const page = extractWebPage(decodedText, current.href, { maxText, maxLinks })
        return {
          url: requested.href,
          finalUrl: current.href,
          status,
          contentType,
          title: page.title,
          text: page.text,
          links: page.links,
          truncated: raw.truncated || decoded.truncated || page.textTruncated || page.linksTruncated,
          bytes: raw.buffer.length,
          byteLimit: maxBytes,
        }
      }
      const body = cleanPlainText(decodedText, maxText)
      return {
        url: requested.href,
        finalUrl: current.href,
        status,
        contentType,
        title: "",
        text: body.text,
        links: [],
        truncated: raw.truncated || decoded.truncated || body.truncated,
        bytes: raw.buffer.length,
        byteLimit: maxBytes,
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Web request timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    if (error instanceof Error) throw error
    throw new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

// ── web_search ────────────────────────────────────────────────
export interface WebSearchDeps {
  fetch?: typeof fetch
  apiKey?: string
  timeoutMs?: number
}

/** AnySearch работает и анонимно; ключ лишь повышает лимиты и квоту. */
const SEARCH_API_KEY_ENV = "ANYSEARCH_API_KEY"

function searchApiKey(deps: WebSearchDeps): string {
  return String(deps.apiKey ?? process.env[SEARCH_API_KEY_ENV] ?? "").trim()
}

function searchFailure(status: number, message = ""): string {
  const text = message.toLowerCase()
  if (status === 401 || status === 403) return `Web search key was rejected. Check ${SEARCH_API_KEY_ENV}.`
  if (status === 429 || /rate.?limit|quota|too many/.test(text)) return `Web search limit reached. Add ${SEARCH_API_KEY_ENV} for higher limits, or try again later.`
  if (status >= 500) return `Web search service is unavailable (HTTP ${status}).`
  if (message) return `Web search failed: ${searchText(message, 200)}`
  return `Web search failed (HTTP ${status}).`
}

function searchText(value: unknown, limit: number): string {
  if (typeof value !== "string") return ""
  return decodeEntities(value).replace(/[\s\u0000-\u001f]+/g, " ").trim().slice(0, limit)
}

function safeSearchUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    // Результат поиска не должен вести в локальную сеть: такой адрес
    // модель всё равно не сможет открыть, а показывать его опасно.
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
    if (isIP(host)) {
      if (!isPublicAddress(host)) return null
    } else if (/(^|\.)(localhost|local|internal|home\.arpa)$/i.test(host)) return null
    return url
  } catch { return null }
}

/** Ответ AnySearch: обычный JSON-конверт `{ code, message, data }`. */
interface AnysearchEnvelope {
  code?: unknown
  message?: unknown
  data?: { results?: unknown; metadata?: { total_results?: unknown } | null } | null
}

/**
 * Поиск в интернете через AnySearch. Анонимный доступ разрешён, ключ
 * `ANYSEARCH_API_KEY` повышает лимиты. Запрос идёт на фиксированный хост,
 * без редиректов и прокси, тело — только JSON с запросом и лимитом.
 */
export async function searchAgentWeb(query: string, limit?: number, deps: WebSearchDeps = {}): Promise<AgentWebSearchResponse> {
  const text = typeof query === "string" ? query.trim() : ""
  if (!text) throw new Error("Web search needs a non-empty query")
  if (text.length > MAX_SEARCH_QUERY) throw new Error(`Web search query is too long (maximum ${MAX_SEARCH_QUERY} characters)`)
  let count = DEFAULT_SEARCH_RESULTS
  if (limit !== undefined) {
    if (!Number.isFinite(limit) || !Number.isInteger(limit)) throw new Error("Result limit must be a whole number")
    count = Math.max(1, Math.min(MAX_SEARCH_RESULTS, limit))
  }
  const apiKey = searchApiKey(deps)
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "XneonLauncher-Agent/1.0 (+https://xneon.org)",
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const fetchImpl = deps.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(SEARCH_ENDPOINT, {
      method: "POST",
      // Редирект не нужен и не должен уводить запрос с ключом на другой хост.
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? SEARCH_TIMEOUT_MS),
      headers,
      body: JSON.stringify({ query: text, max_results: count }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Web search service is unreachable: ${message}`)
  }
  let payload: unknown = null
  try { payload = await response.json() } catch { payload = null }
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as AnysearchEnvelope : null
  if (!response.ok) throw new Error(searchFailure(response.status, String(envelope?.message ?? "")))
  if (!envelope) throw new Error("Web search returned an invalid response")
  if (envelope.code !== undefined && envelope.code !== 0) throw new Error(searchFailure(response.status, String(envelope.message ?? "")))
  const list = envelope.data?.results
  const results: AgentWebSearchResult[] = []
  const seen = new Set<string>()
  let available = 0
  if (Array.isArray(list)) {
    available = list.length
    for (const item of list) {
      if (!item || typeof item !== "object") continue
      const record = item as Record<string, unknown>
      const link = safeSearchUrl(record.url)
      if (!link || seen.has(link.href)) continue
      seen.add(link.href)
      const source = link.hostname.replace(/^\[|\]$/g, "")
      results.push({
        title: searchText(record.title, 200) || source,
        url: link.href,
        description: searchText(record.content ?? record.snippet ?? record.description, 500),
        source,
      })
      if (results.length >= count) break
    }
  }
  const total = Number(envelope.data?.metadata?.total_results)
  if (Number.isFinite(total) && total > available) available = total
  return { query: text, provider: SEARCH_PROVIDER, results, truncated: available > results.length }
}