import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { formatUseCount } from "@xnlc/skins"
import type { LabyTag } from "@xnlc/types"
import { IconChevronDown, IconChevronRight, IconList, IconSearch, IconX } from "@tabler/icons-react"

export type CatalogFilters = {
  /** Выбранные теги Laby по имени (`Girl`); пусто — без фильтра. */
  tags: string[]
}

export const EMPTY_FILTERS: CatalogFilters = { tags: [] }

export function countActiveFilters(filters: CatalogFilters): number {
  return filters.tags.length
}

interface CatalogFiltersDialogProps {
  filters: CatalogFilters
  tags: LabyTag[]
  tagsLoading: boolean
  /** Поиск идёт по загруженному пулу — предупреждаем, что он не серверный. */
  localFiltering: boolean
  onApply: (filters: CatalogFilters) => void
}

function FilterGroup({
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div data-ui="laby-catalog-filters-dialog-div-1" data-component="filter-group" className="flex flex-col gap-0.5">
      <button data-ui="laby-catalog-filters-dialog-button-1"
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-xl border border-border/70 bg-muted/60 px-2 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/90"
      >
        {collapsed ? (
          <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span data-ui="laby-catalog-filters-dialog-span-1" className="min-w-0 flex-1 text-left truncate">{title}</span>
        <span data-ui="laby-catalog-filters-dialog-span-2" className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
          {count}
        </span>
      </button>
      {!collapsed && children}
    </div>
  )
}

/**
 * «Категории» каталога Laby.
 *
 * Повторяет выбор категорий в сборках и модах: кнопка со счётчиком, модалка со
 * списком, черновик до нажатия «Показать». Список тегов приходит из
 * `/api/v3/tags` — это единственный серверный источник категорий у Laby.
 *
 * Фильтрация локальная: параметры `tag`/`tags` на поиске Laby игнорируются
 * (проверено запросами), поэтому фильтр применяется к загруженному пулу и об
 * этом честно написано в подсказке.
 */
export function CatalogFiltersDialog({ filters, tags, tagsLoading, localFiltering, onApply }: CatalogFiltersDialogProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CatalogFilters>(filters)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const needle = query.trim().toLowerCase()
  const visibleTags = needle
    ? tags.filter((tag) => tag.name.toLowerCase().includes(needle) || tag.label.toLowerCase().includes(needle))
    : tags

  const active = countActiveFilters(filters)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-ui="laby-catalog-filters-dialog-button-2" data-component="catalog-filters-dialog"
          type="button"
          className={cn(
            "flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-colors",
            active > 0
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted/50 text-foreground hover:bg-muted/80",
          )}
        >
          <IconList className="h-4 w-4" strokeWidth={1.75} />
          {active > 0
            ? t("laby.categoriesWithCount", "Категории ({{count}})", { count: active })
            : t("laby.categories", "Категории")}
        </button>
      </DialogTrigger>

      <DialogContent data-window="laby-catalog-filters-dialog-window-1" className="flex max-h-[72vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>{t("laby.categoriesTitle", "Категории каталога")}</DialogTitle>
          <DialogDescription>{t("laby.categoriesDesc", "Теги Laby")}</DialogDescription>
        </DialogHeader>

        <div data-ui="laby-catalog-filters-dialog-div-2" data-component="catalog-filters-dialog" className="relative">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input data-ui="laby-catalog-filters-dialog-input-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("laby.filterTagSearch", "Найти тег")}
            spellCheck={false}
            className="h-9 w-full rounded-xl border border-border/60 bg-card pl-8 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
          />
        </div>

        <div data-ui="laby-catalog-filters-dialog-div-3" data-component="catalog-filters-dialog" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
          {localFiltering && (
            <p data-ui="laby-catalog-filters-dialog-p-1" className="rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              {t(
                "laby.localFilteringHint",
                "Laby не умеет фильтровать по тегу на сервере, поэтому фильтр работает по уже загруженному каталогу.",
              )}
            </p>
          )}

          <FilterGroup
            title={t("laby.groupTags", "Теги Laby")}
            count={tags.length}
            collapsed={collapsed.has("tags")}
            onToggle={() => toggleGroup("tags")}
          >
            {tagsLoading && tags.length === 0 ? (
              <p data-ui="laby-catalog-filters-dialog-p-2" className="px-2 py-2 text-xs text-muted-foreground">{t("laby.tagsLoading", "Загружаем теги…")}</p>
            ) : visibleTags.length === 0 ? (
              <p data-ui="laby-catalog-filters-dialog-p-3" className="px-2 py-2 text-xs text-muted-foreground">{t("laby.noTags", "Теги не найдены")}</p>
            ) : (
              <>
                {/*
                  Теги можно отмечать пачкой: сервер их не фильтрует, выбор
                  считается локально, поэтому ограничения на количество нет.
                */}
                <p data-ui="laby-catalog-filters-dialog-p-4" className="mx-2 mb-1 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                  {t("laby.multiTagHint", "Можно выбрать несколько тегов: подойдёт скин с любым из них")}
                </p>
                <label data-ui="laby-catalog-filters-dialog-label-1" className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                  <Checkbox
                    checked={draft.tags.length === 0}
                    onCheckedChange={() => setDraft((prev) => ({ ...prev, tags: [] }))}
                  />
                  <span data-ui="laby-catalog-filters-dialog-span-3" className="flex-1">{t("laby.anyTag", "Любой тег")}</span>
                </label>
                {visibleTags.map((tag) => {
                  const selected = draft.tags.some((item) => item.toLowerCase() === tag.name.toLowerCase())
                  return (
                    <label data-ui="laby-catalog-filters-dialog-label-2"
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() =>
                          setDraft((prev) => ({
                            ...prev,
                            tags: selected
                              ? prev.tags.filter((item) => item.toLowerCase() !== tag.name.toLowerCase())
                              : [...prev.tags, tag.name],
                          }))
                        }
                      />
                      <span data-ui="laby-catalog-filters-dialog-span-4" className="min-w-0 flex-1 truncate">
                        {/* Локализованное имя показываем основным, оригинал — рядом. */}
                        {tag.label}
                        {tag.label !== tag.name && (
                          <span data-ui="laby-catalog-filters-dialog-span-5" className="ml-1.5 text-[11px] text-muted-foreground/50">{tag.name}</span>
                        )}
                      </span>
                      <span data-ui="laby-catalog-filters-dialog-span-6"
                        // Laby отдаёт у тега `use_count` — сколько раз скины с
                        // этим тегом использовали. Это не число скинов, и без
                        // пояснения его легко принять за размер категории.
                        title={t("laby.tagUseCountHint", "Сколько раз использовали скины с этим тегом — это не количество скинов")}
                        className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                      >
                        {formatUseCount(tag.useCount, i18n.language)}
                      </span>
                    </label>
                  )
                })}
              </>
            )}
          </FilterGroup>
        </div>

        {countActiveFilters(draft) > 0 && (
          <button data-ui="laby-catalog-filters-dialog-button-3"
            type="button"
            onClick={() => setDraft(EMPTY_FILTERS)}
            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconX className="h-3.5 w-3.5" />
            {t("laby.resetAll", "Сбросить всё")}
          </button>
        )}

        <div data-ui="laby-catalog-filters-dialog-div-4" data-component="catalog-filters-dialog" className="mt-3 flex justify-end gap-2">
          <button data-ui="laby-catalog-filters-dialog-button-4"
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("common.cancel", "Отмена")}
          </button>
          <button data-ui="laby-catalog-filters-dialog-button-5"
            type="button"
            onClick={() => {
              onApply(draft)
              setOpen(false)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("laby.show", "Показать")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}