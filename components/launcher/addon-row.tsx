import { useTranslation } from "react-i18next"
import { IconInfoCircle, IconCheck, IconPlus, IconLoader2 } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { CategoryBadge } from "./instance/category-badge"
import { SourceMark } from "@/components/launcher/source-mark"
import { formatDownloads } from "./instance/utils"
import type { ModSearchResult } from "@xnlc/types"

export interface AddonRowProps {
  project: ModSearchResult
  installed: boolean
  /** Установка идёт (карточка показывает прогресс). */
  installing: boolean
  /** Процент загрузки, если известен. */
  percent?: number | null
  /** Показывать ли бейджи категорий (в сборках — только для вкладки «Моды»). */
  showCategories?: boolean
  /** Блокирует кнопку установки, если уже что-то ставится. */
  installDisabled?: boolean
  /** Текст кнопки установки. */
  installLabel: string
  /** Если задано и установка запрещена — спросить подтверждение перед установкой. */
  confirmMessage?: string
  onDetails: () => void
  onInstall: () => void
}

/**
 * Карточка контента в результатах поиска. Единая для сборок и серверов.
 */
export function AddonRow({
  project,
  installed,
  installing,
  percent = null,
  showCategories = true,
  installDisabled = false,
  installLabel,
  confirmMessage,
  onDetails,
  onInstall,
}: AddonRowProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        "group min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5 transition-colors hover:border-primary/50",
        installing && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-muted flex-shrink-0">
          {project.iconUrl ? (
            <img src={project.iconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-muted-foreground">{project.name[0]}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="min-w-0 truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{project.name}</p>
            <SourceMark source={project.source} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="shrink-0 text-xs text-muted-foreground">{formatDownloads(project.downloadCount)}</span>
            {showCategories && project.categories?.slice(0, 3).map(cat => (
              <CategoryBadge key={cat} name={cat} source={project.source} className="min-w-0 px-1.5 text-[11px]" />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onDetails}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80"
          >
            <IconInfoCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("builds.details")}
          </button>
          {installed ? (
            <span className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary">
              <IconCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("builds.installed")}
            </span>
          ) : (
            <button
              type="button"
              disabled={installDisabled || installing}
              onClick={() => {
                if (confirmMessage && !confirm(confirmMessage)) return
                onInstall()
              }}
              className="flex items-center justify-center gap-1.5 min-w-[90px] rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {installing ? (
                <>
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin shrink-0" strokeWidth={2} />
                  {percent !== null && <span className="font-mono tabular-nums">{percent}%</span>}
                </>
              ) : (
                <>
                  <IconPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  <span>{installLabel}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {installing && (
        <div className="mt-2.5 pt-2 border-t border-border/50">
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5 min-w-0">
              <IconLoader2 className="h-3 w-3 shrink-0 animate-spin text-primary" strokeWidth={2} />
              <span className="truncate">Установка...</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {percent !== null ? `${percent}%` : ""}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
                percent === null && "animate-pulse",
              )}
              style={{ width: percent === null ? "100%" : `${Math.max(2, percent)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
