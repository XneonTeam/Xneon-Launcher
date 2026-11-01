import type { ShareContentPresentation } from "@xnlc/types"
import { SourceMark } from "@/components/launcher/source-mark"

export function ShareContentIdentity({ path, presentation }: { path: string; presentation?: ShareContentPresentation }) {
  const name = presentation?.name || path.split("/").pop() || path
  const detail = [presentation?.author, presentation?.version && presentation.version !== "local" ? presentation.version : undefined].filter(Boolean).join(" · ")
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5" title={path}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
        {presentation?.iconUrl
          ? <img src={presentation.iconUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          : <span className="text-xs font-semibold text-muted-foreground">{name[0]}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {presentation?.source && presentation.source !== "local" && <SourceMark source={presentation.source} className="shrink-0" />}
        </div>
        {detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  )
}
