// ============================================================
// @xnlc/skins — маппинг ответов Laby в модель лаунчера
// ============================================================
//
// Чистые функции без побочных эффектов: на вход сырой JSON, на выход — модели
// каталога. Битые элементы отбрасываются (`null`), а не роняют всю выдачу:
// выдача каталога на миллионы записей, и один сломанный элемент в ней — норма.

import type { LabyPlayerSkin, LabySkin, LabyTag } from "@xnlc/types"
import { isLabyHash, isLabyUuid, labyRenderUrl, labyTextureUrl } from "./urls.js"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
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
    useCount: asCount(raw.use_count),
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
    useCount: asCount(raw.use_count),
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
        .filter((entry): entry is { hash: string; slim: boolean } => entry !== null)
    : []

  return {
    id,
    name,
    label: typeof translated === "string" && translated ? translated : name,
    useCount: asCount(raw.use_count),
    color: typeof raw.color === "string" && raw.color ? raw.color : null,
    preview,
  }
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
        useCount: asCount(item.use_count),
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