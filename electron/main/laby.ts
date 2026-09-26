import { ipcMain } from "electron"
import fs from "fs/promises"
import path from "path"
import { dbHelpers } from "../db"
import { fetchWithRetry } from "@xnlc/core/retry"
import { uploadSkinTexture, writeSkinFileToLibrary } from "./skins"
import {
  LABY_MAX_PAGE_SIZE,
  isLabyHash,
  isLabyUuid,
  labyFilterSkins,
  labyHeadUrl,
  labyPagesOffset,
  labyProfileSkinUrl,
  labySearchUrl,
  labySimilarSkins,
  labyTagSkinsUrl,
  labyTagsUrl,
  labyTextureUrl,
  labyUniqueIdUrl,
  labyUserTexturesUrl,
  mapLabyPlayerCapesCount,
  mapLabyPlayerSkins,
  mapLabySkin,
  mapLabyTag,
  mapLabyTagSkin,
  mapLabyUniqueId,
  sanitizeLabyUsername,
  type LabyApiError,
  type LabyCatalogPage,
  type LabyImportResult,
  type LabyOrder,
  type LabyPlayer,
  type LabySkin,
  type LabyTag,
} from "@xnlc/types"

/**
 * Клиент открытого каталога Laby.
 *
 * Что проверено запросами к API (см. отчёт по миграции):
 * - `GET /api/v3/search/textures/skin?size&offset&order` — реальная серверная
 *   пагинация, `size` до 100 (значение 200 обрезается до 100);
 * - `order` работает для `latest`, `most_used`, `trending_24h`;
 * - `search`, `tag`, `tags`, `category`, `q` ИГНОРИРУЮТСЯ: выдача не меняется;
 * - общего количества записей API не отдаёт, только `results`;
 * - `GET /api/v3/tags` — каталог тегов (лимит 100 запросов в окне);
 * - текстура: `https://texture.laby.net/{hash}.png` (64×64, CORS `*`);
 * - рендер: `https://laby.net/api/v3/render/skin/{hash}.png` (256×256);
 * - игрок: `GET /api/v3/user/{ник}/uniqueId` → UUID, `GET /api/v3/user/{uuid}/textures`
 *   → история скинов; аватарка `https://laby.net/texture/profile/head/{uuid}.png`.
 *
 * Защищено проверкой Laby (428 «Challenge token required»): `/user/{uuid}/profile`
 * и `/search/names/{query}`. Обходить её лаунчер не должен, поэтому поиск идёт по
 * точному нику, а история скинов берётся из `/textures` — там те же данные.
 *
 * Отсюда архитектура: выдача и пагинация — серверные, а фильтры (тег, текст)
 * и «похожие» считаются локально по загруженному пулу, потому что серверной
 * фильтрации у Laby нет.
 */

/** Размер страницы каталога: пять полных рядов по пять карточек. */
const CATALOG_PAGE_SIZE = 25
/**
 * Сколько страниц максимум подгружаем в пул для локальных фильтров.
 * Каталог у Laby огромный, тянуть его целиком нельзя — пять страниц по 100
 * дают 500 скинов, этого хватает и для фильтра, и для «похожих».
 */
const MAX_FILTER_PAGES = 5
const POOL_PAGE_SIZE = LABY_MAX_PAGE_SIZE

const TTL_CATALOG_MS = 5 * 60_000
const TTL_TAGS_MS = 6 * 60 * 60_000
/** Профиль игрока: ник → UUID и история скинов меняются редко. */
const TTL_PLAYER_MS = 15 * 60_000
/** Верхняя граница принимаемой текстуры: PNG 64×64 весит единицы килобайт. */
const MAX_TEXTURE_BYTES = 1024 * 1024

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

type CacheEntry = { at: number; data: unknown }
const memoryCache = new Map<string, CacheEntry>()

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memoryCache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T
  const data = await load()
  memoryCache.set(key, { at: Date.now(), data })
  return data
}

/**
 * Дисковый кэш страниц каталога и тегов.
 *
 * Нужен для офлайн-режима: когда Laby не отвечает, показываем последнее
 * удачное содержимое вместо пустого экрана. Лежит с остальными данными
 * лаунчера, в `<data>/cache/laby`.
 */
