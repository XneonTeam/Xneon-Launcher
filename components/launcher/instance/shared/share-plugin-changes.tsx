import { IconChevronDown, IconFileText } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import type { DiffEntry } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { ShareContentIdentity } from "./share-content-identity"
import { groupPluginChanges } from "./share-plugin-groups"
import { ShareChangeMark, shareChangeColor } from "./share-change-mark"

export function SharePluginChanges({ changes, presentation, showChangeType = true, cards = false }: {
  changes: DiffEntry[]; presentation: Record<string, ShareContentPresentation>; showChangeType?: boolean; cards?: boolean
}) {
  const { t } = useTranslation()
  return <>{groupPluginChanges(changes, presentation).map(group => {
    const identity = <ShareContentIdentity path={group.path} presentation={group.metadata ?? { name: group.name }} />
    const children = [...group.artifacts, ...group.files]
    const type = group.artifacts.length && group.artifacts.every(change => change.type === "removed") ? "removed" : group.artifacts.length && group.artifacts.every(change => change.type === "added") ? "added" : "modified"
    if (!group.files.length) return <div key={group.key} className={cards ? "flex items-center gap-3 rounded-xl border border-border/60 bg-card/30 px-3 py-3" : "flex items-center gap-3 py-3 text-xs"}>{showChangeType && <ShareChangeMark type={type} />}{identity}{showChangeType && <span className={`shrink-0 text-xs ${shareChangeColor(type)}`}>{t(`share.diff.${type}`)}</span>}</div>
    return <details key={group.key} className={cards ? "group rounded-xl border border-border/60 bg-card/30 px-3" : "group"}>
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {showChangeType && <ShareChangeMark type={type} />}
        {identity}
        {showChangeType && <span className={`shrink-0 ${shareChangeColor(type)}`}>{t(`share.diff.${type}`)}</span>}
        <span className="shrink-0 text-muted-foreground">{t("serverHistory.pluginFiles", { count: children.length })}</span>
        <IconChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-180" />
      </summary>
      <div className="mb-3 ml-4 divide-y divide-border/50 border-l border-border/60 pl-4">
        {children.map(change => <div key={change.path} className="flex items-start gap-2 py-2.5 text-xs">
          {showChangeType ? <ShareChangeMark type={change.type} /> : <IconFileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          <span className="min-w-0 flex-1 break-all text-foreground" title={change.path}>{change.path.startsWith(group.path + "/") ? change.path.slice(group.path.length + 1) : change.path.slice("plugins/".length)}</span>
          {showChangeType && <span className={`shrink-0 pl-2 ${shareChangeColor(change.type)}`}>{t(`share.diff.${change.type}`)}</span>}
        </div>)}
      </div>
    </details>
  })}</>
}
