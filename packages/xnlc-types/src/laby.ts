// ============================================================
// @xnlc/types — Laby (каталог скинов)
// ============================================================
//
// Laby — открытый каталог скинов (https://laby.net). Публичный API v3 не
// требует ключа, но и CORS-заголовков не отдаёт, поэтому метаданные тянет
// main-процесс. Текстуры и рендеры, наоборот, отдаются напрямую с CDN и
// разрешают кросс-доменные запросы — их можно ставить в `<img src>` и даже
// читать пиксели для палитры.
//
// Что реально проверено запросами (см. отчёт):
//   GET  /api/v3/search/textures/skin?size&offset&order  — постраничная выдача
//   GET  /api/v3/tags                                    — каталог тегов
//   GET  https://texture.laby.net/{hash}.png             — текстура 64×64
//   GET  /api/v3/render/skin/{hash}.png                  — рендер 256×256
// Параметры `search`, `tag`, `tags`, `category`, `q` на поиске ИГНОРИРУЮТСЯ
// (проверено: выдача не меняется), поэтому фильтры считаются локально.

/** Единственное место, где заданы адреса API. */
export const LABY_API_BASE = "https://laby.net/api/v3"
export const LABY_TEXTURE_BASE = "https://texture.laby.net"
export const LABY_RENDER_BASE = "https://laby.net/api/v3/render/skin"
export const LABY_SKIN_PAGE_BASE = "https://laby.net/skins"

/**
 * Режимы выдачи, которые реально поддерживает Laby.
 *
 * Проверено запросами: у каждого значения своя выдача, а неизвестное значение
 * (`popular`, `newest`, `trending`) возвращает пустой `results` — то есть
 * сервер валидирует список, и выдумывать свои имена нельзя.
 *
 * `trending_24h` / `trending_7d` / `trending_30d` — те же периоды, что Laby
 * предлагает на своём сайте («Тренды дня / недели / месяца»).
 */
export type LabyOrder = "trending_24h" | "trending_7d" | "trending_30d" | "most_used" | "latest"

export const LABY_ORDERS: LabyOrder[] = [
  "trending_24h",
  "trending_7d",
  "trending_30d",
  "most_used",
  "latest",
]

/** Порядок по умолчанию: то, что Laby показывает первым. */
export const LABY_DEFAULT_ORDER: LabyOrder = "trending_24h"

/** Сервер не принимает size больше 100 (проверено: size=200 отдаёт 100). */
export const LABY_MAX_PAGE_SIZE = 100

const HASH_PATTERN = /^[0-9a-f]{32}$/i

export function isLabyHash(value: unknown): boolean {
  return typeof value === "string" && HASH_PATTERN.test(value)
}

export function labyTextureUrl(hash: string): string {
  return isLabyHash(hash) ? `${LABY_TEXTURE_BASE}/${hash}.png` : ""
}

export function labyRenderUrl(hash: string): string {
  return isLabyHash(hash) ? `${LABY_RENDER_BASE}/${hash}.png` : ""
}

export function labySkinPageUrl(hash: string): string {
  return isLabyHash(hash) ? `${LABY_SKIN_PAGE_BASE}/${hash}` : LABY_SKIN_PAGE_BASE.replace("/skins", "")
}

/**
 * URL поиска. Laby пагинируется через `size`/`offset` — никаких `page`.
 * `offset = page * size` считает вызывающая сторона, здесь принимается уже
 * готовое смещение, чтобы формула жила в одном месте — `labyPageOffset`.
 */
export function labySearchUrl(params: { order: LabyOrder; size: number; offset: number }): string {
  const size = Math.min(Math.max(Math.floor(params.size), 1), LABY_MAX_PAGE_SIZE)
  const offset = Math.max(Math.floor(params.offset), 0)
  return `${LABY_API_BASE}/search/textures/skin?size=${size}&offset=${offset}&order=${params.order}`
}

export function labyPagesOffset(page: number, size: number): number {
  return Math.max(0, Math.floor(page)) * Math.max(1, Math.floor(size))
}

export function labyTagsUrl(): string {
  return `${LABY_API_BASE}/tags`
}

