import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconGitCommit, IconSearch, IconFileText, IconHistory } from "@tabler/icons-react"
import { branchHistory, diff, type ContentEntry, type DiffEntry } from "@xnlc/share"
import type { ShareResponse } from "@xnlc/types"
import { ShareButton, shareInput } from "./share-ui"
import { ShareContentIdentity } from "./share-content-identity"
import type { ShareController } from "./use-share"
import { ShareAuthor } from "./share-author"
import { sharedSettingLabel, sharedSettingValue } from "./share-setting-label"

const groups = ["all", "mods", "resourcepacks", "shaders", "files"] as const
type Group = typeof groups[number]
const groupFor = (path: string): Group => path.startsWith("mods/") ? "mods" : path.startsWith("resourcepacks/") ? "resourcepacks" : path.startsWith("shaderpacks/") ? "shaders" : "files"
const counts = (changes: DiffEntry[]) => ({
  added: changes.filter(change => change.type === "added").length,
  modified: changes.filter(change => change.type === "modified" || change.type === "renamed").length,
  removed: changes.filter(change => change.type === "removed").length,
})

export function ShareHistoryPanel({ controller, buildId, onRestore }: { controller: ShareController; buildId: string; onRestore(commit: string, message: string): void }) {
  const { t, i18n } = useTranslation()
  const { repository: repo, link, memberNames } = controller.data
  const [selection, setSelection] = useState("")
  const [group, setGroup] = useState<Group>("all")
  const [query, setQuery] = useState("")
  const [details, setDetails] = useState<ShareResponse["history"]>()
  const [error, setError] = useState("")
  const head = repo && link ? repo.branches[link.branch]?.head : undefined
  const commits = useMemo(() => {
    return repo && link ? branchHistory(repo, link.branch) : []
  }, [repo, link?.branch])
  const selected = commits.find(commit => commit.id === selection) ?? commits.find(commit => commit.id === head) ?? commits[0]
  const changes = useMemo(() => {
    if (!repo || !selected) return []
    const manifest = selected.snapshot.manifest
    return diff(repo.commits[selected.parents[0]]?.snapshot.manifest ?? { ...manifest, entries: [] }, manifest)
  }, [repo, selected])

  useEffect(() => {
    if (!selected) return
    const api = window.electronAPI
    if (!api) return
    let active = true
    setDetails(undefined); setError(""); setQuery(""); setGroup(changes.some(change => groupFor(change.path) === "mods") ? "mods" : "all")
    void api.shareExecute({ action: "history", buildId, commit: selected.id }).then(result => {
      if (!active) return
      if (result.success) setDetails(result.data.history)
      else setError(t(`share.errors.${result.error.code}`, { defaultValue: t("share.failed") }))
    }).catch(() => { if (active) setError(t("share.flow.connectionError")) })
    return () => { active = false }
  }, [buildId, selected?.id, changes, t])

  if (!repo || !link || !selected) return <p className="py-8 text-sm text-muted-foreground">{t("share.history.empty")}</p>
  const presentation = details?.commitId === selected.id ? details.presentation : {}
  const summary = counts(changes)
  const date = (value: string) => new Date(value).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })
  const label = (entry?: ContentEntry) => entry ? presentation[entry.sha256] : undefined
  const visible = changes.filter(change => (group === "all" || groupFor(change.path) === group)
    && [change.path, change.before?.path, label(change.after)?.name, label(change.before)?.name].some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))

  return <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,2fr)] gap-5 md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
    <aside className="min-h-0 space-y-2 overflow-y-auto pr-2 md:border-r md:border-border/50 md:pr-4" aria-label={t("share.tabs.history")}>
      {commits.map(commit => {
        const manifest = commit.snapshot.manifest
        const changeCount = diff(repo.commits[commit.parents[0]]?.snapshot.manifest ?? { ...manifest, entries: [] }, manifest).length
        return <button type="button" key={commit.id} aria-pressed={selected.id === commit.id} onClick={() => setSelection(commit.id)} className={`w-full rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected.id === commit.id ? "border-primary/40 bg-primary/10" : "border-border/60 bg-card/40 hover:border-border hover:bg-muted/40"}`}>
          <div className="flex items-start gap-2"><IconGitCommit className={`mt-0.5 h-4 w-4 shrink-0 ${selected.id === commit.id ? "text-primary" : "text-muted-foreground"}`} /><span className="line-clamp-2 break-words text-sm font-medium">{commit.message}</span></div>
          <div className="mt-2 text-xs text-muted-foreground"><ShareAuthor author={commit.author} name={memberNames?.[commit.author] ?? commit.author} currentUser={controller.data.user} /></div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground"><time dateTime={commit.createdAt}>{date(commit.createdAt)}</time><span className="rounded-md bg-muted/60 px-1.5 py-0.5 tabular-nums">{t("share.history.changeCount", { count: changeCount })}</span></div>
        </button>
      })}
    </aside>
    <section className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <header className="shrink-0 space-y-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 flex-1 break-words text-lg font-semibold">{selected.message}</h3>
        {link.role !== "viewer" && selected.id !== head && selected.manifestHash !== repo.commits[head ?? ""]?.manifestHash && <ShareButton secondary disabled={controller.busy} onClick={() => onRestore(selected.id, t("share.history.restoreMessage", { name: selected.message }).slice(0, 500))}><IconHistory className="h-3.5 w-3.5" />{t("share.history.restore")}</ShareButton>}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><ShareAuthor author={selected.author} name={memberNames?.[selected.author] ?? selected.author} currentUser={controller.data.user} /><span>{date(selected.createdAt)}</span></div>
        {selected.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{selected.description}</p>}
        <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3 text-xs">{summary.added > 0 && <span className="rounded-md bg-muted/60 px-2 py-1 text-success">{t("share.history.added", { count: summary.added })}</span>}{summary.modified > 0 && <span className="rounded-md bg-muted/60 px-2 py-1">{t("share.history.modified", { count: summary.modified })}</span>}{summary.removed > 0 && <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">{t("share.history.removed", { count: summary.removed })}</span>}</div>
      </header>
      <div className="shrink-0 space-y-3">
        <div className="relative"><IconSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className={shareInput + " pl-9"} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("share.history.search")} aria-label={t("share.history.search")} /></div>
        <div className="flex flex-wrap gap-1">{groups.map(value => <button type="button" key={value} aria-pressed={group === value} onClick={() => setGroup(value)} className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${group === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/40"}`}>
          {t(value === "all" || value === "files" ? `share.history.${value}` : `builds.tab.${value}`)}<span className="ml-1.5 tabular-nums text-muted-foreground">{changes.filter(change => value === "all" || groupFor(change.path) === value).length}</span>
        </button>)}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-3">
        {visible.map(change => {
          const entry = change.after ?? change.before
          const metadata = label(entry)
          const after = label(change.after)
          const updated = change.type === "modified" && (change.changes.includes("sha256") || change.changes.includes("source"))
          return <div key={change.path} className="space-y-2 rounded-xl border border-border/60 bg-card/30 px-3 py-3">
            <div className="flex items-center gap-3">
              {groupFor(change.path) !== "files" ? <ShareContentIdentity path={change.path} presentation={metadata ? { ...metadata, version: updated ? undefined : metadata.version } : undefined} /> : <><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground"><IconFileText className="h-4 w-4" strokeWidth={1.75} /></span><div className="min-w-0 flex-1" title={change.path}><p className="truncate text-sm font-medium">{change.path.startsWith("@instance/") ? t("share.flow.instanceSettings") : change.path.split("/").pop()}</p>{!change.path.startsWith("@instance/") && change.path.includes("/") && <p className="mt-0.5 truncate text-xs text-muted-foreground">{change.path.slice(0, change.path.lastIndexOf("/"))}</p>}</div></>}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {updated && <p>{after?.version && after.version !== "local" ? t("share.history.updatedTo", { version: after.version }) : t("share.history.updated")}</p>}
              {change.path.startsWith("@instance/") && <p className="break-words">{sharedSettingLabel(change.path, t)}: {sharedSettingValue(change.path, change.changes[0], t)} → {sharedSettingValue(change.path, change.changes[1], t)}</p>}
              {change.changes.includes("enabled") && <p>{t(change.after?.enabled ? "share.history.enabled" : "share.history.disabled")}</p>}
            </div>
          </div>
        })}
        {!visible.length && <p className="py-8 text-center text-sm text-muted-foreground">{t("share.history.noMatches")}</p>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!details && !error && <p role="status" className="text-xs text-muted-foreground">{t("share.history.loading")}</p>}
    </section>
  </div>
}
