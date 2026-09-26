import { useTranslation } from "react-i18next"
import { IconSearch } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LoaderIcon } from "./loader-icon"
import { CategoriesDialog, type CategoriesDialogCategory } from "./categories-dialog"
import { getSortLabels } from "./sort-options"
import type { SelectedModCategory } from "./use-mod-search"
import type { ModSort } from "./types"

interface InstanceBrowseToolbarProps {
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
  /** Категории площадки — если переданы, в тулбаре появляется модалка фильтра. */
  categories?: CategoriesDialogCategory[]
  selectedCategories?: SelectedModCategory[]
  onApplyCategories?: (value: SelectedModCategory[]) => void
}

/** Список загрузчиков для фильтра — общий у браузеров модпаков и FTB. */
export const MOD_LOADER_OPTIONS = [
  { id: "all", label: "all" },
  { id: "vanilla", label: "Vanilla" },
  { id: "forge", label: "Forge" },
  { id: "fabric", label: "Fabric" },
  { id: "neoforge", label: "NeoForge" },
  { id: "quilt", label: "Quilt" },
] as const

export function InstanceBrowseToolbar({
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
  selectedCategories,
  onApplyCategories,
}: InstanceBrowseToolbarProps) {
  const { t } = useTranslation()
  const sortLabels = getSortLabels(t)

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

      <Select value={sortBy} onValueChange={value => setSortBy(value as ModSort)}>
        <SelectTrigger className="w-[180px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={t("mods.sortBy")} />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map(option => (
            <SelectItem key={option} value={option}>{sortLabels[option]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {categories && onApplyCategories && (
        <CategoriesDialog
          categories={categories}
          selected={selectedCategories ?? []}
          onApply={onApplyCategories}
          triggerClassName="px-4 py-2.5 rounded-xl text-sm"
        />
      )}

      <Select value={selectedVersion} onValueChange={setSelectedVersion}>
        <SelectTrigger className="w-[180px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={versionsLoaded ? t("builds.version") : t("home.loadingVersions")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("builds.allVersions")}</SelectItem>
          {versionOptions.map(version => (
            <SelectItem key={version} value={version}>{version}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedModLoader} onValueChange={setSelectedModLoader}>
        <SelectTrigger className="w-[170px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={t("builds.modLoader")} />
        </SelectTrigger>
        <SelectContent>
          {MOD_LOADER_OPTIONS.map(loader => (
            <SelectItem key={loader.id} value={loader.id}>
              <span className="flex items-center gap-2">
                {loader.id !== "all" && <LoaderIcon loaderId={loader.id} className="w-4 h-4 flex-shrink-0" />}
                <span>{loader.id === "all" ? t("builds.allLoaders") : loader.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
