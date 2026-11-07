import { IconFiles, IconGitCompare } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

export function SharePublishTabs({ value, onChange, shared, changeCount, fileCount }: {
  value: "changes" | "files"; onChange(value: "changes" | "files"): void
  shared: boolean; changeCount: number; fileCount: number
}) {
  const { t } = useTranslation()
  return <div className="flex shrink-0 gap-1 rounded-xl border border-border/70 bg-muted/30 p-1" aria-label={t("share.launcher.publishTitle")}>
    {(["changes", "files"] as const).map(tab => {
      const Icon = tab === "changes" ? IconGitCompare : IconFiles
      return <button type="button" key={tab} aria-pressed={value === tab} onClick={() => onChange(tab)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${value === tab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}>
        <Icon className="h-4 w-4 shrink-0 text-primary" />{t(tab === "changes" && !shared ? "share.launcher.content" : `share.flow.${tab}`)}
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{tab === "changes" ? changeCount : fileCount}</span>
      </button>
    })}
  </div>
}
