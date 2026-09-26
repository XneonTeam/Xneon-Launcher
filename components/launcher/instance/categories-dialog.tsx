import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconChevronDown, IconChevronRight, IconList, IconSearch } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { ProviderIcon } from "@/components/launcher/provider-icon"
import { cn } from "@/lib/utils"
import type { ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./use-mod-search"

/** Категория с площадкой-источником: у Modrinth и CurseForge списки объединяются. */
export type CategoriesDialogCategory = ModCategory & { source?: "modrinth" | "curseforge" }

export type CategoriesDialogProps = {
  /** Категории, уже отфильтрованные по типу контента (mod / modpack / resourcepack / shader). */
  categories: CategoriesDialogCategory[]
  selected: SelectedModCategory[]
  onApply: (value: SelectedModCategory[]) => void
  /**
   * Классы кнопки-триггера: у вкладки сборки и у тулбара браузера модпаков свои
   * размеры, поэтому база общая, а высота/скругление приходят снаружи.
   */
  triggerClassName?: string
}

/**
 * Модалка выбора категорий поиска. Одна на вкладку содержимого сборки и на браузеры
 * модпаков: список категорий приходит снаружи (он зависит от площадки и типа проекта),
 * наружу отдаётся выбранное при нажатии «Искать».
 */
export function CategoriesDialog({ categories, selected, onApply, triggerClassName }: CategoriesDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SelectedModCategory[]>(selected)
  /** Свёрнутые группы площадок, чтобы длинный список категорий не растягивался. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const selectedCount = selected.length

  const groups = useMemo(() => {
    const map = new Map<string, CategoriesDialogCategory[]>()
    for (const category of categories) {
      const key = category.source ?? "both"
      const list = map.get(key)
      if (list) list.push(category)
      else map.set(key, [category])
    }
    return [...map.entries()]
  }, [categories])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // При открытии начинаем с уже применённого набора: отмена не должна менять фильтр.
        if (next) setDraft(selected)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 font-medium transition-colors",
            // triggerClassName идёт первым: он задаёт размер и форму, но не фон —
            // иначе `bg-muted/50` из тулбара перебивал `bg-primary` у активного
            // фильтра, и подпись «1 кат.» становилась тёмной на тёмном.
            triggerClassName,
            selectedCount > 0
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-foreground hover:bg-muted/80",
          )}
        >
          <IconList className="w-4 h-4" strokeWidth={1.75} />
          {selectedCount > 0
            ? t("servers.addons.categoriesCount", { count: selectedCount })
            : t("servers.addons.categories")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("servers.addons.categoriesTitle")}</DialogTitle>
          <DialogDescription>{t("servers.addons.categoriesDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-1">
          {categories.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">{t("servers.addons.noCategories")}</p>
          )}
          {groups.map(([key, cats]) => {
            const collapsed = collapsedGroups.has(key)
            const groupLabels: Record<string, string> = {
              modrinth: "Modrinth",
              curseforge: "CurseForge",
              both: t("servers.addons.bothPlatforms"),
            }
            return (
              <div key={key} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setCollapsedGroups((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })}
                  className="flex w-full items-center gap-2 px-2 py-2 rounded-xl bg-muted/60 border border-border/70 hover:bg-muted/90 text-xs font-semibold text-foreground transition-colors"
                >
                  {collapsed
                    ? <IconChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    : <IconChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                  {key === "both" ? (
                    <span className="inline-flex items-center gap-1">
                      <ProviderIcon source="modrinth" />
                      <ProviderIcon source="curseforge" />
                    </span>
                  ) : (
                    <ProviderIcon source={key} />
                  )}
                  <span className="min-w-0 flex-1 text-left truncate">{groupLabels[key] ?? key}</span>
                  <span className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">{cats.length}</span>
                </button>
                {!collapsed && cats.map((cat) => {
                  const checked = draft.some((c) => c.name === cat.name)
                  const hasSvg = cat.icon && cat.icon.trimStart().startsWith("<svg")
                  const hasImg = cat.icon && !hasSvg && cat.icon.startsWith("http")
                  return (
                    <label
                      key={`${key}:${cat.name}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          if (value) setDraft((prev) => [...prev, { name: cat.name, source: cat.source }])
                          else setDraft((prev) => prev.filter((c) => c.name !== cat.name))
                        }}
                      />
                      {hasSvg && (
                        <span
                          className="w-4 h-4 shrink-0 text-muted-foreground [&_svg]:w-full [&_svg]:h-full"
                          dangerouslySetInnerHTML={{ __html: cat.icon }}
                        />
                      )}
                      {hasImg && (
                        <img src={cat.icon} alt="" className="w-4 h-4 shrink-0 rounded-sm object-contain" />
                      )}
                      <span className="flex-1">{cat.name}</span>
                      {cat.header !== "categories" && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{cat.header}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => setDraft([])}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            {t("buildDetail.resetAll")}
          </button>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft)
              setOpen(false)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("buildDetail.search.submit")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
