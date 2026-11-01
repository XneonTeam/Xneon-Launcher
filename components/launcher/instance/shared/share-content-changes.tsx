import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconMinus, IconPlus, IconRefresh, IconPuzzle, IconPhoto, IconSparkles, IconFile } from "@tabler/icons-react"
import type { DiffEntry } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { ShareContentIdentity } from "./share-content-identity"
import { sharedSettingLabel } from "./share-setting-label"

const categories = ["mods", "resourcepacks", "shaders", "other"] as const
type Category = typeof categories[number]
const categoryIcons = { mods: IconPuzzle, resourcepacks: IconPhoto, shaders: IconSparkles, other: IconFile }

function categoryFor(path: string): Category {
  if (path.startsWith("mods/")) return "mods"
  if (path.startsWith("resourcepacks/")) return "resourcepacks"
  if (path.startsWith("shaderpacks/")) return "shaders"
  return "other"
}

export function ShareContentChanges({ changes, presentation, showChangeType = true, expanded = false }: {
  changes: DiffEntry[]
  presentation: Record<string, ShareContentPresentation>
  showChangeType?: boolean
  expanded?: boolean
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Category>()
  const groups = categories.map(category => ({ category, entries: changes.filter(change => categoryFor(change.path) === category) }))
  const active = selected ?? groups.find(group => group.entries.length)?.category ?? "mods"
  const visible = groups.find(group => group.category === active)!.entries

  return <div className={expanded ? "flex h-full min-h-0 flex-1 flex-col" : "space-y-3"}>
    <div className={`mx-auto flex w-fit max-w-full shrink-0 flex-wrap justify-center gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1 ${expanded ? "my-3" : ""}`} role="tablist" aria-label={t("share.flow.contentCategories")}>
      {groups.filter(group => group.category !== "other" || group.entries.length).map(({ category, entries }) => {
        const CategoryIcon = categoryIcons[category]
        return <button
        key={category}
        type="button"
        role="tab"
        aria-selected={active === category}
        onClick={() => setSelected(category)}
        className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${active === category ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`}
      >
        <CategoryIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {t(category === "other" ? "share.flow.otherChanges" : `builds.tab.${category}`)}
        <span className="text-[11px] tabular-nums opacity-70">{entries.length}</span>
      </button>})}
    </div>
    <div className={`${expanded ? "min-h-0 min-w-0 flex-1 pl-4" : "max-h-64"} divide-y divide-border/50 overflow-y-auto pr-4 [scrollbar-gutter:stable]`}>
      {visible.map(change => {
        const Icon = change.type === "added" ? IconPlus : change.type === "removed" ? IconMinus : IconRefresh
        return <div key={change.path} className="flex items-center gap-3 py-3 text-xs">
          {showChangeType && <Icon className={`h-3.5 w-3.5 shrink-0 ${change.type === "removed" ? "text-destructive" : "text-muted-foreground"}`} />}
          {categoryFor(change.path) !== "other"
            ? <ShareContentIdentity path={change.path} presentation={presentation[change.path] ?? presentation[change.before?.path ?? ""]} />
            : <span className="min-w-0 flex-1 truncate" title={change.path}>{change.path.startsWith("@instance/") ? sharedSettingLabel(change.path, t) : change.path}</span>}
          {showChangeType && <span className="shrink-0 text-muted-foreground">{t(`share.diff.${change.type}`)}</span>}
        </div>
      })}
      {!visible.length && <p className={`${expanded ? "flex h-full min-h-24 items-center justify-center" : "py-4"} text-xs text-muted-foreground`}>{t("share.flow.noContentChanges")}</p>}
    </div>
  </div>
}
