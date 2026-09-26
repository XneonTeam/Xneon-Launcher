// ============================================================
// @xnlc/skins — локальные фильтры и «похожие» скины
// ============================================================
//
// У Laby нет ни серверной фильтрации по тегам, ни эндпоинта «похожие», поэтому
// и то, и другое считается по уже загруженному пулу. Здесь только чистые
// функции: пул поднимает `LabyCatalog`.

import type { LabySkin } from "@xnlc/types"

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

/** Убирает повторы по хэшу, сохраняя порядок первого появления. */
export function dedupeSkins(skins: Iterable<LabySkin>): LabySkin[] {
  const seen = new Map<string, LabySkin>()
  for (const skin of skins) if (!seen.has(skin.hash)) seen.set(skin.hash, skin)
  return [...seen.values()]
}