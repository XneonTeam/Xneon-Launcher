// ============================================================
// @xnlc/skins — каталог Laby
// ============================================================
//
// Три режима выдачи, потому что столько их реально поддерживает Laby:
//
//   1. без фильтров        — чистая серверная пагинация (`offset = page * size`);
//   2. ровно один тег без текста — серверная пагинация по тегу (`/tag/{id}`):
//      единственная настоящая серверная фильтрация у Laby, поэтому доступны
//      все страницы тега, а не только первые пару;
//   3. остальное (несколько тегов и/или текст) — локальная фильтрация по пулу:
//      сшить несколько серверных выдач в одну сквозную пагинацию нельзя, а
//      параметры `tags`/`tag` на поиске Laby игнорирует.
//
// Ошибка возвращается полем `error`, а не исключением: UI должен показать
// состояние ошибки, а не получить необработанный reject. Если Laby недоступен,
// отдаём последнее удачное содержимое с диска и помечаем ответ `stale`.

import type { LabyApiError, LabyCatalogPage, LabyOrder, LabyPlayer, LabySkin, LabyTag } from "@xnlc/types"
import { BoundedMap, SkinCache } from "../cache.js"
import { isValidTexture } from "../validate.js"
import type { SkinDiskCache } from "../ports.js"
import { LabyClient, toLabyApiError } from "./client.js"
import {
  mapLabyPlayerCapesCount,
  mapLabyPlayerSkins,
  mapLabySkin,
  mapLabyTag,
  mapLabyTagSkin,
  mapLabyUniqueId,
} from "./mapping.js"
import { labyFilterSkins, labySimilarSkins } from "./scoring.js"
import {
  LABY_DEFAULT_ORDER,
  LABY_MAX_PAGE_SIZE,
  isLabyHash,
  labyHeadUrl,
  labyPagesOffset,
  labyProfileSkinUrl,
  labySearchUrl,
  labyTagSkinsUrl,
  labyTagsUrl,
  labyTextureUrl,
  labyUniqueIdUrl,
  labyUserTexturesUrl,
  sanitizeLabyUsername,
} from "./urls.js"

/** Размер страницы каталога: пять полных рядов по пять карточек. */
const CATALOG_PAGE_SIZE = 25
/**
 * Сколько страниц максимум подгружаем в пул для локальных фильтров.
 * Каталог у Laby огромный, тянуть его целиком нельзя — пять страниц по 100
 * дают 500 скинов, этого хватает и для фильтра, и для «похожих».
 */
const MAX_FILTER_PAGES = 5
const POOL_PAGE_SIZE = LABY_MAX_PAGE_SIZE
/** Сколько пулов держим в памяти. Каждый — до 500 скинов. */
const MAX_POOLS = 16

const TTL_CATALOG_MS = 5 * 60_000
const TTL_TAGS_MS = 6 * 60_000
/** Профиль игрока: ник → UUID и история скинов меняются редко. */
const TTL_PLAYER_MS = 15 * 60_000

export type CatalogQuery = {
  page: number
  size?: number
  order?: LabyOrder
  tags?: string[] | null
  query?: string | null
}

type Pool = {
  skins: Map<string, LabySkin>
  sequence: string[]
  /** Индекс следующей страницы, которую нужно догрузить. */
  nextPage: number
  /** Сервер отдал неполную страницу — данных дальше нет. */
  exhausted: boolean
}

type PoolSource = {
  pool: Pool
  load: (page: number) => Promise<LabySkin[]>
}

export type LabyCatalogOptions = {
  client?: LabyClient
  disk?: SkinDiskCache
  locale?: string
}

/**
 * Каталог скинов Laby: страницы, теги, игроки, «похожие» и текстуры.
 *
 * Экземпляр держит состояние сессии — пулы загруженных страниц и кэш, — поэтому
 * создаётся один раз на процесс (`createSkinSystem`), а не на запрос.
 */
export class LabyCatalog {
  private readonly client: LabyClient
  private readonly cache: SkinCache
  private readonly pools = new BoundedMap<Pool>(MAX_POOLS)

  /** Локаль для подписей тегов; `ru` — как в UI по умолчанию. */
  locale: string

  constructor(options: LabyCatalogOptions = {}) {
    this.client = options.client ?? new LabyClient()
    this.cache = new SkinCache(options.disk)
    this.locale = options.locale ?? "ru"
  }

  // ── Страницы каталога ───────────────────────────────────