/**
 * Скины одного тега.
 *
 * Единственное место у Laby с настоящей серверной фильтрацией. Параметры
 * `tags`, `tag`, `tag_ids` на `/search/textures/skin` сервер игнорирует
 * (проверено запросами: выдача не меняется), а `/tag/{id}` отдаёт ровно скины
 * этого тега и понимает `size`/`offset` — то есть листается по-настоящему.
 *
 * `order` этот эндпоинт не поддерживает: порядок выдачи у него фиксированный,
 * поэтому переключатель сортировки на фильтр по тегу не влияет.
 */
export function labyTagSkinsUrl(params: { tagId: number; size: number; offset: number }): string {
  // `Math.floor(NaN)` остаётся NaN, а `Math.max(0, NaN)` — тоже NaN: без явной
  // проверки битый id дал бы путь `/tag/NaN`, который сервер молча не поймёт.
  const rawId = Math.floor(params.tagId)
  const tagId = Number.isFinite(rawId) ? Math.max(0, rawId) : 0
  const size = Math.min(Math.max(Math.floor(params.size) || 1, 1), LABY_MAX_PAGE_SIZE)
  const rawOffset = Math.floor(params.offset)
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0
  return `${LABY_API_BASE}/tag/${tagId}?size=${size}&offset=${offset}`
}

/** Скин в том виде, в котором его рисует UI лаунчера. */
export type LabySkin = {
  /** `image_hash` — он же стабильный ключ кэша и идентификатор избранного. */
  id: string
  hash: string
  /** Подпись: первый тег или «Skin #abcdef». У Laby имён у скинов нет. */
  name: string
  tags: string[]
  slim: boolean
  /** Сколько раз скин использовали — единственная метрика, что даёт API. */
  useCount: number
  /** PNG 64×64 (CORS разрешён — годится и для палитры, и для импорта). */
  textureUrl: string
  /** Готовый рендер 256×256 для карточки. */
  renderUrl: string
  source: "laby"
}

// ── Игроки ────────────────────────────────────────────────
//
// Что проверено запросами:
//   GET /api/v3/user/{username}/uniqueId  — ник → UUID, работает;
//   GET /api/v3/user/{uuid}/textures      — вся история скинов игрока, работает;
//   GET /api/v3/featured/users            — витрина игроков, работает;
//   GET https://laby.net/texture/profile/head/{uuid}.png?size=64 — аватарка;
//   GET https://laby.net/texture/profile/skin/{uuid}.png         — текущий скин.
//
// А вот `/api/v3/user/{uuid}/profile` и `/api/search/names/{query}` отдают
// 428 «Challenge token required»: Laby закрыл их проверкой, которую лаунчер
// обходить не должен. Поэтому поиск идёт по точному нику (через uniqueId), а
// история скинов берётся из `/textures` — он не защищён и содержит ровно те же
// данные, что и `profile`.

