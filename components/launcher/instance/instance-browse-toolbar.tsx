import { useTranslation } from "react-i18next"
import { IconSearch } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  selectedCategory: string
  setSelectedCategory: (value: string) => void
  categoryOptions: string[]
}

const MOD_LOADER_OPTIONS = [
  { id: "all", label: "all" },
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
] as const

function formatCategoryLabel(category: string) {
  return category.replace(/-/g, " ")
}

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
  selectedCategory,
  setSelectedCategory,
  categoryOptions,
}: InstanceBrowseToolbarProps) {
  const { t } = useTranslation()

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
            <SelectItem key={option} value={option}>{t(`mods.sort.${option}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedVersion} onValueChange={setSelectedVersion}>
        <SelectTrigger className="w-[180px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={versionsLoaded ? t("builds.version") : "Loading..."} />
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
              {loader.id === "all" ? t("builds.allLoaders") : loader.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedCategory} onValueChange={setSelectedCategory} disabled={categoryOptions.length === 0}>
        <SelectTrigger className="w-[190px] h-10 rounded-xl bg-muted/50 border-border text-foreground">
          <SelectValue placeholder={t("builds.category")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("builds.allCategories")}</SelectItem>
          {categoryOptions.map(category => (
            <SelectItem key={category} value={category}>{formatCategoryLabel(category)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
