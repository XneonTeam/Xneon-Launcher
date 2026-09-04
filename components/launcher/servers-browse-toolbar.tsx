import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconSearch, IconList, IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import type { ModSort } from "./instance/types"
import type { ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./instance/use-mod-search"

interface ServersBrowseToolbarProps {
  search: string
  setSearch: (value: string) => void
  searchPlaceholder: string
  sortBy: ModSort
  setSortBy: (value: ModSort) => void
  sortOptions: ModSort[]
  selectedVersion: string
  setSelectedVersion: (value: string) => void
  versionsLoaded: boolean
  versionOptions: string[]
  selectedModLoader: string
  setSelectedModLoader: (value: string) => void
  categories: ModpackCategory[]
  modCategories: SelectedModCategory[]
  setModCategories: (value: SelectedModCategory[]) => void
}

type ModpackCategory = ModCategory & { source?: "modrinth" | "curseforge" }

const MOD_LOADER_OPTIONS = [
  { id: "all", label: "all" },
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "neoforge", label: "NeoForge" },
  { id: "forge", label: "Forge" },
  { id: "quilt", label: "Quilt" },
] as const

function ProviderIcon({ source }: { source: string }) {
  if (source === "modrinth") {
    return (
      <span className="inline-flex items-center justify-center rounded-md bg-green-500/15">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
          <path fill="#26a269" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
        </svg>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-orange-500/15">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
        <path fill="#f16436" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
      </svg>
    </span>
  )
}

export function ServersBrowseToolbar({
  search,
  setSearch,
  searchPlaceholder,
  sortBy,
  setSortBy,
  sortOptions,
  selectedVersion,
  setSelectedVersion,
  versionsLoaded,
  versionOptions,
  selectedModLoader,
  setSelectedModLoader,
  categories,
  modCategories,
  setModCategories,
}: ServersBrowseToolbarProps) {
  const { t } = useTranslation()
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [draftCats, setDraftCats] = useState<SelectedModCategory[]>([])
  const [collapsedSourceGroups, setCollapsedSourceGroups] = useState<Set<string>>(() => new Set())

  const filteredCategories = useMemo(
    () => categories.filter(c => c.projectType === "modpack") as ModpackCategory[],
    [categories],
  )

  useEffect(() => {
    if (catDialogOpen) setDraftCats(modCategories)
  }, [catDialogOpen, modCategories])

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="min-w-[280px] flex-1 relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full h-10 pl-10 pr-4 py-2 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      <Dialog open={catDialogOpen} onOpenChange={(open) => {
        if (!open) setDraftCats(modCategories)
        setCatDialogOpen(open)
      }}>
        <DialogTrigger asChild>
          <button
            type="button"
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              modCategories.length > 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-foreground hover:bg-muted/80"
            }`}
          >
            <IconList className="w-4 h-4" strokeWidth={1.75} />
            {modCategories.length > 0 ? `${modCategories.length} кат.` : t("servers.categories")}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("servers.categories")}</DialogTitle>
            <DialogDescription>Выбери категории и нажми «Найти»</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-1">
            {filteredCategories.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">Нет категорий для этого типа контента</p>
            )}
            {(() => {
              const groups = new Map<string, typeof filteredCategories>()
              for (const cat of filteredCategories) {
                const key = cat.source ?? "both"
                const list = groups.get(key)
                if (list) list.push(cat)
                else groups.set(key, [cat])
              }
              const groupLabels: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge", both: "Обе платформы" }
              return [...groups.entries()].map(([key, cats]) => {
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
                        <>
                          <ProviderIcon source="modrinth" />
                          <ProviderIcon source="curseforge" />
                        </>
                      ) : (
                        <ProviderIcon source={key} />
                      )}
                      <span className="min-w-0 flex-1 text-left truncate">{groupLabels[key] ?? key}</span>
                      <span className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">{cats.length}</span>
                    </button>
                    {!collapsed && cats.map((cat) => {
                      // source может быть общим — тогда категория применима к обоим провайдерам
                      const effectiveSource = cat.source
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
                              if (v) setDraftCats((prev) => [...prev, { name: cat.name, source: effectiveSource }])
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
              })
            })()}
          </div>
          {draftCats.length > 0 && (
            <button
              type="button"
              onClick={() => setDraftCats([])}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
            >
              Сбросить все
            </button>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setCatDialogOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => {
                setModCategories(draftCats)
                setCatDialogOpen(false)
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
              Найти
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Select value={sortBy} onValueChange={value => setSortBy(value as ModSort)}>
        <SelectTrigger className="w-[170px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={t("mods.sortBy")} />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map(option => (
            <SelectItem key={option} value={option}>{t(`mods.sort.${option}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedVersion} onValueChange={setSelectedVersion}>
        <SelectTrigger className="w-[180px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={versionsLoaded ? t("builds.version") : "Loading..."} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("servers.allVersions")}</SelectItem>
          {versionOptions.map(version => (
            <SelectItem key={version} value={version}>{version}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedModLoader} onValueChange={setSelectedModLoader}>
        <SelectTrigger className="w-[170px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={t("servers.modLoader")} />
        </SelectTrigger>
        <SelectContent>
          {MOD_LOADER_OPTIONS.map(loader => (
            <SelectItem key={loader.id} value={loader.id}>
              {loader.id === "all" ? t("servers.allLoaders") : loader.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}