/** Скин из истории игрока. */
export type LabyPlayerSkin = {
  hash: string
  slim: boolean
  /** Сколько раз игрок носил этот скин. */
  useCount: number
  /** Скин надет прямо сейчас. */
  active: boolean
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export type LabyPlayer = {
  uuid: string
  username: string
  /** Голова игрока: рендерит сам Laby по UUID. */
  headUrl: string
  /** Текущая текстура скина игрока. */
  skinUrl: string
  /** История скинов, свежие сверху, активный — первым. */
  skins: LabyPlayerSkin[]
  /** Сколько плащей Laby видел на игроке. */
  capesCount: number
  /** Есть в витрине Laby (`/featured/users`) — там же приходят бейджи. */
  badges: Array<{ name: string; description: string | null }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLabyUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/** Minecraft-ники: латиница, цифры и подчёркивание; Laby пускает и точку. */
export function sanitizeLabyUsername(value: unknown): string {
  const username = String(value ?? "").trim().slice(0, 32)
  return /^[A-Za-z0-9_.]+$/.test(username) ? username : ""
}

export function labyUniqueIdUrl(username: string): string {
  return `${LABY_API_BASE}/user/${encodeURIComponent(username)}/uniqueId`
}

export function labyUserTexturesUrl(uuid: string): string {
  return `${LABY_API_BASE}/user/${uuid}/textures`
}

export function labyFeaturedUsersUrl(): string {
  return `${LABY_API_BASE}/featured/users`
}

export const LABY_PROFILE_TEXTURE_BASE = "https://laby.net/texture/profile"

/** Аватарка игрока. `size` — сторона квадрата, сервер принимает 64 и 128. */
export function labyHeadUrl(uuid: string, size = 64): string {
  if (!isLabyUuid(uuid)) return ""
  return `${LABY_PROFILE_TEXTURE_BASE}/head/${uuid}.png?size=${size}`
}

/** Текущая текстура скина игрока (PNG 64×32 или 64×64). */
export function labyProfileSkinUrl(uuid: string): string {
  if (!isLabyUuid(uuid)) return ""
  return `${LABY_PROFILE_TEXTURE_BASE}/skin/${uuid}.png`
}

export function labyPlayerPageUrl(username: string): string {
  const name = sanitizeLabyUsername(username)
  return name ? `https://laby.net/@${encodeURIComponent(name)}` : "https://laby.net"
}

/** Ответ `uniqueId`: ник → UUID. */
export function mapLabyUniqueId(payload: unknown): { uuid: string; username: string } | null {
  const raw = asRecord(payload)
  const uuid = typeof raw.uniqueId === "string" ? raw.uniqueId : typeof raw.uuid === "string" ? raw.uuid : ""
  const username = typeof raw.username === "string" ? raw.username : typeof raw.name === "string" ? raw.name : ""
  if (!isLabyUuid(uuid) || !username) return null
  return { uuid, username }
}

/** Секции, которые Laby отдаёт в `/textures`. */
const TEXTURE_SECTIONS = ["SKIN", "CAPE", "CLOAK", "BANDANA"] as const

function textureSection(payload: Record<string, unknown>, section: string): unknown[] {
  return Array.isArray(payload[section]) ? (payload[section] as unknown[]) : []
}

/**
 * История скинов игрока.
 *
 * Активный скин ставим первым, остальные сортируем по последнему появлению:
 * так в сетке сверху оказывается то, что игрок носит сейчас, а дальше — история.
 */
export function mapLabyPlayerSkins(payload: unknown): LabyPlayerSkin[] {
  const raw = asRecord(payload)
  const skins = textureSection(raw, "SKIN")
    .map((entry) => {
      const item = asRecord(entry)
      const hash = typeof item.image_hash === "string" ? item.image_hash : ""
      if (!isLabyHash(hash)) return null
      return {
        hash,
        slim: item.slim_skin === true,
        useCount: typeof item.use_count === "number" ? item.use_count : 0,
        active: item.active === true,
        firstSeenAt: typeof item.first_seen_at === "string" ? item.first_seen_at : null,
        lastSeenAt: typeof item.last_seen_at === "string" ? item.last_seen_at : null,
      } satisfies LabyPlayerSkin
    })
    .filter((entry): entry is LabyPlayerSkin => entry !== null)

  const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0)
  return skins.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return time(b.lastSeenAt) - time(a.lastSeenAt)
  })
}

/** Сколько плащей Laby видел на игроке (историю плащей не показываем). */
export function mapLabyPlayerCapesCount(payload: unknown): number {
  const raw = asRecord(payload)
  return TEXTURE_SECTIONS.filter((section) => section !== "SKIN").reduce(
    (sum, section) => sum + textureSection(raw, section).length,
    0,
  )
}

/**
 * Скин игрока в общую модель каталога.
 *
 * Тегов у скинов игрока нет — только хэш и модель, поэтому подписью служит ник.
 * Дальше такой скин работает как любой другой: карточка, избранное, импорт.
 */
export function labyPlayerSkinToSkin(skin: LabyPlayerSkin, username: string): LabySkin {
  return {
    id: skin.hash,
    hash: skin.hash,
    name: username,
    tags: [],
    slim: skin.slim,
    useCount: skin.useCount,
    textureUrl: labyTextureUrl(skin.hash),
    renderUrl: labyRenderUrl(skin.hash),
    source: "laby",
  }
}

/** Игрок из витрины `/featured/users`. */
export function mapLabyFeaturedUser(value: unknown): Pick<LabyPlayer, "uuid" | "username" | "headUrl" | "skinUrl" | "badges"> | null {
  const raw = asRecord(value)
  const uuid = typeof raw.uuid === "string" ? raw.uuid : ""
  const username = typeof raw.name === "string" ? raw.name : typeof raw.username === "string" ? raw.username : ""
  if (!isLabyUuid(uuid) || !username) return null
  const badges = Array.isArray(raw.badges)
    ? raw.badges.map((entry) => {
        const badge = asRecord(entry)
        return {
          name: typeof badge.name === "string" ? badge.name : "",
          description: typeof badge.description === "string" ? badge.description : null,
        }
      }).filter((badge) => badge.name)
    : []
  return {
    uuid,
    username,
    headUrl: labyHeadUrl(uuid),
    skinUrl: labyProfileSkinUrl(uuid),
    badges,
  }
}

