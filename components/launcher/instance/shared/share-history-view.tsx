import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconGitCommit, IconSearch, IconFileText, IconHistory } from "@tabler/icons-react"
import type { DiffEntry } from "@xnlc/share"
import type { ShareContentPresentation } from "@xnlc/types"
import { ShareButton, shareInput } from "./share-ui"
import { ShareContentIdentity } from "./share-content-identity"
import { ShareAuthor } from "./share-author"
import { sharedSettingLabel, sharedSettingValue } from "./share-setting-label"
import { EmptyState } from "@/components/ui/empty-state"
import { shareContentCategory, type ShareContentCategory } from "./share-content-category"
import { SharePluginChanges } from "./share-plugin-changes"
import { groupPluginChanges } from "./share-plugin-groups"
import { ShareChangeMark } from "./share-change-mark"

export interface ShareHistoryCommitView { id: string; message: string; author: string; createdAt: string; description?: string; changeCount: number }
export function ShareHistoryView({ commits, selectedId, onSelect, head, changes, presentation = {}, authorName, currentUser, canRestore, busy, loading, error, onRestore, contentCategories }: {
  commits: ShareHistoryCommitView[]; selectedId?: string; onSelect(id: string): void; head?: string
  changes: DiffEntry[]; presentation?: Record<string, ShareContentPresentation>; authorName(id: string): string; currentUser?: string
  canRestore: boolean; busy: boolean; loading?: boolean; error?: string; onRestore(commit: string, message: string): void
  contentCategories?: readonly ShareContentCategory[]
}) {
  const { t, i18n } = useTranslation()
  const [group, setGroup] = useState("all"), [query, setQuery] = useState("")
  const groups = ["all", ...(contentCategories ? contentCategories.map(category => category === "other" ? "files" : category) : ["mods", ...(changes.some(change => change.path.startsWith("plugins/")) ? ["plugins"] : []), "resourcepacks", "shaders", "files"])]
  const categoryFor = (path: string) => { const category = shareContentCategory(path, contentCategories); return category === "other" ? "files" : category }
  const selected = commits.find(commit => commit.id === selectedId) ?? commits.find(commit => commit.id === head) ?? commits[0]
  const defaultGroup = contentCategories ? contentCategories.find(category => category !== "other" && changes.some(change => categoryFor(change.path) === category)) ?? "all" : changes.some(change => categoryFor(change.path) === "mods") ? "mods" : "all"
  useEffect(() => { setQuery(""); setGroup(defaultGroup) }, [selected?.id, defaultGroup])
  if (!selected) return <EmptyState icon={IconHistory} title={t("share.history.empty")} className="h-full min-h-48 py-8" />
  const setSelection = onSelect
  const summary = { added: changes.filter(change => change.type === "added").length, modified: changes.filter(change => change.type === "modified" || change.type === "renamed").length, removed: changes.filter(change => change.type === "removed").length }
  const date = (value: string) => new Date(value).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })
  const label = (entry?: DiffEntry["before"]) => entry ? presentation[entry.sha256] : undefined
  const visible = changes.filter(change => (group === "all" || categoryFor(change.path) === group) && [change.path, change.before?.path, label(change.after)?.name, label(change.before)?.name].some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  return <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,2fr)] gap-5 md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
    <aside className="min-h-0 space-y-2 overflow-y-auto pr-2 md:border-r md:border-border/50 md:pr-4" aria-label={t("share.tabs.history")}>
      {commits.map(commit => {
        return <button type="button" key={commit.id} aria-pressed={selected.id === commit.id} onClick={() => setSelection(commit.id)} className={`w-full rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected.id === commit.id ? "border-primary/40 bg-primary/10" : "border-border/60 bg-card/40 hover:border-border hover:bg-muted/40"}`}>
          <div className="flex items-start gap-2"><IconGitCommit className={`mt-0.5 h-4 w-4 shrink-0 ${selected.id === commit.id ? "text-primary" : "text-muted-foreground"}`} /><span className="line-clamp-2 break-words text-sm font-medium">{commit.message}</span></div>
          <div className="mt-2 text-xs text-muted-foreground"><ShareAuthor author={commit.author} name={authorName(commit.author)} currentUser={currentUser} /></div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground"><time dateTime={commit.createdAt}>{date(commit.createdAt)}</time><span className="rounded-md bg-muted/60 px-1.5 py-0.5 tabular-nums">{t("share.history.changeCount", { count: commit.changeCount })}</span></div>
        </button>
      })}
    </aside>
    <section className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <header className="shrink-0 space-y-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 flex-1 break-words text-lg font-semibold">{selected.message}</h3>
        {canRestore && selected.id !== head && <ShareButton secondary disabled={busy} onClick={() => onRestore(selected.id, t("share.history.restoreMessage", { name: selected.message }).slice(0, 500))}><IconHistory className="h-3.5 w-3.5" />{t("share.history.restore")}</ShareButton>}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><ShareAuthor author={selected.author} name={authorName(selected.author)} currentUser={currentUser} /><span>{date(selected.createdAt)}</span></div>
        {selected.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{selected.description}</p>}
        <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3 text-xs">{summary.added > 0 && <span className="rounded-md bg-muted/60 px-2 py-1 text-success">{t("share.history.added", { count: summary.added })}</span>}{summary.modified > 0 && <span className="rounded-md bg-muted/60 px-2 py-1">{t("share.history.modified", { count: summary.modified })}</span>}{summary.removed > 0 && <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">{t("share.history.removed", { count: summary.removed })}</span>}</div>
      </header>
      <div className="shrink-0 space-y-3">
        <div className="relative"><IconSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className={shareInput + " pl-9"} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("share.history.search")} aria-label={t("share.history.search")} /></div>
        <div className="flex flex-wrap gap-1">{groups.map(value => <button type="button" key={value} aria-pressed={group === value} onClick={() => setGroup(value)} className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${group === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/40"}`}>
          {t(value === "all" || value === "files" ? `share.history.${value}` : value === "plugins" ? "servers.addons.plugins" : `builds.tab.${value}`)}<span className="ml-1.5 tabular-nums text-muted-foreground">{value === "plugins" ? groupPluginChanges(changes.filter(change => categoryFor(change.path) === "plugins"), presentation).length : changes.filter(change => value === "all" || categoryFor(change.path) === value).length}</span>
        </button>)}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-3">
        {(group === "all" || group === "plugins") && <SharePluginChanges cards changes={visible.filter(change => categoryFor(change.path) === "plugins")} presentation={presentation} />}
        {visible.filter(change => categoryFor(change.path) !== "plugins").map(change => {
          const entry = change.after ?? change.before
          const metadata = label(entry)
          const after = label(change.after)
          const updated = change.type === "modified" && (change.changes.includes("sha256") || change.changes.includes("source"))
          return <div key={change.path} className="space-y-2 rounded-xl border border-border/60 bg-card/30 px-3 py-3">
            <div className="flex items-center gap-3">
              <ShareChangeMark type={change.type} />
              {categoryFor(change.path) !== "files" ? <ShareContentIdentity path={change.path} presentation={metadata ? { ...metadata, version: updated ? undefined : metadata.version } : undefined} /> : <><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground"><IconFileText className="h-4 w-4" strokeWidth={1.75} /></span><div className="min-w-0 flex-1" title={change.path}><p className="truncate text-sm font-medium">{(change.path.startsWith("@instance/") || change.path.startsWith("@settings/")) ? change.path.startsWith("@settings/") ? sharedSettingLabel(change.path, t) : t("share.flow.instanceSettings") : change.path.split("/").pop()}</p>{!(change.path.startsWith("@instance/") || change.path.startsWith("@settings/")) && change.path.includes("/") && <p className="mt-0.5 truncate text-xs text-muted-foreground">{change.path.slice(0, change.path.lastIndexOf("/"))}</p>}</div></>}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {updated && <p>{after?.version && after.version !== "local" ? t("share.history.updatedTo", { version: after.version }) : t("share.history.updated")}</p>}
              {(change.path.startsWith("@instance/") || change.path.startsWith("@settings/")) && <p className="break-words">{sharedSettingLabel(change.path, t)}: {sharedSettingValue(change.path, change.changes[0], t)} → {sharedSettingValue(change.path, change.changes[1], t)}</p>}
              {change.changes.includes("enabled") && <p>{t(change.after?.enabled ? "share.history.enabled" : "share.history.disabled")}</p>}
            </div>
          </div>
        })}
        {!visible.length && <p className="py-8 text-center text-sm text-muted-foreground">{t("share.history.noMatches")}</p>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {loading && !error && <p role="status" className="text-xs text-muted-foreground">{t("share.history.loading")}</p>}
    </section>
  </div>
}
