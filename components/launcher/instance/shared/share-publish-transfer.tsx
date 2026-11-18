import { useTranslation } from "react-i18next"
import { IconCheck, IconLoader2 } from "@tabler/icons-react"
import type { ShareProgress, ShareContentPresentation } from "@xnlc/types"
import { publishProgressPercent } from "@/lib/share-publish-progress"
import { bytesLabel } from "./share-ui"
import { ShareContentIdentity } from "./share-content-identity"

export function SharePublishTransfer({ progress, presentation }: { progress: ShareProgress; presentation: Record<string, ShareContentPresentation> }) {
  const { t } = useTranslation()
  const percent = publishProgressPercent(progress)
  const files = progress.files ?? []
  return <div className="mt-5 flex min-h-0 w-full max-w-lg flex-col gap-4">
    <div className="shrink-0">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{progress.bytes > 0 ? t("share.flow.uploadedBytes", { size: bytesLabel(progress.bytes) }) : ""}</span>
        {percent !== undefined && <span className="font-medium tabular-nums text-foreground">{percent > 0 && percent < 1 ? "<1" : Math.round(percent)}%</span>}
      </div>
      <div role="progressbar" aria-label={t("share.publish")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none ${percent === undefined ? "progress-launch" : ""}`} style={{ width: percent === undefined ? "100%" : `${percent}%` }} />
      </div>
    </div>
    {!!files.length && <div data-share-transfer-files className="max-h-60 min-h-0 overflow-y-auto rounded-xl border border-border bg-muted/20 px-3 [scrollbar-gutter:stable]">
      {files.map(file => <div key={file.path} className="flex items-center gap-3 border-b border-border/50 py-3 last:border-0" aria-busy={file.status === "downloading"}>
        <ShareContentIdentity path={file.path} presentation={presentation[file.path] ?? { name: file.name || file.path.split("/").pop() || file.path, iconUrl: file.iconUrl }} />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{bytesLabel(file.size)}</span>
        {file.status === "complete" ? <IconCheck aria-hidden="true" className="size-4 shrink-0 text-primary" /> : <IconLoader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />}
      </div>)}
    </div>}
  </div>
}
