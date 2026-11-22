import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconExternalLink, IconStarFilled, IconStar, IconShieldCheck, IconClock, IconHeart } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Reviews = Awaited<ReturnType<NonNullable<typeof window.electrobunAPI>["modsModdexReviews"]>>

function Stars({ rating }: { rating: number }) {
  return <span className="inline-flex text-primary" aria-label={`${rating} / 5`}>{[1, 2, 3, 4, 5].map(star => <span key={star} className="relative h-4 w-4"><IconStar className="absolute inset-0 h-4 w-4 text-muted-foreground/40" /><span className="absolute inset-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, rating - star + 1)) * 100}%` }}><IconStarFilled className="h-4 w-4" /></span></span>)}</span>
}

function CategoryRatings({ categories }: { categories: Reviews["categories"] }) {
  const { t } = useTranslation()
  return <div className="grid gap-3 sm:grid-cols-3">{(["gameplay", "performance", "aesthetics"] as const).map(key => { const value = categories[key]; return value === null || value <= 0 ? null : <div key={key}><div className="mb-1 flex justify-between text-sm text-muted-foreground"><span>{t(`addon.reviews.${key}`)}</span><span className="font-semibold tabular-nums text-foreground">{value.toFixed(1)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${value * 20}%` }} /></div></div> })}</div>
}

function relativeDate(value: string, language: string): string {
  const days = Math.round((Date.parse(value) - Date.now()) / 86400000)
  if (!Number.isFinite(days)) return ""
  const unit = Math.abs(days) >= 365 ? "year" : Math.abs(days) >= 30 ? "month" : "day"
  const amount = unit === "year" ? Math.round(days / 365) : unit === "month" ? Math.round(days / 30) : days
  return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(amount, unit)
}

export function AddonReviews({ project, supported, source = "modrinth", type = "mod" }: { project: string; supported: boolean; source?: "modrinth" | "curseforge"; type?: "mod" | "modpack" }) {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Reviews | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState<"newest" | "oldest" | "rating" | "helpful">("newest")

  useEffect(() => { setPage(1); setData(null); setError(false) }, [project, supported, source, type])
  useEffect(() => {
    if (!supported || !project) return
    const api = window.electrobunAPI
    if (!api) { setError(true); return }
    let cancelled = false
    setLoading(true)
    setError(false)
    api.modsModdexReviews(project, page, sort, source, type).then(result => {
      if (!cancelled) setData(result)
    }).catch(() => { if (!cancelled) setError(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project, supported, source, type, page, sort])

  if (!supported) return <p className="py-10 text-center text-muted-foreground">{t("addon.reviews.unsupported")}</p>
  return <div className="space-y-3 text-foreground">
    {loading ? <p className="py-8 text-center text-muted-foreground">{t("addon.reviews.loading")}</p> : error ? <p role="alert" className="py-8 text-center text-destructive">{t("addon.reviews.error")}</p> : data && <>
      <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {data.average !== null ? <div className="flex items-center gap-4"><span className="text-4xl font-bold tabular-nums">{data.average.toFixed(1)}</span><div className="flex flex-col gap-1"><Stars rating={data.average} /><span className="text-sm text-muted-foreground">{t("addon.reviews.ratings", { count: data.count })}</span></div></div> : <span className="text-sm text-muted-foreground">{t("addon.reviews.empty")}</span>}
          <a href={data.writeUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{data.status === "ok" ? t("addon.reviews.write") : t("addon.reviews.open")} <IconExternalLink className="h-4 w-4 text-primary" /></a>
        </div>
        {data.average !== null && <CategoryRatings categories={data.categories} />}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t("addon.reviews.sort")}</span>
        <Select value={sort} onValueChange={value => { setPage(1); setSort(value as typeof sort) }}>
          <SelectTrigger aria-label={t("addon.reviews.sort")} className="h-9 w-[180px] rounded-xl border-border bg-muted/50 text-foreground"><SelectValue /></SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="newest">{t("addon.reviews.newest")}</SelectItem>
            <SelectItem value="oldest">{t("addon.reviews.oldest")}</SelectItem>
            <SelectItem value="rating">{t("addon.reviews.highest")}</SelectItem>
            <SelectItem value="helpful">{t("addon.reviews.helpful")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!data.reviews.length && <p className="py-8 text-center text-muted-foreground">{t("addon.reviews.empty")}</p>}
      {data.reviews.map(review => <article key={review.id} className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold" aria-hidden="true">{review.author.slice(0, 1).toUpperCase()}{review.avatarUrl && <img src={review.avatarUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}</div>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2">{review.profileUrl ? <a href={review.profileUrl} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline">{review.author}</a> : <span className="truncate font-semibold">{review.author}</span>}{review.isDeveloper && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"><IconShieldCheck className="h-3.5 w-3.5" />{t("addon.reviews.developer")}</span>}</div>{review.date && !Number.isNaN(Date.parse(review.date)) && <span className="text-sm text-muted-foreground" title={new Date(review.date).toLocaleDateString(i18n.language)}>{t("addon.reviews.posted", { time: relativeDate(review.date, i18n.language) })}{review.edited && ` · ${t("addon.reviews.edited")}`}</span>}</div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Stars rating={review.rating} />{review.rating.toFixed(1)}</div>
        </div>
        <CategoryRatings categories={review.categories} />
        {review.title && <h4 className="font-semibold">{review.title}</h4>}
        {review.content && <div className="break-words text-sm leading-relaxed text-muted-foreground [&_p+p]:mt-4"><ReactMarkdown skipHtml components={{ img: () => null }}>{review.content}</ReactMarkdown></div>}
        {(review.minecraftVersion || review.playtimeHours !== null || review.helpfulVotes > 0) && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{review.minecraftVersion.split(",").map(version => version.trim()).filter(Boolean).map(version => <span key={version} className="rounded-full border border-border bg-muted/60 px-2 text-xs">{version}</span>)}{review.playtimeHours !== null && <span className="flex items-center gap-1"><IconClock className="h-4 w-4" />{t("addon.reviews.hours", { count: review.playtimeHours })}</span>}{review.helpfulVotes > 0 && <span className="flex items-center gap-1"><IconHeart className="h-4 w-4" />{t("addon.reviews.helpfulCount", { count: review.helpfulVotes })}</span>}</div>}
        {review.developerResponse && <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm"><div className="mb-1 font-semibold">{t("addon.reviews.developerResponse")}</div><div className="break-words text-muted-foreground"><ReactMarkdown>{review.developerResponse}</ReactMarkdown></div></div>}
      </article>)}
      {data.lastPage > 1 && <div className="flex items-center justify-center gap-4"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">{t("addon.reviews.previous")}</button><span className="text-sm text-muted-foreground">{data.page} / {data.lastPage}</span><button disabled={page >= data.lastPage} onClick={() => setPage(page + 1)} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">{t("addon.reviews.next")}</button></div>}
    </>}
  </div>
}
