import { CONTENT_ENTER_DELAYED } from "../content-motion"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { FloatingContextMenu } from "@/components/ui/floating-context-menu"
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
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })

  const isTrend = LABY_TREND_ORDERS.includes(order)
  // В режиме тренда кнопка показывает выбранный период, иначе — «Тренды дня».
  const trendOrder: LabyOrder = isTrend ? order : "trending_24h"
  const trendLabel = t(ORDER_LABEL_KEY[trendOrder], ORDER_FALLBACK[trendOrder])

  // Плавающий слой сам закрывается снаружи и по Escape; прокрутка меняет
  // положение кнопки, поэтому в этом случае закрываем список.
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [menuOpen])

  const segClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all duration-200 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
    )

  return (
    <div data-ui="laby-catalog-toolbar-div-1" data-component="catalog-toolbar" className={`flex shrink-0 flex-col gap-2 ${CONTENT_ENTER_DELAYED}`}>
      <div data-ui="laby-catalog-toolbar-div-2" className="flex flex-wrap items-center gap-2">
        <div data-ui="laby-catalog-toolbar-div-3" className="relative min-w-[200px] flex-1">
          <IconSearch aria-hidden="true" className="pointer-events-none absolute z-10 left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input data-ui="laby-catalog-toolbar-input-1"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("laby.searchPlaceholder", "Поиск: тег, название или ник игрока")}
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-border/60 bg-card pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
          />
          {query.length > 0 && (
            <button data-ui="laby-catalog-toolbar-button-1"
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
        <div data-ui="laby-catalog-toolbar-div-4" className="flex shrink-0 gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1">
          <div data-ui="laby-catalog-toolbar-div-5" className="relative">
            <button data-ui="laby-catalog-toolbar-button-2"
              type="button"
              onMouseDown={event => event.stopPropagation()}
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMenuPosition({ x: rect.left, y: rect.bottom + 6 })
                setMenuOpen(value => !value)
              }}
              aria-pressed={isTrend}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={segClass(isTrend)}
            >
              <IconFlame className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span data-ui="laby-catalog-toolbar-span-1">{trendLabel}</span>
              <IconChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", menuOpen && "rotate-180")}
                strokeWidth={2}
              />
            </button>

            {menuOpen && (
              <FloatingContextMenu position={menuPosition} onClose={() => setMenuOpen(false)} minWidth={170}>
              <div data-ui="laby-catalog-toolbar-div-6"
                role="menu"
                className="min-w-0"
              >
                {LABY_TREND_ORDERS.map((value) => {
                  const selected = order === value
                  return (
                    <button data-ui="laby-catalog-toolbar-button-3"
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
                      <span data-ui="laby-catalog-toolbar-span-2" className="flex-1">{t(ORDER_LABEL_KEY[value], ORDER_FALLBACK[value])}</span>
                      {selected && <IconCheckMark />}
                    </button>
                  )
                })}
              </div>
              </FloatingContextMenu>
            )}
          </div>

          <button data-ui="laby-catalog-toolbar-button-4" type="button" aria-pressed={order === "most_used"} onClick={() => onOrderChange("most_used")} className={segClass(order === "most_used")}>
            <IconCrown className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span data-ui="laby-catalog-toolbar-span-3">{t("laby.order.popular", "Популярные")}</span>
          </button>

          <button data-ui="laby-catalog-toolbar-button-5" type="button" aria-pressed={order === "latest"} onClick={() => onOrderChange("latest")} className={segClass(order === "latest")}>
            <IconClock className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span data-ui="laby-catalog-toolbar-span-4">{t("laby.order.latest", "Новые")}</span>
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
        <div data-ui="laby-catalog-toolbar-div-7" className="flex flex-wrap items-center gap-1.5">
          {/* Каждый тег — свой чип: снять можно по отдельности. */}
          {filters.tags.map((tag) => (
            <button data-ui="laby-catalog-toolbar-button-6"
              key={tag}
              type="button"
              onClick={() => onFiltersChange({ tags: filters.tags.filter((item) => item !== tag) })}
              title={t("laby.removeTag", "Убрать тег")}
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <span data-ui="laby-catalog-toolbar-span-5" className="max-w-[140px] truncate">#{tag}</span>
              <IconX className="h-3 w-3 opacity-70" />
            </button>
          ))}
          <button data-ui="laby-catalog-toolbar-button-7"
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
    <svg data-ui="laby-catalog-toolbar-svg-1" data-icon="laby-catalog-toolbar-svg-1" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true">
      <path data-ui="laby-catalog-toolbar-path-1" d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
