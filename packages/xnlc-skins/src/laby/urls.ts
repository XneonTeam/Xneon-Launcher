// ============================================================
// @xnlc/skins — адреса и валидация Laby
// ============================================================
//
// Laby — открытый каталог скинов (https://laby.net). Публичный API v3 не
// требует ключа, но и CORS-заголовков не отдаёт, поэтому метаданные тянет
// main-процесс. Текстуры и рендеры, наоборот, отдаются напрямую с CDN и
// разрешают кросс-доменные запросы — их можно ставить в `<img src>` и даже
// читать пиксели для палитры.
//
// Что реально проверено запросами:
//   GET  /api/v3/search/textures/skin?size&offset&order  — постраничная выдача
//   GET  /api/v3/tag/{id}?size&offset                    — скины одного тега
//   GET  /api/v3/tags                                    — каталог тегов
//   GET  /api/v3/user/{ник}/uniqueId                     — ник → UUID
//   GET  /api/v3/user/{uuid}/textures                    — история скинов игрока
//   GET  https://texture.laby.net/{hash}.png             — текстура 64×64
//   GET  /api/v3/render/skin/{hash}.png                  — рендер 256×256
// Параметры `search`, `tag`, `tags`, `category`, `q` на поиске ИГНОРИРУЮТСЯ
// (проверено: выдача не меняется), поэтому фильтры считаются локально.
//
// Защищено проверкой Laby (428 «Challenge token required»):
// `/user/{uuid}/profile` и `/api/search/names/{query}`. Обходить её лаунчер не
// должен, поэтому поиск идёт по точному нику, а история скинов берётся из
// `/textures` — там те же данные.

import type { LabyOrder } from "@xnlc/types"

/** Единственное место, где заданы адреса API. */
export const LABY_API_BASE = "https://laby.net/api/v3"
export const LABY_TEXTURE_BASE = "https://texture.laby.net"
export const LABY_RENDER_BASE = "https://laby.net/api/v3/render/skin"
export const LABY_SKIN_PAGE_BASE = "https://laby.net/skins"
export const LABY_PROFILE_TEXTURE_BASE = "https://laby.net/texture/profile"

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
export const LABY_ORDERS: LabyOrder[] = ["trending_24h", "trending_7d", "trending_30d", "most_used", "latest"]

/** Порядок по умолчанию: то, что Laby показывает первым. */
export const LABY_DEFAULT_ORDER: LabyOrder = "trending_24h"

/** Периоды трендов — та же тройка, что Laby предлагает на своём сайте. */
export const LABY_TREND_ORDERS: LabyOrder[] = ["trending_24h", "trending_7d", "trending_30d"]

/** Сервер не принимает size больше 100 (проверено: size=200 отдаёт 100). */
export const LABY_MAX_PAGE_SIZE = 100

const HASH_PATTERN = /^[0-9a-f]{32}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLabyHash(value: unknown): boolean {
  return typeof value === "string" && HASH_PATTERN.test(value)
}

export function isLabyUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/** Minecraft-ники: латиница, цифры и подчёркивание; Laby пускает и точку. */
export function sanitizeLabyUsername(value: unknown): string {
  const username = String(value ?? "").trim().slice(0, 32)
  return /^[A-Za-z0-9_.]+$/.test(username) ? username : ""
}

export function isLabyUsername(value: string): boolean {
  return /^[A-Za-z0-9_.]+$/.test(value)
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

export function labyPlayerPageUrl(username: string): string {
  const name = sanitizeLabyUsername(username)
  return name ? `https://laby.net/@${encodeURIComponent(name)}` : "https://laby.net"
}

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

/** Смещение страницы. Laby пагинируется через `offset`, а не `page`. */
export function labyPagesOffset(page: number, size: number): number {
  return Math.max(0, Math.floor(page)) * Math.max(1, Math.floor(size))
}

function clampSize(value: number): number {
  const floored = Math.floor(value)
  const size = Number.isFinite(floored) ? floored : 1
  return Math.min(Math.max(size, 1), LABY_MAX_PAGE_SIZE)
}

function clampOffset(value: number): number {
  const floored = Math.floor(value)
  return Number.isFinite(floored) ? Math.max(0, floored) : 0
}

/** URL ленты каталога. Формула смещения — только в `labyPagesOffset`. */
export function labySearchUrl(params: { order: LabyOrder; size: number; offset: number }): string {
  return `${LABY_API_BASE}/search/textures/skin?size=${clampSize(params.size)}&offset=${clampOffset(params.offset)}&order=${params.order}`
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
  return `${LABY_API_BASE}/tag/${tagId}?size=${clampSize(params.size)}&offset=${clampOffset(params.offset)}`
}

export function labyTagsUrl(): string {
  return `${LABY_API_BASE}/tags`
}

export function labyUniqueIdUrl(username: string): string {
  return `${LABY_API_BASE}/user/${encodeURIComponent(username)}/uniqueId`
}

export function labyUserTexturesUrl(uuid: string): string {
  return `${LABY_API_BASE}/user/${uuid}/textures`
}