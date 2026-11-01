import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { IconGitBranch, IconGitPullRequest, IconHistory } from "@tabler/icons-react"

export type ShareVersionTab = "history" | "branches" | "pullRequests"

export function ShareVersionNavigation({ tab, onChange, children }: { tab: ShareVersionTab; onChange(tab: ShareVersionTab): void; children: ReactNode }) {
  const { t } = useTranslation()
  return <div className="flex h-full min-h-0 flex-col gap-4">
    <nav aria-label={t("share.launcher.versions")} className="mx-auto flex w-fit max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {([{ value: "history", Icon: IconHistory }, { value: "branches", Icon: IconGitBranch }, { value: "pullRequests", Icon: IconGitPullRequest }] as const).map(({ value, Icon }) => <button type="button" data-share-tab={value} aria-current={tab === value ? "page" : undefined} key={value} className={`flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-[7px] text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => onChange(value)}><Icon className={`h-4 w-4 ${tab === value ? "text-primary-foreground" : "text-primary"}`} strokeWidth={1.75} />{t(value === "pullRequests" ? "share.pullRequests" : `share.tabs.${value}`)}</button>)}
    </nav>
    <div className={`min-h-0 flex-1 ${tab === "history" ? "overflow-hidden" : "overflow-y-auto pr-3"}`}>{children}</div>
  </div>
}
