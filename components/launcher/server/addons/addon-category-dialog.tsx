import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconSearch, IconList, IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { ProviderIcon } from "@/components/launcher/provider-icon"
import type { ModCategory, ModContentType } from "@xnlc/types"
import type { SelectedAddonCategory, ContentCategory } from "./types"

interface AddonCategoryDialogProps {
  categories: ModCategory[]
  contentType: ModContentType
  selectedCategories: SelectedAddonCategory[]
  onApply: (cats: SelectedAddonCategory[]) => void
}

/**
 * Диалог выбора категорий для серверных аддонов. Полностью повторяет поведение
 * и разметку диалога категорий в instance-content-tab.
 */
export function AddonCategoryDialog({ categories, contentType, selectedCategories, onApply }: AddonCategoryDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftCats, setDraftCats] = useState<SelectedAddonCategory[]>([])
  const [collapsedSourceGroups, setCollapsedSourceGroups] = useState<Set<string>>(() => new Set())

  const filteredCategories = (categories ?? []).filter(
    c => c.projectType === contentType || (contentType === "plugin" && c.projectType === "mod"),
  ) as ContentCategory[]

  const groups = new Map<string, ContentCategory[]>()
  for (const cat of filteredCategories) {
    const key = cat.source ?? "both"
    const list = groups.get(key)
    if (list) list.push(cat)
    else groups.set(key, [cat])
  }
  const groupLabels: Record<string, string> = {
    modrinth: "Modrinth",
    curseforge: "CurseForge",
    both: t("servers.addons.bothPlatforms"),
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next) setDraftCats(selectedCategories ?? [])
      setOpen(next)
    }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            (selectedCategories?.length ?? 0) > 0
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground hover:bg-muted/80"
          }`}
        >
          <IconList className="w-4 h-4" strokeWidth={1.75} />
          {(selectedCategories?.length ?? 0) > 0
            ? t("servers.addons.categoriesCount", { count: selectedCategories!.length })
            : t("servers.addons.categories")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("servers.addons.categoriesTitle")}</DialogTitle>
          <DialogDescription>{t("servers.addons.categoriesDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-1">
          {filteredCategories.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">{t("servers.addons.noCategories")}</p>
          )}
          {[...groups.entries()].map(([key, cats]) => {
            const collapsed = collapsedSourceGroups.has(key)
            return (
              <div key={key} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setCollapsedSourceGroups(prev => {
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
                  const checked = draftCats.some(c => c.name === cat.name)
                  const hasSvg = cat.icon && cat.icon.trimStart().startsWith("<svg")
                  const hasImg = cat.icon && !hasSvg && cat.icon.startsWith("http")
                  return (
                    <label
                      key={`${key}:${cat.name}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          if (v) setDraftCats((prev) => [...prev, { name: cat.name, source: cat.source }])
                          else setDraftCats((prev) => prev.filter((c) => c.name !== cat.name))
                        }}
                      />
                      {hasSvg && (
                        <span
                          className="w-4 h-4 shrink-0 text-muted-foreground [&_svg]:w-full [&_svg]:h-full"
                          dangerouslySetInnerHTML={{ __html: cat.icon }}
                        />
                      )}
                      {hasImg && (
                        <img
                          src={cat.icon}
                          alt=""
                          className="w-4 h-4 shrink-0 rounded-sm object-contain"
                        />
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
        {(draftCats.length > 0) && (
          <button
            type="button"
            onClick={() => setDraftCats([])}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            {t("servers.addons.resetAll")}
          </button>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("servers.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draftCats)
              setOpen(false)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("servers.addons.find")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
