import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { CatalogFiltersDialog, countActiveFilters, EMPTY_FILTERS, type CatalogFilters } from "./catalog-filters-dialog"
import { LABY_TREND_ORDERS } from "@xnlc/skins"
import type { LabyOrder, LabyTag } from "@xnlc/types"
import { IconChevronDown, IconClock, IconCrown, IconFlame, IconSearch, IconX } from "@tabler/icons-react"

const ORDER_LABEL_KEY: Record<LabyOrder, string> = {
  trending_24h: "laby.order.trending",
  trending_7d: "laby.order.trending7d",
  trending_30d: "laby.order.trending30d",
  most_used: "laby.order.popular",
  latest: "laby.order.latest",
}

const ORDER_FALLBACK: Record<LabyOrder, string> = {
  trending_24h: "Тренды дня",
  trending_7d: "Тренды недели",
  trending_30d: "Тренды месяца",
  most_used: "Популярные",
  latest: "Новые",
}

interface CatalogToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  onClearQuery: () => void
  order: LabyOrder
  onOrderChange: (order: LabyOrder) => void
  filters: CatalogFilters
  onFiltersChange: (filters: CatalogFilters) => void
  tags: LabyTag[]
  tagsLoading: boolean
  /** Фильтр применяется к загруженному пулу, а не на сервере. */
  localFiltering: boolean
}

/**
 * Панель каталога: поиск, выдача и «Категории».
 *
 * Выдача сделана как на сайте Laby: один сегмент на три режима — «Тренды» с
 * выбором периода, «Популярные» и «Новые». Периоды трендов прячутся в
 * выпадающий список, иначе пять кнопок подряд растянули бы тулбар. Активный
 * период виден прямо на кнопке («Тренды недели»), поэтому не приходится
 * открывать список, чтобы понять текущий режим.
 */
export function CatalogToolbar({
  query,
  onQueryChange,
  onClearQuery,
  order,
  onOrderChange,
  filters,
  onFiltersChange,
  tags,
  tagsLoading,
  localFiltering,
}: CatalogToolbarProps) {
  const { t } = useTranslation()
  const active = countActiveFilters(filters)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isTrend = LABY_TREND_ORDERS.includes(order)
  // В режиме тренда кнопка показывает выбранный период, иначе — «Тренды дня».
  const trendOrder: LabyOrder = isTrend ? order : "trending_24h"
  const trendLabel = t(ORDER_LABEL_KEY[trendOrder], ORDER_FALLBACK[trendOrder])

  // Закрытие по клику вне меню и по Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [menuOpen])

  const segClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all duration-200",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
    )

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("laby.searchPlaceholder", "Поиск: тег, название или ник игрока")}
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-border/60 bg-card pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={onClearQuery}
              title={t("laby.clearSearch", "Сбросить поиск")}
              className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Режимы выдачи: тренды с периодом, популярные, новые. */}
        <div className="flex shrink-0 gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1" ref={menuRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={segClass(isTrend)}
            >
              <IconFlame className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{trendLabel}</span>
              <IconChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", menuOpen && "rotate-180")}
                strokeWidth={2}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full z-50 mt-1.5 min-w-[170px] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg"
              >
                {LABY_TREND_ORDERS.map((value) => {
                  const selected = order === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        onOrderChange(value)
                        setMenuOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                        selected
                          ? "bg-muted/70 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <IconFlame className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
                      <span className="flex-1">{t(ORDER_LABEL_KEY[value], ORDER_FALLBACK[value])}</span>
                      {selected && <IconCheckMark />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <button type="button" onClick={() => onOrderChange("most_used")} className={segClass(order === "most_used")}>
            <IconCrown className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{t("laby.order.popular", "Популярные")}</span>
          </button>

          <button type="button" onClick={() => onOrderChange("latest")} className={segClass(order === "latest")}>
            <IconClock className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{t("laby.order.latest", "Новые")}</span>
          </button>
        </div>

        <CatalogFiltersDialog
          filters={filters}
          tags={tags}
          tagsLoading={tagsLoading}
          localFiltering={localFiltering}
          onApply={onFiltersChange}
        />
      </div>

      {active > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Каждый тег — свой чип: снять можно по отдельности. */}
          {filters.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onFiltersChange({ tags: filters.tags.filter((item) => item !== tag) })}
              title={t("laby.removeTag", "Убрать тег")}
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <span className="max-w-[140px] truncate">#{tag}</span>
              <IconX className="h-3 w-3 opacity-70" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="rounded-lg px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            {t("laby.clearFilters", "Сбросить фильтр")}
          </button>
        </div>
      )}
    </div>
  )
}

/** Галочка выбранного пункта: инлайновый SVG, чтобы не тянуть иконку ради одного знака. */
function IconCheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}