import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { IconCoffee, IconInfoCircle, IconLayoutGrid, IconNews, IconPhoto } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { formatDate, NEWS_CARD_STYLE, NEWS_CARD_TEXT_HEIGHT, NEWS_GRID_GAP, NEWS_GRID_OVERSCAN_ROWS, NEWS_SCROLL_STYLE, type NewsEntry } from "@/lib/home-page-shared"

const NewsCard = memo(function NewsCard({ entry, height }: { entry: NewsEntry; height?: number }) {
  const imgUrl = entry.playPageImage?.url ?? entry.newsPageImage?.url
  const tag = entry.tag ?? entry.category ?? entry.newsType?.[0]
  const style = useMemo<CSSProperties>(() => (height ? { ...NEWS_CARD_STYLE, height } : NEWS_CARD_STYLE), [height])
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-card border border-border hover:border-primary/40 transition-colors flex flex-col" style={style}>
      <div className="aspect-video w-full overflow-hidden bg-muted/50 flex-shrink-0">
        {imgUrl ? <img src={imgUrl} alt={entry.title} loading="lazy" decoding="async" className="w-full h-full object-cover transform-gpu" />
          : <div className="w-full h-full flex items-center justify-center"><IconPhoto className="w-10 h-10 text-muted-foreground/30" strokeWidth={1.75} /></div>}
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        {tag && <span className="self-start px-2 py-0.5 rounded-md bg-primary/15 text-primary text-[11px] font-semibold uppercase tracking-wide">{tag}</span>}
        <p className="font-semibold text-foreground text-sm leading-snug line-clamp-2">{entry.title}</p>
        {entry.text && <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{entry.text}</p>}
        <div className="flex items-center justify-between mt-auto pt-1">
          <span className="text-xs text-muted-foreground/70">{formatDate(entry.date)}</span>
          {entry.readMoreLink && <button type="button" onClick={() => entry.readMoreLink && window.open(entry.readMoreLink)} className="text-xs text-primary hover:text-primary/80 transition-colors font-medium">Читать →</button>}
        </div>
      </div>
    </div>
  )
})

const VirtualNewsGrid = memo(function VirtualNewsGrid({ entries }: { entries: NewsEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0, width: 0 })
  const updateViewport = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setViewport(prev => {
      const next = { scrollTop: el.scrollTop, height: el.clientHeight, width: el.clientWidth }
      return prev.scrollTop === next.scrollTop && prev.height === next.height && prev.width === next.width ? prev : next
    })
  }, [])
  const scheduleViewportUpdate = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => { frameRef.current = null; updateViewport() })
  }, [updateViewport])

  useEffect(() => {
    updateViewport()
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [updateViewport])

  const columns = 2
  const rowCount = Math.ceil(entries.length / columns)
  const columnWidth = viewport.width > 0 ? (viewport.width - NEWS_GRID_GAP) / columns : 320
  const cardHeight = Math.ceil((columnWidth * 9) / 16 + NEWS_CARD_TEXT_HEIGHT)
  const rowHeight = cardHeight + NEWS_GRID_GAP
  const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - NEWS_GRID_OVERSCAN_ROWS)
  const endRow = Math.min(rowCount, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + NEWS_GRID_OVERSCAN_ROWS)
  const visibleEntries = entries.slice(startRow * columns, endRow * columns)

  return (
    <div ref={scrollRef} onScroll={scheduleViewportUpdate} className="overflow-y-auto flex-1 px-4 pb-4 pr-5" style={NEWS_SCROLL_STYLE}>
      <div style={{ height: startRow * rowHeight }} />
      <div className="grid grid-cols-2 gap-3">{visibleEntries.map(entry => <NewsCard key={entry.id} entry={entry} height={cardHeight} />)}</div>
      <div style={{ height: Math.max(0, (rowCount - endRow) * rowHeight) }} />
    </div>
  )
})

let cachedNews: NewsEntry[] | null = null
let cachedNewsPromise: Promise<NewsEntry[]> | null = null

function fetchNewsCached(): Promise<NewsEntry[]> {
  if (cachedNews) return Promise.resolve(cachedNews)
  if (cachedNewsPromise) return cachedNewsPromise
  cachedNewsPromise = window.electronAPI?.fetchMinecraftNews().then((entries) => { cachedNews = entries; return entries }) ?? Promise.resolve([])
  return cachedNewsPromise
}

export const NewsSection = memo(function NewsSection() {
  const { t } = useTranslation()
  const [news, setNews] = useState<NewsEntry[]>(() => cachedNews ?? [])
  const [loading, setLoading] = useState(!cachedNews)
  const [filter, setFilter] = useState<"all" | "java">("java")

  useEffect(() => {
    if (cachedNews) { setNews(cachedNews); setLoading(false); return }
    setLoading(true)
    fetchNewsCached().then((entries) => { setNews(entries); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => filter === "java" ? news.filter(e => !e.newsType || e.newsType.includes("Java") || e.newsType.includes("java_edition")) : news, [filter, news])
  const filters = useMemo(() => [
    { id: "all" as const, label: t("home.news.all"), icon: IconLayoutGrid },
    { id: "java" as const, label: t("home.news.java"), icon: IconCoffee },
  ], [t])

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] min-h-0">
      <div className="relative rounded-2xl bg-card/80 border border-border overflow-hidden flex flex-col" style={{ height: "100%" }}>
        <div className="p-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center"><IconNews className="w-4 h-4 text-primary" strokeWidth={2} /></div>
              <h2 className="text-base font-semibold text-foreground">{t("home.news.title")}</h2>
            </div>
            <div className="flex gap-1 p-1 rounded-lg bg-muted/40">
              {filters.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => setFilter(prev => prev === id ? prev : id)} className={cn("flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all", filter === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="overflow-y-auto flex-1 px-4 pb-4 pr-5" style={NEWS_SCROLL_STYLE}>
            <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-2xl bg-card border border-border overflow-hidden animate-pulse"><div className="aspect-video bg-muted/50" /><div className="p-4 space-y-2"><div className="h-2.5 bg-muted/60 rounded w-1/3" /><div className="h-3 bg-muted/60 rounded w-full" /><div className="h-3 bg-muted/60 rounded w-4/5" /></div></div>)}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="overflow-y-auto flex-1 px-4 pb-4 pr-5" style={NEWS_SCROLL_STYLE}>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-4"><IconInfoCircle className="w-7 h-7 text-muted-foreground/40" strokeWidth={1.75} /></div>
              <p className="text-sm text-muted-foreground">{t("home.newsError")}</p>
            </div>
          </div>
        ) : <VirtualNewsGrid entries={filtered} />}
      </div>
    </div>
  )
})
