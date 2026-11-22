import type { ModdexReviews } from "@xnlc/types"

/** Код ошибки для UI: ответ ModDex пришёл, но его структуру нельзя безопасно прочитать. */
export const MODDEX_REVIEWS_UNAVAILABLE = "reviews-unavailable"

function unavailable(): never { throw new Error(MODDEX_REVIEWS_UNAVAILABLE) }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredRecord(value: unknown): Record<string, unknown> {
  const result = record(value)
  if (!result) unavailable()
  return result
}

function httpsUrl(value: unknown): string {
  try { const url = new URL(String(value)); return url.protocol === "https:" ? url.href : "" } catch { return "" }
}

function category(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5 ? value : null
}

function histogramAverage(value: unknown): number | null {
  if (!Array.isArray(value)) return null
  let sum = 0, count = 0
  for (const step of value) {
    const item = record(step)
    if (!item) continue
    const rating = category(item.rating)
    const amount = item.count
    if (rating !== null && typeof amount === "number" && Number.isFinite(amount) && amount > 0) { sum += rating * amount; count += amount }
  }
  return count ? sum / count : null
}

export async function fetchModdexReviews(project: string, page = 1, request: typeof fetch = fetch, sort: "newest" | "oldest" | "rating" | "helpful" = "newest", source: "modrinth" | "curseforge" = "modrinth", type: "mod" | "modpack" = "mod"): Promise<ModdexReviews> {
  if (typeof project !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(project) || !Number.isInteger(page) || page < 1 || page > 10000) throw new Error("Invalid project or page")
  if (!["newest", "oldest", "rating", "helpful"].includes(sort)) throw new Error("Invalid sort")
  if (source !== "modrinth" && source !== "curseforge") throw new Error("Invalid review source")
  if (type !== "mod" && type !== "modpack") throw new Error("Invalid review project type")
  const lookupUrl = `https://moddex.gg/api/v2/lookup/${source}/${encodeURIComponent(project)}`
  const url = new URL(`${lookupUrl}/reviews`)
  url.searchParams.set("type", type)
  url.searchParams.set("page", String(page))
  url.searchParams.set("sort", sort)
  const response = await request(url, { headers: { Accept: "application/json", "X-Client": "xneon-launcher" }, signal: AbortSignal.timeout(10000) })
  const empty: ModdexReviews = { status: "not-found", reviews: [], average: null, categories: { gameplay: null, performance: null, aesthetics: null }, count: 0, page: 1, lastPage: 1, writeUrl: "https://moddex.gg" }
  if (response.status === 404) return empty
  if (!response.ok) throw new Error(`ModDex HTTP ${response.status}`)
  const payload: unknown = await response.json().catch(() => unavailable())
  const body = record(payload)
  if (!body) unavailable()
  const entries = body.data
  if (!Array.isArray(entries)) unavailable()
  // Список отзывов — не источник истины для шапки: пустая выдача нормальна, а счётчики
  // берём из meta.project (рейтинг, отзывы, ссылки), которое может отсутствовать.
  const meta = record(body.meta) ?? {}
  const projectMeta = record(meta.project) ?? {}
  const detailsUrl = new URL(lookupUrl)
  detailsUrl.searchParams.set("type", type)
  detailsUrl.searchParams.set("include", "ratings")
  const details: unknown = await request(detailsUrl, { headers: { Accept: "application/json", "X-Client": "xneon-launcher" }, signal: AbortSignal.timeout(10000) }).then(response => response.ok ? response.json() : null).catch(() => null)
  const detailsData = record(record(details)?.data)
  const histograms = record(record(detailsData?.ratings)?.categories)
  const rating = record(projectMeta.rating)
  const candidate = record(projectMeta.links)?.write_review
  let writeUrl = "https://moddex.gg"
  try { const parsed = new URL(String(candidate)); if (parsed.protocol === "https:" && (parsed.hostname === "moddex.gg" || parsed.hostname.endsWith(".moddex.gg"))) writeUrl = parsed.href } catch {}
  return {
    status: "ok",
    reviews: entries.slice(0, 50).map(entry => {
      const review = requiredRecord(entry)
      const author = record(review.author) ?? {}
      const categories = record(review.categories) ?? {}
      const developerResponse = record(review.developer_response)
      return {
        id: Number(review.id), author: String(author.name ?? ""), avatarUrl: httpsUrl(author.avatar_url), profileUrl: httpsUrl(author.profile_url),
        rating: Number(review.rating) || 0, title: String(review.title ?? ""), content: String(review.content ?? ""), date: String(review.created_at ?? ""),
        edited: Boolean(review.edited_at), isDeveloper: review.is_verified_developer === true,
        categories: { gameplay: category(categories.gameplay), performance: category(categories.performance), aesthetics: category(categories.aesthetics) },
        minecraftVersion: String(review.minecraft_version ?? ""), playtimeHours: typeof review.playtime_hours === "number" ? review.playtime_hours : null,
        helpfulVotes: Number(review.helpful_votes) || 0, developerResponse: String(developerResponse?.content ?? ""),
      }
    }),
    average: typeof rating?.average === "number" ? rating.average : null,
    categories: { gameplay: histogramAverage(histograms?.gameplay), performance: histogramAverage(histograms?.performance), aesthetics: histogramAverage(histograms?.aesthetics) },
    count: Number(rating?.count) || 0,
    page: Number(meta.current_page) || 1,
    lastPage: Math.max(1, Number(meta.last_page) || 1),
    writeUrl,
  }
}