export type LabyTagPreview = {
  hash: string
  slim: boolean
}

export type LabyTag = {
  id: number
  /** Имя тега, как его отдаёт Laby (`Girl`). */
  name: string
  /** Локализованное имя из `translations`, если оно есть. */
  label: string
  useCount: number
  color: string | null
  /** Несколько скинов-примеров: больше трёх Laby не отдаёт. */
  preview: LabyTagPreview[]
}

/** Ошибка запроса в том виде, в котором её показывает UI. */
export type LabyApiError = {
  code: string
  message: string
  retryable: boolean
}

export type LabyCatalogPage = {
  items: LabySkin[]
  page: number
  size: number
  /** Сервер вернул полную страницу — значит есть следующая. */
  hasMore: boolean
  /**
   * Запрошенная страница уже за пределами выдачи.
   *
   * Laby не отдаёт общее количество, а на `offset` за концом списка отвечает
   * `403`, а не пустым массивом. Это не блокировка и не ошибка — так каталог
   * сообщает, что данные кончились, поэтому UI должен сказать «дальше нет», а
   * не показывать предупреждение о недоступности.
   */
  endOfFeed: boolean
  /** Данные из кэша: Laby не ответил, показываем последнее удачное. */
  stale: boolean
  /** Фильтр по тегу/тексту применён локально по загруженному пулу. */
  filteredLocally: boolean
  /**
   * Ошибка запроса. Возвращается полем, а не исключением: UI должен показать
   * состояние ошибки, а не получить необработанный reject.
   */
  error: LabyApiError | null
}

export type LabyImportResult = {
  saved: boolean
  librarySkinId: string | null
  applied: boolean
  error?: string
}