  async page(query: CatalogQuery): Promise<LabyCatalogPage> {
    const order: LabyOrder = query.order ?? LABY_DEFAULT_ORDER
    const size = Math.min(Math.max(Math.floor(query.size ?? CATALOG_PAGE_SIZE), 6), LABY_MAX_PAGE_SIZE)
    const page = Math.max(0, Math.floor(query.page ?? 0))
    const tags = (query.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean)
    const text = query.query?.trim() || null

    if (tags.length === 0 && !text) return this.serverFeedPage(order, size, page)

    // Теги разрешаем один раз: и серверной выдаче по тегу, и наполнению пула
    // нужен один и тот же ответ. `null` — каталог тегов недоступен (офлайн),
    // тогда фильтруем по общей ленте, как раньше.
    const resolved = tags.length > 0 ? await this.resolveTags(tags) : null
    // Теги запрошены, но таких у Laby нет: скинов с ними быть не может, и
    // ходить в сеть незачем.
    if (resolved && resolved.length === 0) return emptyPage(page, size, true)

    // Один тег и никакого текста — настоящая серверная пагинация по тегу.
    // Здесь доступны все страницы тега, а не только первые пару.
    if (resolved && resolved.length === 1 && !text) {
      const [{ id, name }] = resolved
      return this.serverTagPage(id, name, size, page)
    }

    return this.filteredPage({ order, size, page, tags, text, resolved })
  }

  /** Похожие скины: у Laby нет ни `/similar`, ни векторного поиска. */
  async similar(target: { hash: string; tags: string[]; slim: boolean }): Promise<LabySkin[]> {
    if (!target.hash) return []
    try {
      const candidates = new Map<string, LabySkin>()
      for (const pool of this.pools.values()) {
        for (const skin of this.items(pool)) candidates.set(skin.hash, skin)
      }
      if (candidates.size === 0) {
        // Пулы пусты (каталог ещё не открывали) — берём популярные скины.
        const pool = this.getPool("order:most_used")
        await this.ensurePool(pool, (page) => this.fetchFeedPage("most_used", POOL_PAGE_SIZE, page))
        for (const skin of this.items(pool)) candidates.set(skin.hash, skin)
      }
      return labySimilarSkins(target, [...candidates.values()])
    } catch {
      return []
    }
  }

  // ── Теги ────────────────────────────────────────────────

  /** Каталог тегов для UI. Пустой список, если Laby недоступен и кэша нет. */
  async tags(locale = this.locale): Promise<LabyTag[]> {
    const raw = await this.rawTags()
    if (!raw) return []
    return raw
      .map((entry) => mapLabyTag(entry, locale))
      .filter((tag): tag is LabyTag => tag !== null)
      .sort((a, b) => b.useCount - a.useCount)
  }

  // ── Игроки ──────────────────────────────────────────────

  /**
   * Профиль игрока по нику: ник → UUID → история скинов.
   *
   * Идём двумя запросами, потому что по нику Laby отдаёт только UUID, а история
   * скинов живёт на `/user/{uuid}/textures`. Именно этот путь, а не `/profile`:
   * последний закрыт проверкой Laby (428) и вернул бы ошибку.
   *
   * Ник должен быть точным: поиска по частичному нику у Laby нет (закрыт).
   */
  async player(username: string): Promise<LabyPlayer | null> {
    const name = sanitizeLabyUsername(username)
    if (!name) return null
    try {
      return await this.cache.json(`laby-player-${name.toLowerCase()}`, { ttl: TTL_PLAYER_MS }, async () => {
        const identity = mapLabyUniqueId(await this.client.json<unknown>(labyUniqueIdUrl(name)))
        if (!identity) return null
        const textures = await this.client.json<unknown>(labyUserTexturesUrl(identity.uuid))
        return {
          uuid: identity.uuid,
          username: identity.username,
          headUrl: labyHeadUrl(identity.uuid),
          skinUrl: labyProfileSkinUrl(identity.uuid),
          skins: mapLabyPlayerSkins(textures),
          capesCount: mapLabyPlayerCapesCount(textures),
        } satisfies LabyPlayer
      })
    } catch {
      return null
    }
  }

  // ── Текстуры ────────────────────────────────────────────

  /**
   * Текстура скина по хэшу.
   *
   * Ключ кэша — сам `image_hash`: текстура по нему неизменна, поэтому повторный
   * импорт того же скина в сеть не ходит.
   */
  async texture(hash: string): Promise<Uint8Array | null> {
    if (!isLabyHash(hash)) return null
    const data = await this.cache.binary(`laby-texture-${hash}.png`, () => this.client.texture(labyTextureUrl(hash)))
    return isValidTexture(data) ? data : null
  }

