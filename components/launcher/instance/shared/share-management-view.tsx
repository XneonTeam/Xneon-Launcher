import { useTranslation } from "react-i18next"
import { IconColorSwatch, IconUsers, IconGitBranch, IconChevronRight } from "@tabler/icons-react"

export function ShareManagementView({ shared, branch, busy, memberCount, onMembers, onVersions, startHelp, contentHelp, showSummary = true }: {
  shared: boolean; branch?: string; busy: boolean; memberCount: number
  onMembers(): void; onVersions(): void; startHelp?: string; contentHelp?: string; showSummary?: boolean
}) {
  const { t } = useTranslation()
  return <>
    {showSummary && <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><IconColorSwatch className="h-5 w-5 text-primary" /></div>
        <div className="min-w-0"><h3 className="text-sm font-medium">{t(shared ? "share.launcher.enabled" : "share.launcher.shareBuild")}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{shared ? branch : startHelp ?? t("share.launcher.startHelp")}</p></div>
      </div>
      {!shared && <p className="mt-3 border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">{contentHelp ?? t("share.launcher.contentHelp")}</p>}
    </div>}
    <div className="divide-y divide-border/50 rounded-2xl border border-border/70 bg-card/40 px-4">
      <button type="button" disabled={busy} className="flex w-full items-center gap-3 py-3 text-left text-sm transition-colors hover:text-primary disabled:opacity-50" onClick={onMembers}>
        <IconUsers className="h-4 w-4 text-primary" /><span className="flex-1">{t("share.tabs.members")}</span><span className="text-xs tabular-nums text-muted-foreground">{memberCount}</span><IconChevronRight className="h-3.5 w-3.5 text-primary" />
      </button>
      <button type="button" disabled={busy} className="flex w-full items-center gap-3 py-3 text-left text-sm transition-colors hover:text-primary disabled:opacity-50" onClick={onVersions}>
        <IconGitBranch className="h-4 w-4 text-primary" /><span className="flex-1">{t("share.launcher.versions")}</span><IconChevronRight className="h-3.5 w-3.5 text-primary" />
      </button>
    </div>
  </>
}
