import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconPuzzle, IconPhoto, IconSparkles, IconFile, IconInfoCircle } from "@tabler/icons-react"
import type { DiffEntry } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { ShareContentIdentity } from "./share-content-identity"
import { sharedSettingLabel } from "./share-setting-label"
import { shareContentCategory, type ShareContentCategory } from "./share-content-category"
import { SharePluginChanges } from "./share-plugin-changes"
import { groupPluginChanges } from "./share-plugin-groups"
import { ShareChangeMark, shareChangeColor } from "./share-change-mark"

const categories = ["mods", "plugins", "resourcepacks", "shaders", "other"] as const
type Category = ShareContentCategory
const categoryIcons = { mods: IconPuzzle, plugins: IconPuzzle, resourcepacks: IconPhoto, shaders: IconSparkles, other: IconFile }

export function ShareContentChanges({ changes, presentation, showChangeType = true, expanded = false, contentCategories, onDetails }: {
  changes: DiffEntry[]
  presentation: Record<string, ShareContentPresentation>
  showChangeType?: boolean
  expanded?: boolean
  contentCategories?: readonly ShareContentCategory[]
  onDetails?: (project: ShareContentPresentation) => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Category>()
  const [focusedRow, setFocusedRow] = useState(0)
  const categoryFor = (path: string) => shareContentCategory(path, contentCategories)
  const groups = (contentCategories ?? categories.filter(category => category !== "plugins" || changes.some(change => change.path.startsWith("plugins/")))).map(category => ({ category, entries: changes.filter(change => categoryFor(change.path) === category) }))
  const active = groups.some(group => group.category === selected) ? selected! : groups.find(group => group.entries.length)?.category ?? groups[0]?.category ?? "other"
  const visible = groups.find(group => group.category === active)!.entries

  return <div className={expanded ? "flex h-full min-h-0 flex-1 flex-col" : "space-y-3"}>
    <div className={`mx-auto flex w-fit max-w-full shrink-0 flex-wrap justify-center gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1 ${expanded ? "my-3" : ""}`} role="tablist" aria-label={t("share.flow.contentCategories")}>
      {groups.filter(group => contentCategories || group.category !== "other" || group.entries.length).map(({ category, entries }) => {
        const CategoryIcon = categoryIcons[category]
        return <button
        key={category}
        type="button"
        role="tab"
        aria-selected={active === category}
        onClick={() => { setSelected(category); setFocusedRow(0) }}
        className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${active === category ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`}
      >
        <CategoryIcon className={`h-4 w-4 shrink-0 ${active === category ? "text-primary-foreground" : "text-primary"}`} strokeWidth={1.75} />
        {t(category === "other" ? "share.flow.otherChanges" : category === "plugins" ? "servers.addons.plugins" : `builds.tab.${category}`)}
        <span className="text-[11px] tabular-nums opacity-70">{category === "plugins" ? groupPluginChanges(entries, presentation).length : entries.length}</span>
      </button>})}
    </div>
    <div className={`${expanded ? "min-h-0 min-w-0 flex-1 pl-4" : "max-h-64"} divide-y divide-border/50 overflow-y-auto pr-4 [scrollbar-gutter:stable]`}>
      {active === "plugins" ? <SharePluginChanges changes={visible} presentation={presentation} showChangeType={showChangeType} /> : visible.map((change, index) => {
        const project = presentation[change.path] ?? presentation[change.before?.path ?? ""]
        return <div key={change.path} tabIndex={index === Math.min(focusedRow, visible.length - 1) ? 0 : -1} onFocus={() => setFocusedRow(index)} onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          const next = Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
          if (next === index) return
          event.preventDefault()
          const rows = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-share-content-row]")
          rows?.[next]?.focus()
        }} data-share-content-row className="flex items-center gap-3 rounded-lg px-2 py-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          {showChangeType && <ShareChangeMark type={change.type} />}
          {categoryFor(change.path) !== "other"
            ? <ShareContentIdentity path={change.path} presentation={presentation[change.path] ?? presentation[change.before?.path ?? ""]} />
            : <span className="min-w-0 flex-1 truncate" title={change.path}>{change.path.startsWith("@instance/") || change.path.startsWith("@settings/") ? sharedSettingLabel(change.path, t) : change.path}</span>}
          {onDetails && categoryFor(change.path) === "mods" && project?.projectId && (project.source === "modrinth" || project.source === "curseforge") && <button type="button" onClick={() => onDetails(project)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><IconInfoCircle className="h-3.5 w-3.5" />{t("builds.details")}</button>}
          {showChangeType && <span className={`shrink-0 ${shareChangeColor(change.type)}`}>{t(`share.diff.${change.type}`)}</span>}
        </div>
      })}
      {!visible.length && <p className={`${expanded ? "flex h-full min-h-24 items-center justify-center" : "py-4"} text-xs text-muted-foreground`}>{t("share.flow.noContentChanges")}</p>}
    </div>
  </div>
}