  /**
   * Модель скина по хэшу из уже загруженных пулов.
   *
   * Нужна импорту: у скина игрока модель известна только из метаданных, а
   * угадывать «классику» нельзя.
   */
  findKnownSkin(hash: string): LabySkin | null {
    for (const pool of this.pools.values()) {
      const skin = pool.skins.get(hash)
      if (skin) return skin
    }
    return null
  }

  /** Сброс кэша и пулов: нужен тестам и ручному обновлению каталога. */
  reset(): void {
    this.cache.clear()
    this.pools.clear()
  }

  // ── Внутреннее: страницы ────────────────────────────────

  /** Страница ленты: чистая серверная пагинация без фильтров. */
  private async serverFeedPage(order: LabyOrder, size: number, page: number): Promise<LabyCatalogPage> {
    const key = `laby-search_${order}_${size}_${page}`
    const pool = this.getPool(`order:${order}`)
    return this.serverPage({
      key,
      page,
      size,
      load: () => this.fetchFeedPage(order, size, page),
      onLoaded: (items) => this.add(pool, items),
    })
  }

  /** Страница скинов одного тега — серверная фильтрация, а не локальная. */
  private async serverTagPage(tagId: number, tagName: string, size: number, page: number): Promise<LabyCatalogPage> {
    const key = `laby-tag_${tagId}_${size}_${page}`
    const pool = this.getPool(`tag:${tagId}`)
    return this.serverPage({
      key,
      page,
      size,
      load: () => this.fetchTagPage(tagId, tagName, size, page),
      onLoaded: (items) => this.add(pool, items),
    })
  }

  /**
   * Общий путь серверной страницы: кэш, пул, офлайн-фолбэк и разбор конца
   * выдачи. Один код на ленту и на тег — раньше это были две копии.
   */
  private async serverPage(params: {
    key: string
    page: number
    size: number
    load: () => Promise<LabySkin[]>
    onLoaded: (items: LabySkin[]) => void
  }): Promise<LabyCatalogPage> {
    const { key, page, size } = params
    try {
      const items = await this.cache.json(key, { ttl: TTL_CATALOG_MS, disk: true }, params.load)
      params.onLoaded(items)
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
      const described = toLabyApiError(error)
      // Laby не ответил — показываем последнее удачное содержимое.
      const cached = await this.cache.stale<LabySkin[]>(key)
      if (cached && cached.length > 0) {
        return {
          items: cached,
          page,
          size,
          hasMore: cached.length >= size,
          endOfFeed: false,
          stale: true,
          filteredLocally: false,
          error: described,
        }
      }
      // Конец выдачи — не ошибка: молча сообщаем, что дальше ничего нет.
      if (isEndOfFeed(described, page)) return emptyPage(page, size, false, true)
      return { ...emptyPage(page, size, false), error: described }
    }
  }

  /** Локальная фильтрация по пулу: несколько тегов и/или текст. */
  private async filteredPage(params: {
    order: LabyOrder
    size: number
    page: number
    tags: string[]
    text: string | null
    resolved: Array<{ id: number; name: string }> | null
  }): Promise<LabyCatalogPage> {
    const { order, size, page, tags, text, resolved } = params
    try {
      // Пул наполняем серверной выдачей по тегам, а не общей лентой: так в нём
      // оказываются только релевантные скины и локальный «ИЛИ» не редеет.
      //
      // Но только когда текста нет. `/tag/{id}` не отдаёт строку `tags`, а
      // отдельного эндпоинта «теги по хэшу» у Laby нет — значит искать текст
      // внутри тег-выдачи не по чему. С текстом возвращаемся к общей ленте:
      // там теги скинов есть, и фильтр «тег + текст» работает как раньше.
      const sources: PoolSource[] =
        resolved && resolved.length > 0 && !text
          ? resolved.map((tag) => ({
              pool: this.getPool(`tag:${tag.id}`),
              load: (target: number) => this.fetchTagPage(tag.id, tag.name, POOL_PAGE_SIZE, target),
            }))
          : [
              {
                pool: this.getPool(`order:${order}`),
                load: (target: number) => this.fetchFeedPage(order, POOL_PAGE_SIZE, target),
              },
            ]

      for (const source of sources) await this.ensurePool(source.pool, source.load)

      const merged = new Map<string, LabySkin>()
      for (const source of sources) for (const skin of this.items(source.pool)) merged.set(skin.hash, skin)

      const filtered = labyFilterSkins([...merged.values()], { tags, query: text })
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
      return { ...emptyPage(page, size, true), error: toLabyApiError(error) }
    }
  }