/** Теги Laby приходят одной строкой через пробел либо null. */
export function parseLabyTags(value: unknown): string[] {
  if (typeof value !== "string") return []
  return value
    .split(" ")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/** У скинов Laby нет имён — подписью служит первый тег. */
export function labySkinName(tags: string[], hash: string): string {
  if (tags.length > 0) return tags[0]
  return hash ? `Skin #${hash.slice(0, 6)}` : "Skin"
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

/** Сырой элемент `results` из Laby в модель лаунчера. */
export function mapLabySkin(value: unknown): LabySkin | null {
  const raw = asRecord(value)
  const hash = typeof raw.image_hash === "string" ? raw.image_hash : ""
  if (!isLabyHash(hash)) return null
  const tags = parseLabyTags(raw.tags)
  return {
    id: hash,
    hash,
    name: labySkinName(tags, hash),
    tags,
    slim: raw.slim === true,
    useCount: typeof raw.use_count === "number" && Number.isFinite(raw.use_count) ? raw.use_count : 0,
    textureUrl: labyTextureUrl(hash),
    renderUrl: labyRenderUrl(hash),
    source: "laby",
  }
}

/**
 * Сырой элемент `/tag/{id}` в модель лаунчера.
 *
 * Ответ тега беднее поиска: в нём нет строки `tags` и нет имени скина, только
 * хэш, модель и популярность. Поэтому подписью остаётся `Skin #abcdef`, а сам
 * тег подставляет вызывающая сторона — она единственная точно знает, по какому
 * тегу шла выдача. Пустые теги тут были бы хуже: тогда локальный фильтр и
 * «похожие» не видели бы у этих скинов вообще никаких признаков.
 */
export function mapLabyTagSkin(value: unknown, tagName?: string): LabySkin | null {
  const raw = asRecord(value)
  const hash = typeof raw.image_hash === "string" ? raw.image_hash : ""
  if (!isLabyHash(hash)) return null
  const tag = typeof tagName === "string" ? tagName.trim() : ""
  return {
    id: hash,
    hash,
    name: labySkinName([], hash),
    tags: tag ? [tag] : [],
    slim: raw.slim === true,
    useCount: typeof raw.use_count === "number" && Number.isFinite(raw.use_count) ? raw.use_count : 0,
    textureUrl: labyTextureUrl(hash),
    renderUrl: labyRenderUrl(hash),
    source: "laby",
  }
}

/** Сырой тег из `/tags` в модель лаунчера. */
export function mapLabyTag(value: unknown, locale = "ru"): LabyTag | null {
  const raw = asRecord(value)
  const id = typeof raw.id === "number" ? raw.id : Number(raw.id)
  const name = typeof raw.name === "string" ? raw.name : ""
  if (!Number.isFinite(id) || !name) return null

  const translations = asRecord(raw.translations)
  const translated = translations[locale.toUpperCase()] ?? translations[locale]
  const preview = Array.isArray(raw.preview)
    ? raw.preview
        .map((entry) => {
          const item = asRecord(entry)
          const hash = typeof item.image_hash === "string" ? item.image_hash : ""
          return isLabyHash(hash) ? { hash, slim: item.slim === true } : null
        })
        .filter((entry): entry is LabyTagPreview => entry !== null)
    : []

  return {
    id,
    name,
    label: typeof translated === "string" && translated ? translated : name,
    useCount: typeof raw.use_count === "number" ? raw.use_count : 0,
    color: typeof raw.color === "string" && raw.color ? raw.color : null,
    preview,
  }
}

/**
 * Оценка похожести двух скинов.
 *
 * Laby не предоставляет ни `/similar`, ни векторного поиска, поэтому считаем
 * сами по тому, что реально есть в выдаче: общие теги, совпадение модели и
 * популярность. Веса подобраны так, чтобы тег значил больше модели, а
 * популярность только разводила равные варианты: 10 / 5 / 3.
 *
 * Раннего выхода «нет тегов — нет похожих» здесь нет намеренно: у скина может
 * не быть тегов вовсе, и тогда единственными признаками остаются модель и
 * популярность — это честнее, чем пустой блок «похожие».
 */
export function labySimilarityScore(
  target: { tags: string[]; slim: boolean },
  candidate: { tags: string[]; slim: boolean; useCount: number },
  maxUseCount: number,
): number {
  const targetTags = new Set(target.tags.map((tag) => tag.toLowerCase()))
  const common = candidate.tags.reduce((sum, tag) => sum + (targetTags.has(tag.toLowerCase()) ? 1 : 0), 0)
  const sameModel = candidate.slim === target.slim ? 1 : 0
  const popularity = maxUseCount > 0 ? Math.min(candidate.useCount, maxUseCount) / maxUseCount : 0
  return common * 10 + sameModel * 5 + popularity * 3
}

/** Похожие скины: та же модель и/или общие теги, отсортированные по очкам. */
export function labySimilarSkins(
  target: { hash: string; tags: string[]; slim: boolean },
  pool: LabySkin[],
  limit = 8,
): LabySkin[] {
  const maxUseCount = pool.reduce((max, skin) => Math.max(max, skin.useCount), 0)
  return pool
    .filter((skin) => skin.hash !== target.hash)
    .map((skin) => ({ skin, score: labySimilarityScore(target, skin, maxUseCount) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.skin.useCount - a.skin.useCount)
    .slice(0, limit)
    .map((entry) => entry.skin)
}

/**
 * Локальный фильтр по загруженному пулу: теги и/или текст.
 *
 * Несколько тегов работают как «ИЛИ»: скин подходит, если у него есть любой из
 * выбранных. Так и ожидается в каталоге — теги вроде `Boy` и `Girl` не
 * пересекаются, и «И» дало бы пустую выдачу на осмысленном запросе. Текст
 * ищется отдельно и по-прежнему уточняет выборку.
 */
export function labyFilterSkins(
  pool: LabySkin[],
  filters: { tags?: string[] | null; query?: string | null },
): LabySkin[] {
  const tags = (filters.tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
  const query = filters.query?.trim().toLowerCase() ?? ""
  if (tags.length === 0 && !query) return pool
  return pool.filter((skin) => {
    const skinTags = skin.tags.map((tag) => tag.toLowerCase())
    const matchesTags = tags.length === 0 || tags.some((tag) => skinTags.includes(tag))
    if (!matchesTags) return false
    if (!query) return true
    if (skin.hash.includes(query)) return true
    if (skin.name.toLowerCase().includes(query)) return true
    return skinTags.some((tag) => tag.includes(query))
  })
}

/** Компактное число использований: «5,7 млн». */
export function formatUseCount(value: number, language: string): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(value)
}