async function cacheDir(): Promise<string> {
  const dataDir = await dbHelpers.getLauncherDirectory()
  const dir = path.join(dataDir, "cache", "laby")
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function cacheKey(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_")
}

async function writeDiskCache(name: string, payload: unknown): Promise<void> {
  try {
    const dir = await cacheDir()
    await fs.writeFile(path.join(dir, cacheKey(name)), JSON.stringify(payload), "utf8")
  } catch {
    // Кэш вспомогательный: не смогли записать — работаем дальше.
  }
}

async function readDiskCache<T>(name: string): Promise<T | null> {
  try {
    const dir = await cacheDir()
    const raw = await fs.readFile(path.join(dir, cacheKey(name)), "utf8")
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function describeError(error: unknown, status?: number): LabyApiError {
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

/**
 * GET JSON с Laby.
 *
 * `fetchWithRetry` повторяет запросы, но про 429 не знает, а Laby отдаёт именно
 * его при превышении лимита (300 запросов на поиск, 100 на теги). Поэтому 429 и
 * 5xx обрабатываем сами: три попытки с нарастающей паузой, дальше ошибка —
 * бесконечных повторов не делаем.
 */
async function labyJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let lastStatus: number | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchWithRetry(
        url,
        { headers: { Accept: "application/json", "User-Agent": BROWSER_UA }, signal },
        { retries: 1 },
      )
      if (res.ok) return (await res.json()) as T
      lastStatus = res.status
      if (res.status !== 429 && res.status < 500) break
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
      lastStatus = undefined
      if (attempt === 2) throw error
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
  }
  if (lastError && lastStatus === undefined) throw lastError
  const described = describeError(undefined, lastStatus)
  const error = new Error(described.message) as Error & { laby?: LabyApiError }
  error.laby = described
  throw error
}

function errorFrom(error: unknown): LabyApiError {
  const carried = (error as { laby?: LabyApiError } | null)?.laby
  return carried ?? describeError(error)
}

// ── Пул каталога ──────────────────────────────────────────
// Нужен для локальных фильтров и «похожих»: серверной фильтрации у Laby нет —
// кроме тега, у которого есть собственный эндпоинт (см. `fetchTagPage`).

type Pool = {
  /** Ключ пула: `order:<режим>` или `tag:<id>`. */
  key: string
  skins: Map<string, LabySkin>
  sequence: string[]
  /** Индекс следующей страницы, которую нужно догрузить. */
  nextPage: number
  /** Сервер отдал неполную страницу — данных дальше нет. */
  exhausted: boolean
}

const pools = new Map<string, Pool>()

function getPool(key: string): Pool {
  const existing = pools.get(key)
  if (existing) return existing
  const pool: Pool = { key, skins: new Map(), sequence: [], nextPage: 0, exhausted: false }
  pools.set(key, pool)
  return pool
}

function poolAdd(pool: Pool, skins: LabySkin[]): void {
  for (const skin of skins) {
    const existing = pool.skins.get(skin.hash)
    if (existing) {
      // Метрика могла прийти из другой страницы — держим максимум.
      pool.skins.set(skin.hash, { ...existing, useCount: Math.max(existing.useCount, skin.useCount) })
      continue
    }
    pool.skins.set(skin.hash, skin)
    pool.sequence.push(skin.hash)
  }
}

function poolItems(pool: Pool): LabySkin[] {
  return pool.sequence.map((hash) => pool.skins.get(hash)).filter((skin): skin is LabySkin => Boolean(skin))
}

/** Догружает пул до `MAX_FILTER_PAGES` страниц указанным источником. */
async function ensurePool(pool: Pool, loadPage: (page: number) => Promise<LabySkin[]>): Promise<void> {
  while (!pool.exhausted && pool.nextPage < MAX_FILTER_PAGES) {
    const page = pool.nextPage
    const skins = await loadPage(page)
    pool.nextPage = page + 1
    poolAdd(pool, skins)
    if (skins.length < POOL_PAGE_SIZE) pool.exhausted = true
  }
}

const searchCacheKey = (order: LabyOrder, size: number, offset: number) => `search_${order}_${size}_${offset}`
const tagCacheKey = (tagId: number, size: number, offset: number) => `tag_${tagId}_${size}_${offset}`

async function fetchSearchPage(order: LabyOrder, size: number, page: number): Promise<LabySkin[]> {
  const url = labySearchUrl({ order, size, offset: labyPagesOffset(page, size) })
  const payload = await labyJson<{ results?: unknown[] }>(url)
  const items = Array.isArray(payload.results) ? payload.results : []
  return items.map(mapLabySkin).filter((skin): skin is LabySkin => skin !== null)
}

/**
 * Страница скинов одного тега — серверная фильтрация, а не локальная.
 *
 * `/tag/{id}` возвращает массив без обёртки `results` и без строки `tags`,
 * поэтому имя тега проставляем сами: мы точно знаем, по какому тегу шла выдача.
 */
async function fetchTagPage(tagId: number, tagName: string, size: number, page: number): Promise<LabySkin[]> {
  const url = labyTagSkinsUrl({ tagId, size, offset: labyPagesOffset(page, size) })
  const payload = await labyJson<unknown>(url)
  const items = Array.isArray(payload) ? payload : []
  return items.map((entry) => mapLabyTagSkin(entry, tagName)).filter((skin): skin is LabySkin => skin !== null)
}

// ── Теги ──────────────────────────────────────────────────

/** Сырой ответ `/tags`: он же источник и для списка в UI, и для индекса имён. */
async function loadTagsRaw(): Promise<unknown[]> {
  const payload = await cached("tags", TTL_TAGS_MS, () => labyJson<unknown>(labyTagsUrl()))
  return Array.isArray(payload) ? payload : []
}

let tagIndexCache: { at: number; value: Map<string, { id: number; name: string }> } | null = null

/**
 * Индекс «имя тега → id и каноничное имя».
 *
 * Фильтр в UI оперирует именами (`Girl`), а серверный эндпоинт принимает только
 * числовой id, поэтому имена нужно развернуть. Индекс строится из того же
 * каталога тегов, что показывает диалог категорий, и переиспользует его
 * кэши; при недоступности сети падаем на дисковый кэш — тогда фильтр по тегу
 * продолжает работать в офлайне.
 *
 * `null` означает «каталог тегов недоступен вовсе»: вызывающая сторона в этом
 * случае фильтрует по-старому, локально, а не показывает пустой экран.
 */
async function loadTagIndex(): Promise<Map<string, { id: number; name: string }> | null> {
  if (tagIndexCache && Date.now() - tagIndexCache.at < TTL_TAGS_MS) return tagIndexCache.value

  const build = (entries: LabyTag[]): Map<string, { id: number; name: string }> | null => {
    const index = new Map<string, { id: number; name: string }>()
    for (const tag of entries) index.set(tag.name.toLowerCase(), { id: tag.id, name: tag.name })
    return index.size > 0 ? index : null
  }

  let index: Map<string, { id: number; name: string }> | null = null
  try {
    const entries = (await loadTagsRaw())
      .map((entry) => mapLabyTag(entry, "en"))
      .filter((tag): tag is LabyTag => tag !== null)
    index = build(entries)
  } catch {
    index = null
  }
  if (!index) {
    const disk = await readDiskCache<LabyTag[]>("tags.json")
    index = disk ? build(disk) : null
  }

  if (index) tagIndexCache = { at: Date.now(), value: index }
  return index
}

/**
 * Имена тегов из фильтра в `{ id, name }` для серверного запроса.
 *
 * Неизвестные теги отбрасываются, повторные — схлопываются по id: сервер
 * нечувствителен к регистру, а нам каноничное имя нужно ещё и для подписи
 * скинов. Пустой массив при непустом фильтре означает «таких тегов у Laby нет».
 */
async function resolveTags(names: string[]): Promise<Array<{ id: number; name: string }> | null> {
  const index = await loadTagIndex()
  if (!index) return null
  const resolved = new Map<number, string>()
  for (const name of names) {
    const tag = index.get(name.trim().toLowerCase())
    if (tag) resolved.set(tag.id, tag.name)
  }
  return [...resolved].map(([id, name]) => ({ id, name }))
}

// ── Текстуры ──────────────────────────────────────────────

function decodeTexture(buffer: Buffer): Buffer | null {
  if (buffer.length < 8 || buffer.length > MAX_TEXTURE_BYTES) return null
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  return isPng ? buffer : null
}

/**
 * Скачивает текстуру скина и кладёт её в дисковый кэш.
 *
 * Ключ кэша — `image_hash`: текстура по нему неизменна, поэтому повторный
 * импорт того же скина в сеть не ходит.
 */
async function loadTextureBuffer(hash: string): Promise<Buffer | null> {
  if (!isLabyHash(hash)) return null
  const dir = await cacheDir()
  const file = path.join(dir, "textures", `${hash}.png`)

  try {
    const cachedFile = await fs.readFile(file)
    const valid = decodeTexture(cachedFile)
    if (valid) return valid
  } catch {
    // Кэша нет — качаем.
  }

  try {
    const res = await fetchWithRetry(
      labyTextureUrl(hash),
      { headers: { Accept: "image/png", "User-Agent": BROWSER_UA } },
      { retries: 2 },
    )
    if (!res.ok) return null
    const buffer = decodeTexture(Buffer.from(await res.arrayBuffer()))
    if (!buffer) return null
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, buffer).catch(() => {})
    return buffer
  } catch {
    return null
  }
}

/**
 * Импорт скина из каталога: текстура в «Избранное» и, по желанию, сразу на
 * аккаунт. Путь тот же, что у скинов из локального файла: `skins.ts` отвечает
 * и за запись в библиотеку, и за отправку в Minecraft Services.
 *
 * `slim` приходит явно для скинов игрока: их нет в пуле каталога, поэтому
 * определить модель по метаданным неоткуда, а угадывать «классику» нельзя.
 */
async function importFromCatalog(
  params: { hash: string; accountId: string; name?: string; slim?: boolean },
  apply: boolean,
): Promise<LabyImportResult> {
  const fail = (error: string): LabyImportResult => ({
    saved: false,
    librarySkinId: null,
    applied: false,
    error,
  })

  if (!params?.accountId) return fail("account")
  if (!isLabyHash(params.hash)) return fail("skin")

  // Идентификатор источника с префиксом: «Избранное» понимает, откуда скин, и
  // отличает новые записи от старых, сохранённых из Craftdex.
  const sourceId = `laby:${params.hash}`

  const existing = await dbHelpers.findLibrarySkinBySource(params.accountId, sourceId)
  if (existing) {
    if (!apply) return { saved: true, librarySkinId: existing.id, applied: false }
    const buffer = await fs.readFile(existing.filePath).catch(() => null)
    if (!buffer) return fail("texture")
    const applied = await uploadSkinTexture({
      accountId: params.accountId,
      buffer,
      variant: existing.variant === "slim" ? "slim" : "classic",
      capeId: existing.capeId ?? null,
    })
    return { saved: true, librarySkinId: existing.id, applied, ...(applied ? {} : { error: "apply" }) }
  }

  const buffer = await loadTextureBuffer(params.hash)
  if (!buffer) return fail("texture")

  // Модель: явный флаг важнее метаданных пула — скины игрока в пуле отсутствуют.
  const known = findKnownSkin(params.hash)
  const slim = params.slim ?? known?.slim ?? false
  const variant: "classic" | "slim" = slim ? "slim" : "classic"
  const name = (params.name?.trim() || known?.name || `Skin #${params.hash.slice(0, 6)}`).slice(0, 64)

  const saved = await writeSkinFileToLibrary({
    name,
    variant,
    accountId: params.accountId,
    capeId: null,
    buffer,
    sourceId,
  })
  if (!saved) return fail("save")

  if (!apply) return { saved: true, librarySkinId: saved.id, applied: false }

  const applied = await uploadSkinTexture({ accountId: params.accountId, buffer, variant })
  return { saved: true, librarySkinId: saved.id, applied, ...(applied ? {} : { error: "apply" }) }
}

/** Ищет скин во всех пулах: нужен, чтобы узнать модель при импорте. */
function findKnownSkin(hash: string): LabySkin | null {
  for (const pool of pools.values()) {
    const skin = pool.skins.get(hash)
    if (skin) return skin
  }
  return null
}

// ── Игроки ────────────────────────────────────────────────

/**
 * Профиль игрока по нику: ник → UUID → история скинов.
 *
 * Идём двумя запросами, потому что по нику Laby отдаёт только UUID, а история
 * скинов живёт на `/user/{uuid}/textures`. Именно этот путь, а не `/profile`:
 * последний закрыт проверкой Laby (428) и вернул бы ошибку.
 */
async function loadPlayer(username: string): Promise<LabyPlayer | null> {
  const name = sanitizeLabyUsername(username)
  if (!name) return null

  const idPayload = await labyJson<unknown>(labyUniqueIdUrl(name))
  const identity = mapLabyUniqueId(idPayload)
  if (!identity) return null

  const textures = await labyJson<unknown>(labyUserTexturesUrl(identity.uuid))
  return {
    uuid: identity.uuid,
    username: identity.username,
    headUrl: labyHeadUrl(identity.uuid),
    skinUrl: labyProfileSkinUrl(identity.uuid),
    skins: mapLabyPlayerSkins(textures),
    capesCount: mapLabyPlayerCapesCount(textures),
    // Бейджи приходят только из витрины `/featured/users`; для обычного игрока
    // их взять неоткуда — `profile` закрыт проверкой.
    badges: [],
  }
}

/**
 * Признак того, что запрошенная страница уже за пределами выдачи.
 *
 * Laby не отдаёт общее количество записей, а на `offset` за концом списка
 * отвечает `403` (проверено: и у `/search/textures/skin`, и у `/tag/{id}`).
 * Это не блокировка доступа — данные просто кончились, и пользователю нужно
 * сказать «дальше скинов нет», а не показывать предупреждение об ошибке.
 *
 * На первой странице те же коды означают уже настоящую проблему: пустая выдача
 * на `offset = 0` концом списка быть не может.
 */
function isEndOfFeed(apiError: LabyApiError, page: number): boolean {
  if (page <= 0) return false
  return apiError.code === "forbidden" || apiError.code === "not_found"
}

/**
 * Страница общей ленты Laby: чистая серверная пагинация без фильтров.
 *
 * При недоступности Laby отдаём последнее удачное содержимое из дискового кэша
 * и помечаем ответ `stale`, чтобы UI не показывал пустой экран.
 */
async function loadServerPage(order: LabyOrder, size: number, page: number): Promise<LabyCatalogPage> {
  const key = searchCacheKey(order, size, page)
  try {
    const items = await cached(key, TTL_CATALOG_MS, () => fetchSearchPage(order, size, page))
    poolAdd(getPool(`order:${order}`), items)
    await writeDiskCache(`${key}.json`, items)
    return {
      items,
      page,
      size,
      hasMore: items.length >= size,
      endOfFeed: false,
      stale: false,
      filteredLocally: false,
      error: null,
    }
  } catch (error) {
    const described = errorFrom(error)
    const cachedItems = await readDiskCache<LabySkin[]>(`${key}.json`)
    if (cachedItems && cachedItems.length > 0) {
      return {
        items: cachedItems,
        page,
        size,
        hasMore: cachedItems.length >= size,
        endOfFeed: false,
        stale: true,
        filteredLocally: false,
        error: described,
      }
    }
    // Конец выдачи — не ошибка: молча сообщаем, что дальше ничего нет.
    if (isEndOfFeed(described, page)) {
      return {
        items: [],
        page,
        size,
        hasMore: false,
        endOfFeed: true,
        stale: false,
        filteredLocally: false,
        error: null,
      }
    }
    return {
      items: [],
      page,
      size,
      hasMore: false,
      endOfFeed: false,
      stale: false,
      filteredLocally: false,
      error: described,
    }
  }
}

export function registerLabyHandlers(): void {
  /**
   * Страница каталога.
   *
   * Три режима:
   * - без фильтров — чистая серверная пагинация Laby (`offset = page * size`);
   * - ровно один тег без текстового уточнения — серверная пагинация по тегу
   *   (`/tag/{id}`): у Laby это единственная настоящая серверная фильтрация,
   *   поэтому страницы доступны все, а не только первые пару;
   * - несколько тегов и/или текст — локальная фильтрация по пулу: сшить
   *   несколько серверных выдач в одну сквозную пагинацию нельзя, а `search`
   *   параметры `tags`/`tag` игнорирует.
   *
   * Ошибку возвращаем полем `error`, а не исключением: UI должен показать
   * состояние ошибки, а не получить необработанный reject.
   */
  ipcMain.handle(
    "laby:catalog",
    async (
      _event,
      params: { page: number; size?: number; order?: LabyOrder; tags?: string[] | null; query?: string | null },
    ): Promise<LabyCatalogPage> => {
      const order: LabyOrder = params?.order ?? "trending_24h"
      const size = Math.min(Math.max(Math.floor(params?.size ?? CATALOG_PAGE_SIZE), 6), LABY_MAX_PAGE_SIZE)
      const page = Math.max(0, Math.floor(params?.page ?? 0))
      const tags = (Array.isArray(params?.tags) ? params.tags : [])
        .map((tag) => String(tag).trim())
        .filter(Boolean)
      const query = params?.query?.trim() || null
      const filtering = tags.length > 0 || Boolean(query)

      if (!filtering) {
        return loadServerPage(order, size, page)
      }

      try {
        const resolved = tags.length > 0 ? await resolveTags(tags) : []

        // Один тег и никакого текста: серверная выдача по тегу. Здесь доступны
        // все страницы тега — именно этого не хватало, когда фильтр считался по
        // пулу из 500 случайных трендовых скинов.
        if (resolved && resolved.length === 1 && !query) {
          const [{ id, name }] = resolved
          const key = tagCacheKey(id, size, page)
          try {
            const items = await cached(key, TTL_CATALOG_MS, () => fetchTagPage(id, name, size, page))
            poolAdd(getPool(`tag:${id}`), items)
            await writeDiskCache(`${key}.json`, items)
            return {
              items,
              page,
              size,
              hasMore: items.length >= size,
              endOfFeed: false,
              stale: false,
              filteredLocally: false,
              error: null,
            }
          } catch (error) {
            const described = errorFrom(error)
            const cachedItems = await readDiskCache<LabySkin[]>(`${key}.json`)
            if (cachedItems && cachedItems.length > 0) {
              return {
                items: cachedItems,
                page,
                size,
                hasMore: cachedItems.length >= size,
                endOfFeed: false,
                stale: true,
                filteredLocally: false,
                error: described,
              }
            }
            // Конец тега: Laby отдаёт `403` за последней страницей, и это
            // штатное «дальше скинов нет», а не потеря доступа.
            if (isEndOfFeed(described, page)) {
              return {
                items: [],
                page,
                size,
                hasMore: false,
                endOfFeed: true,
                stale: false,
                filteredLocally: false,
                error: null,
              }
            }
            return {
              items: [],
              page,
              size,
              hasMore: false,
              endOfFeed: false,
              stale: false,
              filteredLocally: false,
              error: described,
            }
          }
        }

        // Каталог тегов недоступен вовсе — фильтруем по-старому, по пулу
        // трендов. Теги известны, но таких тегов у Laby нет — показываем пусто:
        // скинов с несуществующим тегом быть не может, и ходить в сеть незачем.
        if (resolved && resolved.length === 0) {
          return {
            items: [],
            page,
            size,
            hasMore: false,
            endOfFeed: false,
            stale: false,
            filteredLocally: true,
            error: null,
          }
        }

        // Пул наполняем серверной выдачей по тегам, а не общей лентой: так в нём
        // оказываются только релевантные скины и локальный «ИЛИ» не редеет.
        //
        // Но только когда текста нет. `/tag/{id}` не отдаёт строку `tags`, а
        // отдельного эндпоинта «теги по хэшу» у Laby нет — значит искать текст
        // внутри тег-выдачи не по чему. С текстом возвращаемся к общей ленте:
        // там теги скинов есть, и фильтр «тег + текст» работает как раньше.
        const sources =
          resolved && !query
            ? resolved.map((tag) => ({
                pool: getPool(`tag:${tag.id}`),
                load: (target: number) => fetchTagPage(tag.id, tag.name, POOL_PAGE_SIZE, target),
              }))
            : [
                {
                  pool: getPool(`order:${order}`),
                  load: (target: number) => fetchSearchPage(order, POOL_PAGE_SIZE, target),
                },
              ]
        for (const source of sources) await ensurePool(source.pool, source.load)

        const merged = new Map<string, LabySkin>()
        for (const source of sources) for (const skin of poolItems(source.pool)) merged.set(skin.hash, skin)

        const filtered = labyFilterSkins([...merged.values()], { tags, query })
        const start = labyPagesOffset(page, size)
        return {
          items: filtered.slice(start, start + size),
          page,
          size,
          hasMore: filtered.length > start + size,
          endOfFeed: false,
          stale: false,
          filteredLocally: true,
          error: null,
        }
      } catch (error) {
        return {
          items: [],
          page,
          size,
          hasMore: false,
          endOfFeed: false,
          stale: false,
          filteredLocally: true,
          error: errorFrom(error),
        }
      }
    },
  )

  ipcMain.handle("laby:tags", async (_event, locale?: string): Promise<LabyTag[]> => {
    const language = typeof locale === "string" && locale ? locale : "ru"
    try {
      const tags = (await loadTagsRaw())
        .map((entry) => mapLabyTag(entry, language))
        .filter((tag): tag is LabyTag => tag !== null)
        .sort((a, b) => b.useCount - a.useCount)
      await writeDiskCache("tags.json", tags)
      return tags
    } catch {
      return (await readDiskCache<LabyTag[]>("tags.json")) ?? []
    }
  })

  /**
   * Похожие скины. У Laby нет ни `/similar`, ни векторного поиска, поэтому
   * считаем сами по тегам, модели и популярности — по загруженному пулу.
   */
  ipcMain.handle(
    "laby:similar",
    async (_event, params: { hash: string; tags: string[]; slim: boolean }): Promise<LabySkin[]> => {
      if (!params?.hash) return []
      const target = {
        hash: params.hash,
        tags: Array.isArray(params.tags) ? params.tags : [],
        slim: params.slim === true,
      }
      try {
        // Собираем кандидатов из всех порядков: пул мог наполняться в другом
        // режиме сортировки, а «похожие» зависеть от него не должны.
        const candidates = new Map<string, LabySkin>()
        for (const pool of pools.values()) {
          for (const skin of poolItems(pool)) candidates.set(skin.hash, skin)
        }
        if (candidates.size === 0) {
          const pool = getPool("order:most_used")
          await ensurePool(pool, (target) => fetchSearchPage("most_used", POOL_PAGE_SIZE, target))
          for (const skin of poolItems(pool)) candidates.set(skin.hash, skin)
        }
        return labySimilarSkins(target, [...candidates.values()])
      } catch {
        return []
      }
    },
  )

  /**
   * Профиль игрока по нику: аватарка, текущий скин и история скинов.
   *
   * Ник должен быть точным: поиск по частичному нику (`/api/search/names`)
   * закрыт проверкой Laby, поэтому подсказок при вводе не будет.
   */
  ipcMain.handle("laby:player", async (_event, username: string): Promise<LabyPlayer | null> => {
    try {
      return await cached(`player:${String(username ?? "").toLowerCase()}`, TTL_PLAYER_MS, () => loadPlayer(username))
    } catch {
      return null
    }
  })

  ipcMain.handle(
    "laby:save-to-library",
    async (_event, params: { hash: string; accountId: string; name?: string; slim?: boolean }) => {
      try {
        return await importFromCatalog(params, false)
      } catch {
        return { saved: false, librarySkinId: null, applied: false, error: "network" }
      }
    },
  )

  ipcMain.handle(
    "laby:apply",
    async (_event, params: { hash: string; accountId: string; name?: string; slim?: boolean }) => {
      try {
        return await importFromCatalog(params, true)
      } catch {
        return { saved: false, librarySkinId: null, applied: false, error: "network" }
      }
    },
  )
}

/** Сбрасывает кэш: нужен тестам и ручному обновлению каталога. */
export function resetLabyCache(): void {
  memoryCache.clear()
  pools.clear()
  tagIndexCache = null
}