  // ── Внутреннее: запросы ─────────────────────────────────

  private async fetchFeedPage(order: LabyOrder, size: number, page: number): Promise<LabySkin[]> {
    const payload = await this.client.json<{ results?: unknown[] }>(
      labySearchUrl({ order, size, offset: labyPagesOffset(page, size) }),
    )
    const items = Array.isArray(payload.results) ? payload.results : []
    return items.map(mapLabySkin).filter((skin): skin is LabySkin => skin !== null)
  }

  /**
   * `/tag/{id}` возвращает массив без обёртки `results` и без строки `tags`,
   * поэтому имя тега проставляем сами: мы точно знаем, по какому тегу шла выдача.
   */
  private async fetchTagPage(tagId: number, tagName: string, size: number, page: number): Promise<LabySkin[]> {
    const payload = await this.client.json<unknown>(
      labyTagSkinsUrl({ tagId, size, offset: labyPagesOffset(page, size) }),
    )
    const items = Array.isArray(payload) ? payload : []
    return items.map((entry) => mapLabyTagSkin(entry, tagName)).filter((skin): skin is LabySkin => skin !== null)
  }

  /**
   * Сырой ответ `/tags`.
   *
   * На диске держим именно сырой ответ, а не разобранные теги: разобранные
   * зависят от локали, а индексу имён и UI нужны разные подписи одного и того
   * же списка. Раньше на диск писался результат для одной локали.
   */
  private async rawTags(): Promise<unknown[] | null> {
    const key = "laby-tags"
    try {
      return await this.cache.json(key, { ttl: TTL_TAGS_MS, disk: true }, async () => {
        const payload = await this.client.json<unknown>(labyTagsUrl())
        return Array.isArray(payload) ? payload : []
      })
    } catch {
      return this.cache.stale<unknown[]>(key)
    }
  }

  /**
   * Индекс «имя тега → id и каноничное имя», с офлайн-фолбэком на дисковый кэш.
   *
   * Фильтр в UI оперирует именами (`Girl`), а серверный эндпоинт принимает
   * только числовой id, поэтому имена нужно развернуть.
   */
  private async resolveTags(names: string[]): Promise<Array<{ id: number; name: string }> | null> {
    const raw = await this.rawTags()
    if (!raw) return null
    const index = new Map<string, { id: number; name: string }>()
    for (const entry of raw) {
      const tag = mapLabyTag(entry, "en")
      if (tag) index.set(tag.name.toLowerCase(), { id: tag.id, name: tag.name })
    }
    if (index.size === 0) return null

    const resolved = new Map<number, string>()
    for (const name of names) {
      const tag = index.get(name.trim().toLowerCase())
      if (tag) resolved.set(tag.id, tag.name)
    }
    return [...resolved].map(([id, name]) => ({ id, name }))
  }

  // ── Внутреннее: пулы ────────────────────────────────────

  private getPool(key: string): Pool {
    const existing = this.pools.get(key)
    if (existing) return existing
    const pool: Pool = { skins: new Map(), sequence: [], nextPage: 0, exhausted: false }
    this.pools.set(key, pool)
    return pool
  }

  private add(pool: Pool, skins: LabySkin[]): void {
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

  private items(pool: Pool): LabySkin[] {
    return pool.sequence.map((hash) => pool.skins.get(hash)).filter((skin): skin is LabySkin => Boolean(skin))
  }

  /** Догружает пул до `MAX_FILTER_PAGES` страниц указанным источником. */
  private async ensurePool(pool: Pool, loadPage: (page: number) => Promise<LabySkin[]>): Promise<void> {
    while (!pool.exhausted && pool.nextPage < MAX_FILTER_PAGES) {
      const page = pool.nextPage
      const skins = await loadPage(page)
      pool.nextPage = page + 1
      this.add(pool, skins)
      if (skins.length < POOL_PAGE_SIZE) pool.exhausted = true
    }
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

function emptyPage(page: number, size: number, filteredLocally: boolean, endOfFeed = false): LabyCatalogPage {
  return {
    items: [],
    page,
    size,
    hasMore: false,
    endOfFeed,
    stale: false,
    filteredLocally,
    error: null,
  }
}